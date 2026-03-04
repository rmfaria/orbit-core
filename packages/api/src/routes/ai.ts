import { Router } from 'express';
import type { Pool } from 'pg';
import { DashboardSpecSchema } from '@orbit/core-contracts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssetMetric {
  asset_id:  string;
  namespace: string;
  metric:    string;
  pts:       number;
}

interface EventNsStat {
  namespace: string;
  total:     number;
  last_seen: string | null;
}

interface EventKindStat {
  namespace: string;
  kind:      string;
  cnt:       number;
}

interface EventAgentStat {
  namespace: string;
  asset_id:  string;
  cnt:       number;
}

interface EventSevStat {
  namespace: string;
  severity:  string;
  cnt:       number;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function aiRouter(pool: Pool | null): Router {
  const r = Router();

  // ── AI Plugin Generator ───────────────────────────────────────────────────
  //
  // POST /api/v1/ai/plugin
  // Headers: X-Ai-Key, X-Ai-Model
  // Body:    { description: string, source_type?: string }
  //
  // Returns three downloadable artefacts:
  //   connector_spec  — orbit-core DSL spec (JSON object)
  //   agent_script    — shell/Python script to run on target machine (string)
  //   readme          — markdown install instructions (string)

  r.post('/ai/plugin', async (req, res) => {
    const aiKey   = req.headers['x-ai-key']   as string | undefined;
    const aiModel = req.headers['x-ai-model'] as string | undefined;

    if (!aiKey)   return res.status(400).json({ ok: false, error: 'Missing X-Ai-Key header' });
    if (!aiModel) return res.status(400).json({ ok: false, error: 'Missing X-Ai-Model header' });

    const { description, source_type } = (req.body ?? {}) as { description?: string; source_type?: string };
    if (!description || typeof description !== 'string' || description.trim().length < 5) {
      return res.status(400).json({ ok: false, error: 'Provide a description of at least 5 characters' });
    }

    const userMsg = source_type
      ? `Source type: ${source_type}\n\n${description}`
      : description;

    let anthropicRes: Response;
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':         aiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        body: JSON.stringify({
          model:      aiModel,
          max_tokens: 4096,
          system:     buildPluginSystemPrompt(),
          messages:   [{ role: 'user', content: userMsg }],
        }),
      });
    } catch (err: unknown) {
      return res.status(502).json({ ok: false, error: 'Failed to reach Anthropic API', detail: String(err) });
    }

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => '');
      return res.status(502).json({
        ok: false,
        error: `Anthropic API error: ${anthropicRes.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const anthropicJson = await anthropicRes.json() as { content?: Array<{ text: string }> };
    const rawText = anthropicJson?.content?.[0]?.text ?? '';

    const jsonText = rawText
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();

    let plugin: unknown;
    try {
      plugin = JSON.parse(jsonText);
    } catch {
      return res.status(502).json({ ok: false, error: 'AI returned invalid JSON', raw: rawText.slice(0, 500) });
    }

    if (
      !plugin || typeof plugin !== 'object' ||
      !('connector_spec' in (plugin as object)) ||
      !('agent_script' in (plugin as object)) ||
      !('readme' in (plugin as object))
    ) {
      return res.status(502).json({ ok: false, error: 'AI returned incomplete plugin package', raw: rawText.slice(0, 500) });
    }

    return res.json({ ok: true, ...(plugin as Record<string, unknown>) });
  });

  r.post('/ai/dashboard', async (req, res) => {
    const aiKey   = req.headers['x-ai-key']   as string | undefined;
    const aiModel = req.headers['x-ai-model'] as string | undefined;

    if (!aiKey)   return res.status(400).json({ ok: false, error: 'Missing X-Ai-Key header' });
    if (!aiModel) return res.status(400).json({ ok: false, error: 'Missing X-Ai-Model header' });

    const { prompt } = (req.body ?? {}) as { prompt?: string };
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing prompt in body' });
    }

    // ── Fetch rich catalog from DB ─────────────────────────────────────────
    let assetMetrics:  AssetMetric[]   = [];
    let eventNsStats:  EventNsStat[]   = [];
    let eventKinds:    EventKindStat[] = [];
    let eventAgents:   EventAgentStat[]= [];
    let eventSevs:     EventSevStat[]  = [];
    let assetNames:    Map<string, string> = new Map();

    if (pool) {
      try {
        const [amr, anr, ensr, ekr, ear, esr] = await Promise.all([
          // Metrics: asset + namespace + metric with point counts (top by volume)
          pool.query<AssetMetric>(
            `SELECT asset_id, namespace, metric, count(*)::int AS pts
             FROM metric_points
             GROUP BY asset_id, namespace, metric
             ORDER BY pts DESC
             LIMIT 400`
          ),
          // Asset names
          pool.query<{ asset_id: string; name: string }>(
            'SELECT asset_id, name FROM assets ORDER BY last_seen DESC LIMIT 100'
          ),
          // Event namespace stats
          pool.query<EventNsStat>(
            `SELECT namespace,
                    count(*)::int          AS total,
                    max(ts)::text          AS last_seen
             FROM orbit_events
             GROUP BY namespace
             ORDER BY total DESC
             LIMIT 20`
          ),
          // Event kinds per namespace (top 30 by volume)
          pool.query<EventKindStat>(
            `SELECT namespace, kind, count(*)::int AS cnt
             FROM orbit_events
             GROUP BY namespace, kind
             ORDER BY cnt DESC
             LIMIT 50`
          ),
          // Event agents per namespace (top 20 by volume)
          pool.query<EventAgentStat>(
            `SELECT namespace, asset_id, count(*)::int AS cnt
             FROM orbit_events
             GROUP BY namespace, asset_id
             ORDER BY cnt DESC
             LIMIT 50`
          ),
          // Severity distribution per namespace
          pool.query<EventSevStat>(
            `SELECT namespace, severity, count(*)::int AS cnt
             FROM orbit_events
             GROUP BY namespace, severity
             ORDER BY namespace, cnt DESC`
          ),
        ]);

        assetMetrics = amr.rows;
        assetNames   = new Map(anr.rows.map(a => [a.asset_id, a.name]));
        eventNsStats = ensr.rows;
        eventKinds   = ekr.rows;
        eventAgents  = ear.rows;
        eventSevs    = esr.rows;
      } catch { /* catalog may be empty — continue */ }
    }

    const systemPrompt = buildSystemPrompt(assetMetrics, assetNames, eventNsStats, eventKinds, eventAgents, eventSevs);

    // ── Call Anthropic API ─────────────────────────────────────────────────
    let anthropicRes: Response;
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':         aiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        body: JSON.stringify({
          model:      aiModel,
          max_tokens: 4096,
          system:     systemPrompt,
          messages:   [{ role: 'user', content: prompt }],
        }),
      });
    } catch (err: any) {
      return res.status(502).json({ ok: false, error: 'Failed to reach Anthropic API', detail: String(err) });
    }

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => '');
      return res.status(502).json({
        ok: false,
        error: `Anthropic API error: ${anthropicRes.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const anthropicJson = await anthropicRes.json() as { content?: Array<{ text: string }> };
    const rawText = anthropicJson?.content?.[0]?.text ?? '';

    // Strip markdown fences if the model wrapped in ```json ... ```
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();

    let spec: unknown;
    try {
      spec = JSON.parse(jsonText);
    } catch {
      return res.status(502).json({
        ok: false,
        error: 'AI returned invalid JSON',
        raw: rawText.slice(0, 500),
      });
    }

    // Inject defaults the model may have omitted
    if (spec && typeof spec === 'object') {
      const s = spec as Record<string, unknown>;
      if (!s['id'])      s['id']      = `dash-${Date.now()}`;
      if (!s['version']) s['version'] = 'v1';
    }

    const parsed = DashboardSpecSchema.safeParse(spec);
    if (!parsed.success) {
      return res.status(502).json({
        ok: false,
        error: 'AI returned invalid DashboardSpec',
        issues: parsed.error.issues,
        raw: rawText.slice(0, 500),
      });
    }

    return res.json({ ok: true, spec: parsed.data });
  });

  // ── AI Smart Dashboard (HTML/CSS/JS generator) ────────────────────────────
  r.post('/ai/smart-dashboard', async (req, res) => {
    const aiKey   = req.headers['x-ai-key']   as string | undefined;
    const aiModel = req.headers['x-ai-model'] as string | undefined;

    if (!aiKey)   return res.status(400).json({ ok: false, error: 'Missing X-Ai-Key header' });
    if (!aiModel) return res.status(400).json({ ok: false, error: 'Missing X-Ai-Model header' });

    const { prompt } = (req.body ?? {}) as { prompt?: string };
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      return res.status(400).json({ ok: false, error: 'Provide a prompt of at least 5 characters' });
    }

    // Reuse catalog queries
    let assetMetrics:  AssetMetric[]   = [];
    let eventNsStats:  EventNsStat[]   = [];
    let eventKinds:    EventKindStat[] = [];
    let eventAgents:   EventAgentStat[]= [];
    let eventSevs:     EventSevStat[]  = [];
    let assetNames:    Map<string, string> = new Map();

    if (pool) {
      try {
        const [amr, anr, ensr, ekr, ear, esr] = await Promise.all([
          pool.query<AssetMetric>(
            `SELECT asset_id, namespace, metric, count(*)::int AS pts
             FROM metric_points
             GROUP BY asset_id, namespace, metric
             ORDER BY pts DESC
             LIMIT 400`
          ),
          pool.query<{ asset_id: string; name: string }>(
            'SELECT asset_id, name FROM assets ORDER BY last_seen DESC LIMIT 100'
          ),
          pool.query<EventNsStat>(
            `SELECT namespace,
                    count(*)::int          AS total,
                    max(ts)::text          AS last_seen
             FROM orbit_events
             GROUP BY namespace
             ORDER BY total DESC
             LIMIT 20`
          ),
          pool.query<EventKindStat>(
            `SELECT namespace, kind, count(*)::int AS cnt
             FROM orbit_events
             GROUP BY namespace, kind
             ORDER BY cnt DESC
             LIMIT 50`
          ),
          pool.query<EventAgentStat>(
            `SELECT namespace, asset_id, count(*)::int AS cnt
             FROM orbit_events
             GROUP BY namespace, asset_id
             ORDER BY cnt DESC
             LIMIT 50`
          ),
          pool.query<EventSevStat>(
            `SELECT namespace, severity, count(*)::int AS cnt
             FROM orbit_events
             GROUP BY namespace, severity
             ORDER BY namespace, cnt DESC`
          ),
        ]);

        assetMetrics = amr.rows;
        assetNames   = new Map(anr.rows.map(a => [a.asset_id, a.name]));
        eventNsStats = ensr.rows;
        eventKinds   = ekr.rows;
        eventAgents  = ear.rows;
        eventSevs    = esr.rows;
      } catch { /* catalog may be empty */ }
    }

    const systemPrompt = buildSmartDashboardPrompt(assetMetrics, assetNames, eventNsStats, eventKinds, eventAgents, eventSevs);

    let anthropicRes: Response;
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':         aiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        body: JSON.stringify({
          model:      aiModel,
          max_tokens: 16384,
          system:     systemPrompt,
          messages:   [{ role: 'user', content: prompt }],
        }),
      });
    } catch (err: unknown) {
      return res.status(502).json({ ok: false, error: 'Failed to reach Anthropic API', detail: String(err) });
    }

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => '');
      return res.status(502).json({
        ok: false,
        error: `Anthropic API error: ${anthropicRes.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const anthropicJson = await anthropicRes.json() as { content?: Array<{ text: string }> };
    const rawText = anthropicJson?.content?.[0]?.text ?? '';

    // Extract JSON block from response
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1].trim() : rawText.trim();

    let result: { html?: string; name?: string; description?: string };
    try {
      result = JSON.parse(jsonText);
    } catch {
      // If the model returned raw HTML, wrap it
      if (rawText.includes('<!DOCTYPE') || rawText.includes('<html')) {
        result = { html: rawText.trim(), name: 'AI Dashboard', description: prompt };
      } else {
        return res.status(502).json({ ok: false, error: 'AI returned invalid response', raw: rawText.slice(0, 500) });
      }
    }

    if (!result.html) {
      return res.status(502).json({ ok: false, error: 'AI returned no HTML', raw: rawText.slice(0, 500) });
    }

    // Post-process: fix common AI mistakes in generated HTML
    let html = result.html;
    // Fix: "function query" without async (AI sometimes forgets the async keyword)
    html = html.replace(/\bfunction query\s*\(/g, 'async function query(');
    // Avoid double-async
    html = html.replace(/\basync async\b/g, 'async');

    return res.json({
      ok: true,
      html,
      name: result.name ?? 'AI Dashboard',
      description: result.description ?? prompt,
    });
  });

  return r;
}

// ─── Plugin system prompt ─────────────────────────────────────────────────────

function buildPluginSystemPrompt(): string {
  return `You are orbit-core Plugin Builder AI. Given a description of a data source,
generate a complete, ready-to-use plugin package that integrates it with orbit-core.

Output ONLY valid JSON with EXACTLY these three keys (no markdown, no text outside JSON):
{
  "connector_spec": { <orbit-core DSL connector spec — see below> },
  "agent_script":   "<complete shell or Python script — escaped string>",
  "readme":         "<markdown install instructions — escaped string>"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ORBIT-CORE PUSH INGEST API
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

POST {ORBIT_URL}/api/v1/ingest/raw/{source_id}
Headers:
  Content-Type: application/json
  X-Api-Key: {ORBIT_API_KEY}
Body: any JSON payload

The connector spec (stored in orbit-core) defines how this raw payload is
mapped to canonical metrics or events.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CONNECTOR SPEC DSL (connector_spec field)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "type":       "metric" | "event",
  "items_path": "optional.dot.path",   // path to array inside payload; omit if root IS the array
  "mappings": {
    "<target_field>": {
      "path":      "$.field.subfield",  // dot-path in each item ($ = item root)
      "value":     "literal",           // static literal (overrides path)
      "transform": "number|string|boolean|round|abs|iso8601|severity_map",
      "default":   "fallback"
    }
  }
}

REQUIRED mappings for type="metric": ts, asset_id, namespace, metric, value
REQUIRED mappings for type="event":  ts, asset_id, namespace, kind, severity, title

OPTIONAL metric fields: unit, tags
OPTIONAL event fields:  message, fingerprint, tags

Transforms:
  number      → parse to float
  string      → coerce to string
  boolean     → parse to bool
  round       → Math.round(x)
  abs         → Math.abs(x)
  iso8601     → parse ISO8601/Unix timestamp to ms epoch
  severity_map→ map strings like "CRITICAL"/"ERROR"/"WARNING" to "critical"/"high"/"medium"/"low"/"info"

EXAMPLE metric spec (Linux CPU from shell output):
{
  "type": "metric",
  "mappings": {
    "ts":        { "path": "$.ts" },
    "asset_id":  { "path": "$.host" },
    "namespace": { "value": "linux" },
    "metric":    { "path": "$.metric" },
    "value":     { "path": "$.value", "transform": "number" }
  }
}

EXAMPLE event spec (generic log events):
{
  "type": "event",
  "items_path": "events",
  "mappings": {
    "ts":        { "path": "$.timestamp", "transform": "iso8601" },
    "asset_id":  { "path": "$.host", "default": "unknown" },
    "namespace": { "value": "custom" },
    "kind":      { "path": "$.category" },
    "severity":  { "path": "$.level", "transform": "severity_map" },
    "title":     { "path": "$.message" },
    "message":   { "path": "$.details" }
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## AGENT SCRIPT GUIDELINES (agent_script field)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The agent script runs on the monitored machine and pushes data to orbit-core.

STRUCTURE RULES:
1. Start with #!/usr/bin/env python3 (preferred) or #!/bin/bash for simple cases
2. Configuration block at top (user edits these):
     ORBIT_URL = "https://YOUR_ORBIT_INSTANCE"  # e.g. https://prod.example.com
     ORBIT_SOURCE_ID = "my-source-id"            # must match the connector spec
     ORBIT_API_KEY = "YOUR_API_KEY"
3. Collect metric/event data from the described source
4. Build the JSON payload matching the connector_spec mappings
5. POST to {ORBIT_URL}/api/v1/ingest/raw/{ORBIT_SOURCE_ID}
6. Log errors (print to stderr or syslog); never crash silently
7. Designed for cron (every 1–5 min) or systemd timer

For metrics: push one payload with an array of {ts, host, metric, value} objects
For events:  push one payload with an array of event objects

Python template for HTTP POST:
  import urllib.request, urllib.error, json, time, socket
  payload = json.dumps(data).encode()
  req = urllib.request.Request(
    f"{ORBIT_URL}/api/v1/ingest/raw/{ORBIT_SOURCE_ID}",
    data=payload,
    headers={"Content-Type": "application/json", "X-Api-Key": ORBIT_API_KEY},
    method="POST"
  )
  try:
    urllib.request.urlopen(req, timeout=10)
  except Exception as e:
    print(f"[orbit-agent] ERROR: {e}", file=sys.stderr)

AVOID: third-party libraries (use stdlib only). Keep it under 120 lines.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## README GUIDELINES (readme field)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Write a concise markdown README with these sections:
1. # Plugin: <SourceName> → orbit-core
2. ## Requirements  (OS, commands needed)
3. ## 1 — Import connector spec  (step: paste connector_spec.json in orbit-core Connectors → Create → paste JSON)
4. ## 2 — Deploy agent           (mkdir /opt/orbit-agents, copy agent, chmod +x, edit config vars)
5. ## 3 — Schedule with cron     (crontab example: */2 * * * * /opt/orbit-agents/agent.py)
6. ## Verify                     (how to confirm data flowing: check orbit-core Home → live feed)

Keep each section short and practical. Use code blocks for commands.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## RULES (NEVER VIOLATE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Output ONLY valid JSON — no text before or after the JSON object
2. agent_script and readme must be valid JSON strings (escape newlines as \\n, quotes as \\")
3. connector_spec must include all required mappings for its type
4. Use realistic field names derived from the described data source
5. ORBIT_URL, ORBIT_SOURCE_ID, ORBIT_API_KEY are always placeholder strings — never fill real values
6. Keep connector_spec namespace as a short slug (lowercase, no spaces)
`;
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(
  assetMetrics: AssetMetric[],
  assetNames:   Map<string, string>,
  eventNsStats: EventNsStat[],
  eventKinds:   EventKindStat[],
  eventAgents:  EventAgentStat[],
  eventSevs:    EventSevStat[],
): string {

  // ── Group metrics by asset ───────────────────────────────────────────────
  const byAsset = new Map<string, { namespace: string; metric: string; pts: number }[]>();
  for (const am of assetMetrics) {
    const arr = byAsset.get(am.asset_id) ?? [];
    arr.push({ namespace: am.namespace, metric: am.metric, pts: am.pts });
    byAsset.set(am.asset_id, arr);
  }

  let metricCatalog = '';
  if (byAsset.size === 0) {
    metricCatalog = '  (no metrics registered yet)';
  } else {
    const lines: string[] = [];
    for (const [assetId, mets] of byAsset) {
      const label = assetNames.get(assetId) ?? assetId;
      lines.push(`  Asset: ${assetId}  (${label})`);
      for (const m of mets.slice(0, 20)) {
        lines.push(`    - namespace=${m.namespace}  metric=${m.metric}  (${m.pts} points)`);
      }
    }
    metricCatalog = lines.join('\n');
  }

  // ── Build event namespace sections ──────────────────────────────────────
  let eventCatalog = '';
  if (eventNsStats.length === 0) {
    eventCatalog = '  (no events registered yet — use wazuh/n8n connectors to ingest)';
  } else {
    const lines: string[] = [];
    for (const ns of eventNsStats) {
      lines.push(`  Namespace: ${ns.namespace}  (${ns.total.toLocaleString()} events, last: ${ns.last_seen ?? 'never'})`);

      const kinds = eventKinds.filter(k => k.namespace === ns.namespace);
      if (kinds.length) {
        lines.push(`    Event kinds: ${kinds.map(k => `${k.kind}(${k.cnt})`).join(', ')}`);
      }

      const agents = eventAgents.filter(a => a.namespace === ns.namespace);
      if (agents.length) {
        lines.push(`    Agents (asset_id): ${agents.map(a => `${a.asset_id}(${a.cnt})`).join(', ')}`);
      }

      const sevs = eventSevs.filter(s => s.namespace === ns.namespace);
      if (sevs.length) {
        lines.push(`    Severities: ${sevs.map(s => `${s.severity}(${s.cnt})`).join(', ')}`);
      }
    }
    eventCatalog = lines.join('\n');
  }

  // ── Pick real examples for query templates ───────────────────────────────
  const firstAssetEntry = assetMetrics[0];
  const exAssetId  = firstAssetEntry?.asset_id ?? 'host:server1';
  const exNs       = firstAssetEntry?.namespace ?? 'nagios';
  const exMetric   = firstAssetEntry?.metric    ?? 'load1';

  // Pick up to 3 distinct assets for timeseries_multi example
  const distinctAssets = [...new Set(assetMetrics.map(m => m.asset_id))].slice(0, 3);
  const multiNs     = firstAssetEntry?.namespace ?? 'nagios';
  const multiMetric = assetMetrics.find(m => m.namespace === multiNs && distinctAssets.includes(m.asset_id))?.metric ?? exMetric;
  const multiSeries = distinctAssets.map(aid => ({
    asset_id:  aid,
    namespace: multiNs,
    metric:    multiMetric,
    label:     assetNames.get(aid) ?? aid,
  }));

  // Pick first event namespace for examples
  const firstEvNs     = eventNsStats[0]?.namespace ?? 'wazuh';
  const firstEvKind   = eventKinds.find(k => k.namespace === firstEvNs)?.kind;
  const firstEvAgent  = eventAgents.find(a => a.namespace === firstEvNs)?.asset_id;
  const highSevExists = eventSevs.some(s => s.namespace === firstEvNs && (s.severity === 'high' || s.severity === 'critical'));

  // Build Wazuh/event-specific widget examples
  const evNsLabel = firstEvNs;
  const evKindFilter = firstEvKind ? `, "kinds": ["${firstEvKind}"]` : '';
  const evAgentFilter = firstEvAgent ? `, "asset_id": "${firstEvAgent}"` : '';
  const evSevFilter = highSevExists ? `, "severities": ["high", "critical"]` : '';

  return `You are an orbit-core Dashboard Builder AI. Output ONLY a single valid JSON object (no markdown, no explanation).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## METRIC CATALOG (asset → namespace → metric)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${metricCatalog}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EVENT CATALOG (namespace → kinds / agents / severities)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${eventCatalog}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## DASHBOARD SPEC SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  id, name, description?, version: "v1",
  time: { preset: "60m"|"6h"|"24h"|"7d"|"30d" },
  tags: string[],
  widgets: WidgetSpec[]   // 1–20
}
WidgetSpec = { id, title, kind, layout: {x:0,y:0,w:1|2,h:1}, query }
  kind: "timeseries" | "timeseries_multi" | "events" | "eps" | "kpi" | "gauge"
  w=1 → half width,  w=2 → full width
  query must NOT contain "from" or "to"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## QUERY FORMAT — EXACT REQUIRED STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### timeseries (w=1) — REQUIRES asset_id
{ "kind": "timeseries", "asset_id": "${exAssetId}", "namespace": "${exNs}", "metric": "${exMetric}" }

### timeseries_multi (w=2) — REQUIRES series array with asset_id per entry
{
  "kind": "timeseries_multi",
  "series": ${JSON.stringify(multiSeries, null, 2).replace(/\n/g, '\n  ')}
}

### kpi (w=1) — latest value, REQUIRES asset_id (same query as timeseries)
{ "kind": "timeseries", "asset_id": "${exAssetId}", "namespace": "${exNs}", "metric": "${exMetric}" }

### gauge (w=1) — half-donut gauge, color-coded by value percentage; REQUIRES asset_id + min + max
{ "kind": "timeseries", "asset_id": "${exAssetId}", "namespace": "${exNs}", "metric": "${exMetric}", "min": 0, "max": 100 }
  # Use gauge for percentage-like metrics (CPU %, disk %, latency ms with known ceiling)
  # min/max set the display range: green=0-50%, yellow=50-75%, red=75-100%

### events (w=1 or w=2) — event feed table
{ "kind": "events", "namespace": "${evNsLabel}", "limit": 20 }

  # With kind filter (when event kinds are available):
  { "kind": "events", "namespace": "${evNsLabel}"${evKindFilter}, "limit": 20 }

  # With severity filter (for security dashboards):
  { "kind": "events", "namespace": "${evNsLabel}"${evSevFilter}, "limit": 50 }

  # Per specific agent:
  { "kind": "events", "namespace": "${evNsLabel}"${evAgentFilter}, "limit": 20 }

### eps (w=2) — events-per-second line chart
{ "kind": "event_count", "namespace": "${evNsLabel}" }

  # Per specific agent (if agents are available):
  { "kind": "event_count", "namespace": "${evNsLabel}"${evAgentFilter} }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## WAZUH DASHBOARD GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For Wazuh security monitoring use these widget combinations:
- eps (w=2): global EPS + per-agent EPS for each known agent
- events (w=2): all events, or filtered by severity=["high","critical"]
- events (w=1): per-agent feed using asset_id from the agent list above
- events (w=2): specific event kinds (e.g. fortigate firewall logs)
- kpi (w=1): total event count is NOT available as a KPI — use eps instead

Wazuh severities: critical > high > medium > low > info
Use severities=["high","critical"] for security-critical feeds.
Use severities=["medium","high","critical"] for broader monitoring.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## RULES (NEVER VIOLATE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Return ONLY the JSON object — no markdown fences, no text outside JSON
2. NEVER include "from" or "to" in any query
3. timeseries, kpi and gauge MUST have "asset_id" — use real asset_ids from the catalog
3b. gauge MUST have "min" and "max" numeric fields (e.g. 0/100 for percentages)
4. timeseries_multi MUST have "series" array — each entry MUST have asset_id+namespace+metric+label
5. eps query.kind MUST be "event_count"
6. events query.kind MUST be "events"
7. Use only asset_ids that appear in the catalog above
8. Use only metric names that appear in the catalog above
9. Use only namespace values that appear in the catalog above
`;
}

// ─── Smart Dashboard HTML prompt ─────────────────────────────────────────────

function buildSmartDashboardPrompt(
  assetMetrics: AssetMetric[],
  assetNames:   Map<string, string>,
  eventNsStats: EventNsStat[],
  eventKinds:   EventKindStat[],
  eventAgents:  EventAgentStat[],
  eventSevs:    EventSevStat[],
): string {

  // Build metric catalog
  const byAsset = new Map<string, { namespace: string; metric: string; pts: number }[]>();
  for (const am of assetMetrics) {
    const arr = byAsset.get(am.asset_id) ?? [];
    arr.push({ namespace: am.namespace, metric: am.metric, pts: am.pts });
    byAsset.set(am.asset_id, arr);
  }

  let metricCatalog = '';
  if (byAsset.size === 0) {
    metricCatalog = '  (no metrics registered yet)';
  } else {
    const lines: string[] = [];
    for (const [assetId, mets] of byAsset) {
      const label = assetNames.get(assetId) ?? assetId;
      lines.push(`  Asset: ${assetId}  (${label})`);
      for (const m of mets.slice(0, 20)) {
        lines.push(`    - namespace=${m.namespace}  metric=${m.metric}  (${m.pts} points)`);
      }
    }
    metricCatalog = lines.join('\n');
  }

  // Build event catalog
  let eventCatalog = '';
  if (eventNsStats.length === 0) {
    eventCatalog = '  (no events registered yet)';
  } else {
    const lines: string[] = [];
    for (const ns of eventNsStats) {
      lines.push(`  Namespace: ${ns.namespace}  (${ns.total.toLocaleString()} events, last: ${ns.last_seen ?? 'never'})`);
      const kinds = eventKinds.filter(k => k.namespace === ns.namespace);
      if (kinds.length) lines.push(`    Kinds: ${kinds.map(k => `${k.kind}(${k.cnt})`).join(', ')}`);
      const agents = eventAgents.filter(a => a.namespace === ns.namespace);
      if (agents.length) lines.push(`    Agents: ${agents.map(a => `${a.asset_id}(${a.cnt})`).join(', ')}`);
      const sevs = eventSevs.filter(s => s.namespace === ns.namespace);
      if (sevs.length) lines.push(`    Severities: ${sevs.map(s => `${s.severity}(${s.cnt})`).join(', ')}`);
    }
    eventCatalog = lines.join('\n');
  }

  return `You are an ELITE web designer AI for orbit-core observability dashboards.
You create STUNNING, PRODUCTION-READY HTML pages with embedded CSS and JS that visualize real-time monitoring data.
Your pages look like premium SaaS dashboards — Datadog, Grafana Cloud, New Relic level quality.

OUTPUT: Return ONLY a valid JSON object:
{ "name": "Dashboard Name", "description": "One-line description", "html": "<!DOCTYPE html>..." }

═══════════════════════════════════════════════════════
 DATA CATALOG — REAL DATA FROM THIS INSTANCE
═══════════════════════════════════════════════════════

METRICS (asset_id → namespace → metric):
${metricCatalog}

EVENTS (namespace → kinds / agents / severities):
${eventCatalog}

IMPORTANT: Use ONLY the asset_ids, namespaces, metrics and event kinds listed above. Never invent data.

═══════════════════════════════════════════════════════
 QUERY API — HOW TO FETCH DATA
═══════════════════════════════════════════════════════

All data is fetched via POST to the query endpoint.
Runtime variables are injected into the page before it loads:
  window.__ORBIT_BASE_URL__  — e.g. "https://prod.example.com/orbit-core"
  window.__ORBIT_API_KEY__   — authentication key
  window.__ORBIT_FROM__      — ISO 8601 start time
  window.__ORBIT_TO__        — ISO 8601 end time

─── MANDATORY BOILERPLATE (copy exactly as-is into your <script>) ───

async function query(body) {
  try {
    const res = await fetch(window.__ORBIT_BASE_URL__ + '/api/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': window.__ORBIT_API_KEY__ },
      body: JSON.stringify(Object.assign({}, body, { from: window.__ORBIT_FROM__, to: window.__ORBIT_TO__ }))
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    console.error('[orbit] query error:', e);
    return { ok: false, error: String(e) };
  }
}

─── QUERY KINDS AND RESPONSE SHAPES ───

1. TIMESERIES — single metric over time
   Query:    { kind: "timeseries", asset_id: "host:xxx", namespace: "nagios", metric: "load1" }
   Response: { ok: true, data: [ { ts: "2025-01-01T00:00:00Z", value: 1.23 }, ... ] }

2. TIMESERIES_MULTI — multiple series overlaid (for comparison charts)
   Query:    { kind: "timeseries_multi", series: [
                { asset_id: "host:a", namespace: "nagios", metric: "load1", label: "Server A" },
                { asset_id: "host:b", namespace: "nagios", metric: "load1", label: "Server B" }
              ] }
   Response: { ok: true, data: { "Server A": [{ ts, value }], "Server B": [{ ts, value }] } }

3. EVENTS — event feed (security alerts, logs, connections)
   Query:    { kind: "events", namespace: "wazuh", limit: 100 }
   Optional: asset_id, severities: ["high","critical"], kinds: ["firewall"]
   Response: { ok: true, data: [{ ts, asset_id, kind, severity, title, message }] }

4. EVENT_COUNT — event volume over time (EPS charts)
   Query:    { kind: "event_count", namespace: "wazuh" }
   Optional: asset_id, severities
   Response: { ok: true, data: [{ ts: "...", count: 42 }] }

═══════════════════════════════════════════════════════
 DESIGN SYSTEM — ORBIT CORE DARK THEME
═══════════════════════════════════════════════════════

COLORS:
  --bg-main: #040713        --bg-card: #0a0e1a       --bg-elevated: #111827
  --text-primary: #e5e7eb   --text-secondary: #9ca3af --text-muted: #6b7280
  --accent-cyan: #55f3ff    --accent-purple: #9b7cff  --accent-blue: #3b82f6
  --green: #10b981          --yellow: #f59e0b         --red: #ef4444
  --sev-critical: #ef4444   --sev-high: #f97316       --sev-medium: #eab308
  --sev-low: #3b82f6        --sev-info: #6b7280

CHART PALETTE (use these in order for multi-series):
  ['#55f3ff','#9b7cff','#3b82f6','#10b981','#f59e0b','#ef4444','#ec4899','#a78bfa']

TYPOGRAPHY: font-family: system-ui, -apple-system, sans-serif
BORDERS: 1px solid rgba(255,255,255,0.06); border-radius: 12px (cards), 8px (small)
BODY: background: transparent (the parent container handles the background)

═══════════════════════════════════════════════════════
 PROVEN CODE PATTERNS — USE THESE EXACTLY
═══════════════════════════════════════════════════════

─── PATTERN 1: LINE CHART (Canvas 2D) ───
Works for timeseries and event_count data.

function drawLineChart(canvas, datasets, options = {}) {
  // datasets = [{ label, data: [{ts,value}], color }]
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.parentElement.clientWidth;
  const H = canvas.height = options.height || 200;
  const pad = { top: 10, right: 10, bottom: 30, left: 50 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;
  ctx.clearRect(0, 0, W, H);

  // Compute global min/max
  let allVals = datasets.flatMap(d => d.data.map(p => p.value));
  let allTs = datasets.flatMap(d => d.data.map(p => new Date(p.ts).getTime()));
  if (!allVals.length) { ctx.fillStyle='#6b7280'; ctx.font='13px system-ui'; ctx.fillText('No data',W/2-25,H/2); return; }
  let minV = Math.min(...allVals), maxV = Math.max(...allVals);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  let minT = Math.min(...allTs), maxT = Math.max(...allTs);
  if (minT === maxT) { minT -= 1000; maxT += 1000; }

  // Y-axis labels
  ctx.fillStyle = '#6b7280'; ctx.font = '11px system-ui'; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = minV + (maxV - minV) * (1 - i / 4);
    const y = pad.top + (i / 4) * ch;
    ctx.fillText(v >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(1), pad.left - 6, y + 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.beginPath();
    ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke();
  }

  // X-axis labels
  ctx.textAlign = 'center';
  const steps = Math.min(6, Math.floor(cw / 80));
  for (let i = 0; i <= steps; i++) {
    const t = minT + (maxT - minT) * (i / steps);
    const x = pad.left + (i / steps) * cw;
    const d = new Date(t);
    ctx.fillText(d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0'), x, H - 6);
  }

  // Draw each dataset
  datasets.forEach((ds, di) => {
    if (!ds.data.length) return;
    const sorted = [...ds.data].sort((a,b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    ctx.beginPath(); ctx.strokeStyle = ds.color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    sorted.forEach((p, i) => {
      const x = pad.left + ((new Date(p.ts).getTime() - minT) / (maxT - minT)) * cw;
      const y = pad.top + ((maxV - p.value) / (maxV - minV)) * ch;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill area under line with gradient
    if (options.fill !== false) {
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
      grad.addColorStop(0, ds.color + '30'); grad.addColorStop(1, ds.color + '00');
      const last = sorted[sorted.length - 1];
      const lastX = pad.left + ((new Date(last.ts).getTime() - minT) / (maxT - minT)) * cw;
      ctx.lineTo(lastX, pad.top + ch); ctx.lineTo(pad.left + ((new Date(sorted[0].ts).getTime() - minT) / (maxT - minT)) * cw, pad.top + ch);
      ctx.fillStyle = grad; ctx.fill();
    }
  });

  // Legend
  if (datasets.length > 1) {
    let lx = pad.left;
    datasets.forEach(ds => {
      ctx.fillStyle = ds.color; ctx.fillRect(lx, H - 18, 10, 3); ctx.fillStyle = '#9ca3af';
      ctx.font = '10px system-ui'; ctx.textAlign = 'left';
      ctx.fillText(ds.label, lx + 14, H - 14); lx += ctx.measureText(ds.label).width + 30;
    });
  }
}

─── PATTERN 2: GAUGE (SVG) ───
For percentage metrics (cpu.usage_pct, memory.usage_pct, disk.usage_pct).

function createGaugeSVG(container, value, max, label, unit) {
  const pct = Math.min(value / max, 1);
  const color = pct < 0.5 ? '#10b981' : pct < 0.75 ? '#f59e0b' : '#ef4444';
  const r = 60, cx = 70, cy = 70, sw = 10;
  const startAngle = Math.PI * 0.75, endAngle = Math.PI * 2.25;
  const valAngle = startAngle + (endAngle - startAngle) * pct;
  function arc(angle) { return (cx + r * Math.cos(angle)) + ',' + (cy + r * Math.sin(angle)); }
  const bgD = 'M' + arc(startAngle) + ' A' + r + ',' + r + ' 0 1 1 ' + arc(endAngle);
  const large = (valAngle - startAngle) > Math.PI ? 1 : 0;
  const valD = 'M' + arc(startAngle) + ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + arc(valAngle);
  container.innerHTML =
    '<svg viewBox="0 0 140 100" style="width:100%;max-width:180px">' +
    '<path d="' + bgD + '" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="' + sw + '" stroke-linecap="round"/>' +
    '<path d="' + valD + '" fill="none" stroke="' + color + '" stroke-width="' + sw + '" stroke-linecap="round"/>' +
    '<text x="70" y="68" text-anchor="middle" fill="' + color + '" font-size="22" font-weight="700" font-family="system-ui">' + value.toFixed(1) + '</text>' +
    '<text x="70" y="84" text-anchor="middle" fill="#6b7280" font-size="10" font-family="system-ui">' + (unit || '%') + '</text>' +
    '</svg>' +
    '<div style="text-align:center;font-size:11px;color:#9ca3af;margin-top:4px">' + label + '</div>';
}

─── PATTERN 3: KPI CARD ───
Big number with optional trend arrow.

function renderKPI(container, value, label, unit, prevValue) {
  const formatted = value >= 1000000 ? (value/1000000).toFixed(1)+'M' : value >= 1000 ? (value/1000).toFixed(1)+'k' : value.toFixed(1);
  let trend = '';
  if (prevValue !== undefined && prevValue !== null) {
    const delta = ((value - prevValue) / (prevValue || 1)) * 100;
    const arrow = delta >= 0 ? '↑' : '↓';
    const tColor = delta >= 0 ? '#10b981' : '#ef4444';
    trend = '<span style="font-size:12px;color:' + tColor + '">' + arrow + Math.abs(delta).toFixed(1) + '%</span>';
  }
  container.innerHTML = '<div style="font-size:32px;font-weight:800;color:#e5e7eb;line-height:1">' + formatted +
    '<span style="font-size:14px;color:#6b7280;margin-left:4px">' + (unit||'') + '</span></div>' +
    trend + '<div style="font-size:11px;color:#9ca3af;margin-top:6px">' + label + '</div>';
}

─── PATTERN 4: EVENT TABLE ───

function renderEventTable(container, events) {
  if (!events.length) { container.innerHTML = '<div style="color:#6b7280;padding:20px;text-align:center">No events</div>'; return; }
  const sevColor = {critical:'#ef4444',high:'#f97316',medium:'#eab308',low:'#3b82f6',info:'#6b7280'};
  const sevBg = {critical:'#450a0a',high:'#431407',medium:'#451a03',low:'#172554',info:'#1f2937'};
  let html = '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>';
  ['Time','Asset','Severity','Title'].forEach(h => html += '<th style="text-align:left;padding:8px 6px;color:#6b7280;border-bottom:1px solid rgba(255,255,255,0.06)">' + h + '</th>');
  html += '</tr></thead><tbody>';
  events.slice(0, 50).forEach(ev => {
    const t = new Date(ev.ts);
    const time = t.getHours().toString().padStart(2,'0') + ':' + t.getMinutes().toString().padStart(2,'0') + ':' + t.getSeconds().toString().padStart(2,'0');
    const sev = ev.severity || 'info';
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.03)">';
    html += '<td style="padding:6px;color:#9ca3af;white-space:nowrap">' + time + '</td>';
    html += '<td style="padding:6px;color:#9ca3af">' + (ev.asset_id||'-') + '</td>';
    html += '<td style="padding:6px"><span style="background:' + (sevBg[sev]||'#1f2937') + ';color:' + (sevColor[sev]||'#6b7280') + ';padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase">' + sev + '</span></td>';
    html += '<td style="padding:6px;color:#e5e7eb;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (ev.title||'') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

─── PATTERN 5: BAR CHART (Canvas 2D) ───
For event_count / EPS data: [{ts, count}]

function drawBarChart(canvas, data, color, options = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.parentElement.clientWidth;
  const H = canvas.height = options.height || 160;
  const pad = { top: 10, right: 10, bottom: 30, left: 45 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;
  ctx.clearRect(0, 0, W, H);
  if (!data.length) { ctx.fillStyle='#6b7280'; ctx.font='13px system-ui'; ctx.fillText('No data',W/2-25,H/2); return; }
  const maxV = Math.max(...data.map(d => d.count || d.value || 0), 1);
  const barW = Math.max(1, (cw / data.length) - 1);
  data.forEach((d, i) => {
    const v = d.count || d.value || 0;
    const bh = (v / maxV) * ch;
    const x = pad.left + (i / data.length) * cw;
    const y = pad.top + ch - bh;
    ctx.fillStyle = color + 'cc'; ctx.fillRect(x, y, barW, bh);
  });
  // Y-axis
  ctx.fillStyle = '#6b7280'; ctx.font = '10px system-ui'; ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++) {
    const v = maxV * (1 - i/3);
    ctx.fillText(v >= 1000 ? (v/1000).toFixed(0)+'k' : Math.round(v).toString(), pad.left - 4, pad.top + (i/3)*ch + 4);
  }
}

─── PATTERN 6: DONUT CHART (Canvas 2D) ───

function drawDonut(canvas, slices, options = {}) {
  // slices = [{ label, value, color }]
  const ctx = canvas.getContext('2d');
  const S = options.size || 160;
  canvas.width = S; canvas.height = S;
  const cx = S/2, cy = S/2, r = S/2 - 15, inner = r * 0.6;
  const total = slices.reduce((s,d) => s + d.value, 0);
  if (!total) { ctx.fillStyle='#6b7280'; ctx.font='12px system-ui'; ctx.textAlign='center'; ctx.fillText('No data',cx,cy); return; }
  let angle = -Math.PI / 2;
  slices.forEach(s => {
    const sweep = (s.value / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx + inner * Math.cos(angle), cy + inner * Math.sin(angle));
    ctx.arc(cx, cy, r, angle, angle + sweep); ctx.arc(cx, cy, inner, angle + sweep, angle, true);
    ctx.fillStyle = s.color; ctx.fill();
    angle += sweep;
  });
  // Center total
  ctx.fillStyle = '#e5e7eb'; ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(total >= 1000 ? (total/1000).toFixed(1)+'k' : total.toString(), cx, cy + 2);
  ctx.fillStyle = '#6b7280'; ctx.font = '10px system-ui';
  ctx.fillText('total', cx, cy + 16);
}

═══════════════════════════════════════════════════════
 PAGE STRUCTURE TEMPLATE — FOLLOW THIS SKELETON
═══════════════════════════════════════════════════════

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard Name</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: transparent; font-family: system-ui, -apple-system, sans-serif; color: #e5e7eb; padding: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .card { background: #0a0e1a; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 20px; animation: fadeIn 0.4s ease; }
  .card:hover { border-color: rgba(85,243,255,0.15); }
  .card-title { font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
  .card-wide { grid-column: span 2; }
  .shimmer { height: 160px; background: linear-gradient(90deg,#111827 25%,#1a2235 50%,#111827 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px; }
  @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
  @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  .error { color: #ef4444; font-size: 12px; padding: 12px; }
  canvas { display: block; }
  @media (max-width: 700px) { .card-wide { grid-column: span 1; } .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="grid" id="grid">
  <!-- Cards are created dynamically by JS -->
</div>
<script>
  // 1. Paste the query() function from above EXACTLY
  // 2. Paste the drawing functions you need
  // 3. Create cards, fetch data, render
  // 4. Set up auto-refresh: setInterval(refresh, 30000);
</script>
</body>
</html>

═══════════════════════════════════════════════════════
 SMART DATA → VISUALIZATION MAPPING
═══════════════════════════════════════════════════════

Look at the user's request + the catalog and AUTOMATICALLY choose:
- metric with "usage_pct" or "%" → GAUGE (createGaugeSVG)
- metric timeseries over time → LINE CHART (drawLineChart) — use area fill for single series
- multiple metrics same type, different hosts → MULTI-LINE CHART (timeseries_multi query)
- current value / latest reading → KPI CARD (renderKPI) with last 2 points for trend
- event feed / security alerts → EVENT TABLE (renderEventTable)
- events per second / volume → BAR CHART (drawBarChart) with event_count query
- severity distribution → DONUT CHART (drawDonut)
- comparisons between hosts → grouped KPI cards or multi-line chart

═══════════════════════════════════════════════════════
 RULES — NEVER VIOLATE
═══════════════════════════════════════════════════════

1. Output ONLY valid JSON: { "name": "...", "description": "...", "html": "..." }
2. html MUST be a complete HTML page starting with <!DOCTYPE html>
3. ZERO external dependencies — NO CDN, NO libraries. Everything inline.
4. The query() function MUST be declared with "async" keyword. Always "async function query(...)".
5. ALL functions that call query() MUST also be "async" and use "await query(...)".
6. Use ONLY asset_ids, namespaces, metrics from the catalog above. NEVER invent data.
7. ALWAYS include: loading states (shimmer), error handling, auto-refresh (30s), responsive grid.
8. body background MUST be transparent.
9. Use the EXACT drawing functions from the patterns above — they are TESTED and WORKING.
10. Keep HTML under 800 lines total.
`;
}
