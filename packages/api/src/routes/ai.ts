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
