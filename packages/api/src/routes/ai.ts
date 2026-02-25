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
