import { Router } from 'express';
import type { Pool } from 'pg';
import { DashboardSpecSchema } from '@orbit/core-contracts';

// ─── RAG Catalog Types ───────────────────────────────────────────────────────

interface RagAsset {
  asset_id: string;
  type:     string;
  name:     string;
  enabled:  boolean;
  last_seen: string;
}

interface RagMetric {
  asset_id:   string;
  namespace:  string;
  metric:     string;
  pts:        number;
  val_min:    number;
  val_max:    number;
  last_value: number;
  unit:       string | null;
}

interface RagEventNs {
  namespace: string;
  total:     number;
  last_seen: string | null;
  kinds:     string[];
  agents:    string[];
  severities: Array<{ severity: string; cnt: number }>;
}

interface RagConnector {
  id:          string;
  source_id:   string;
  mode:        string;
  type:        string;
  status:      string;
  description: string | null;
}

interface RagCatalog {
  generated_at: string;
  assets:       RagAsset[];
  metrics:      RagMetric[];
  events:       RagEventNs[];
  connectors:   RagConnector[];
}

// ─── RAG Cache ───────────────────────────────────────────────────────────────

const RAG_TTL_MS = 5 * 60 * 1000; // 5 minutes
let ragCache: { data: RagCatalog; ts: number } | null = null;

async function buildRagCatalog(pool: Pool): Promise<RagCatalog> {
  const [assetsR, metricsR, evNsR, evKindsR, evAgentsR, evSevsR, connectorsR] = await Promise.all([
    // Assets
    pool.query<RagAsset>(
      `SELECT asset_id, type, name, enabled, last_seen::text
       FROM assets ORDER BY last_seen DESC LIMIT 200`
    ),
    // Metrics with value ranges and unit (last 7 days for performance)
    pool.query<RagMetric>(
      `SELECT asset_id, namespace, metric,
              count(*)::int AS pts,
              min(value)::float AS val_min,
              max(value)::float AS val_max,
              (ARRAY_AGG(value ORDER BY ts DESC))[1]::float AS last_value,
              (ARRAY_AGG(unit ORDER BY ts DESC))[1] AS unit
       FROM metric_points
       WHERE ts > now() - interval '7 days'
       GROUP BY asset_id, namespace, metric
       ORDER BY pts DESC
       LIMIT 500`
    ),
    // Event namespace stats
    pool.query<{ namespace: string; total: number; last_seen: string | null }>(
      `SELECT namespace, count(*)::int AS total, max(ts)::text AS last_seen
       FROM orbit_events
       GROUP BY namespace ORDER BY total DESC LIMIT 20`
    ),
    // Event kinds per namespace
    pool.query<{ namespace: string; kind: string; cnt: number }>(
      `SELECT namespace, kind, count(*)::int AS cnt
       FROM orbit_events GROUP BY namespace, kind ORDER BY cnt DESC LIMIT 100`
    ),
    // Event agents per namespace
    pool.query<{ namespace: string; asset_id: string; cnt: number }>(
      `SELECT namespace, asset_id, count(*)::int AS cnt
       FROM orbit_events GROUP BY namespace, asset_id ORDER BY cnt DESC LIMIT 100`
    ),
    // Severity distribution
    pool.query<{ namespace: string; severity: string; cnt: number }>(
      `SELECT namespace, severity, count(*)::int AS cnt
       FROM orbit_events GROUP BY namespace, severity ORDER BY namespace, cnt DESC`
    ),
    // Connectors
    pool.query<RagConnector>(
      `SELECT id, source_id, mode, type, status, description
       FROM connector_specs ORDER BY created_at DESC`
    ).catch(() => ({ rows: [] as RagConnector[] })),
  ]);

  // Assemble event namespaces with nested kinds/agents/sevs
  const events: RagEventNs[] = evNsR.rows.map(ns => ({
    namespace:  ns.namespace,
    total:      ns.total,
    last_seen:  ns.last_seen,
    kinds:      evKindsR.rows.filter(k => k.namespace === ns.namespace).map(k => k.kind),
    agents:     evAgentsR.rows.filter(a => a.namespace === ns.namespace).map(a => a.asset_id),
    severities: evSevsR.rows.filter(s => s.namespace === ns.namespace).map(s => ({ severity: s.severity, cnt: s.cnt })),
  }));

  return {
    generated_at: new Date().toISOString(),
    assets:       assetsR.rows,
    metrics:      metricsR.rows,
    events,
    connectors:   connectorsR.rows,
  };
}

async function getRagCatalog(pool: Pool): Promise<RagCatalog> {
  const now = Date.now();
  if (ragCache && (now - ragCache.ts) < RAG_TTL_MS) return ragCache.data;
  const data = await buildRagCatalog(pool);
  ragCache = { data, ts: now };
  return data;
}

// ─── Prompt Builders ─────────────────────────────────────────────────────────

function formatMetricCatalog(catalog: RagCatalog): string {
  const assetMap = new Map(catalog.assets.map(a => [a.asset_id, a.name]));

  // Group metrics by asset
  const byAsset = new Map<string, RagMetric[]>();
  for (const m of catalog.metrics) {
    const arr = byAsset.get(m.asset_id) ?? [];
    arr.push(m);
    byAsset.set(m.asset_id, arr);
  }

  if (byAsset.size === 0) return '  (no metrics registered yet)';

  const lines: string[] = [];
  for (const [assetId, mets] of byAsset) {
    const label = assetMap.get(assetId) ?? assetId;
    const asset = catalog.assets.find(a => a.asset_id === assetId);
    const typeStr = asset ? ` [${asset.type}]` : '';
    lines.push(`  Asset: ${assetId}  (${label})${typeStr}`);
    for (const m of mets.slice(0, 20)) {
      const unitStr = m.unit ? `, unit: ${m.unit}` : '';
      const rangeStr = m.val_min !== null ? `, range: ${round2(m.val_min)}–${round2(m.val_max)}, last: ${round2(m.last_value)}` : '';
      lines.push(`    - namespace=${m.namespace}  metric=${m.metric}  (${m.pts} pts${rangeStr}${unitStr})`);
    }
  }
  return lines.join('\n');
}

function formatEventCatalog(catalog: RagCatalog): string {
  if (catalog.events.length === 0) return '  (no events registered yet)';

  const lines: string[] = [];
  for (const ns of catalog.events) {
    lines.push(`  Namespace: ${ns.namespace}  (${ns.total.toLocaleString()} events, last: ${ns.last_seen ?? 'never'})`);
    if (ns.kinds.length) lines.push(`    Kinds: ${ns.kinds.join(', ')}`);
    if (ns.agents.length) lines.push(`    Agents: ${ns.agents.join(', ')}`);
    if (ns.severities.length) lines.push(`    Severities: ${ns.severities.map(s => `${s.severity}(${s.cnt})`).join(', ')}`);
  }
  return lines.join('\n');
}

function formatConnectorCatalog(catalog: RagCatalog): string {
  if (catalog.connectors.length === 0) return '  (no connectors configured)';
  return catalog.connectors
    .map(c => `  - ${c.id} (${c.mode}, ${c.type}, ${c.status})${c.description ? ' — ' + c.description : ''}`)
    .join('\n');
}

function round2(n: number): string {
  return Number.isFinite(n) ? (Math.round(n * 100) / 100).toString() : '?';
}

function pickExamples(catalog: RagCatalog) {
  const assetMap = new Map(catalog.assets.map(a => [a.asset_id, a.name]));
  const first = catalog.metrics[0];
  const exAssetId = first?.asset_id ?? 'host:server1';
  const exNs      = first?.namespace ?? 'nagios';
  const exMetric  = first?.metric    ?? 'load1';

  // Multi-series: up to 3 distinct assets sharing same namespace+metric
  const distinctAssets = [...new Set(catalog.metrics.map(m => m.asset_id))].slice(0, 3);
  const multiSeries = distinctAssets.map(aid => ({
    asset_id:  aid,
    namespace: exNs,
    metric:    catalog.metrics.find(m => m.asset_id === aid && m.namespace === exNs)?.metric ?? exMetric,
    label:     assetMap.get(aid) ?? aid,
  }));

  // Event examples
  const firstEvNs     = catalog.events[0]?.namespace ?? 'wazuh';
  const firstEvKind   = catalog.events[0]?.kinds[0];
  const firstEvAgent  = catalog.events[0]?.agents[0];
  const highSev       = catalog.events[0]?.severities.some(s => s.severity === 'high' || s.severity === 'critical');

  return { exAssetId, exNs, exMetric, multiSeries, firstEvNs, firstEvKind, firstEvAgent, highSev };
}

// ─── ALLOWED DATA LIST (for strict validation prompt section) ────────────────

function buildAllowedList(catalog: RagCatalog): string {
  const assetIds  = [...new Set(catalog.metrics.map(m => m.asset_id))];
  const namespaces = [...new Set([
    ...catalog.metrics.map(m => m.namespace),
    ...catalog.events.map(e => e.namespace),
  ])];
  const metricNames = [...new Set(catalog.metrics.map(m => m.metric))];

  return `
ALLOWED asset_ids (use ONLY these): ${assetIds.join(', ') || 'none'}
ALLOWED namespaces (use ONLY these): ${namespaces.join(', ') || 'none'}
ALLOWED metric names (use ONLY these): ${metricNames.join(', ') || 'none'}
ALLOWED event kinds: ${catalog.events.flatMap(e => e.kinds).join(', ') || 'none'}
`;
}

// ─── System Prompt: Dashboard Spec ───────────────────────────────────────────

function buildSystemPrompt(catalog: RagCatalog): string {
  const metricCatalog = formatMetricCatalog(catalog);
  const eventCatalog  = formatEventCatalog(catalog);
  const connCatalog   = formatConnectorCatalog(catalog);
  const allowed       = buildAllowedList(catalog);
  const ex = pickExamples(catalog);

  const evKindFilter  = ex.firstEvKind  ? `, "kinds": ["${ex.firstEvKind}"]` : '';
  const evAgentFilter = ex.firstEvAgent ? `, "asset_id": "${ex.firstEvAgent}"` : '';
  const evSevFilter   = ex.highSev      ? `, "severities": ["high", "critical"]` : '';

  return `You are an orbit-core Dashboard Builder AI. Output ONLY a single valid JSON object (no markdown, no explanation).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## METRIC CATALOG (asset → namespace → metric with value ranges)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${metricCatalog}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EVENT CATALOG (namespace → kinds / agents / severities)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${eventCatalog}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ACTIVE CONNECTORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${connCatalog}

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
{ "kind": "timeseries", "asset_id": "${ex.exAssetId}", "namespace": "${ex.exNs}", "metric": "${ex.exMetric}" }

### timeseries_multi (w=2) — REQUIRES series array with asset_id per entry
{
  "kind": "timeseries_multi",
  "series": ${JSON.stringify(ex.multiSeries, null, 2).replace(/\n/g, '\n  ')}
}

### kpi (w=1) — latest value, REQUIRES asset_id (same query as timeseries)
{ "kind": "timeseries", "asset_id": "${ex.exAssetId}", "namespace": "${ex.exNs}", "metric": "${ex.exMetric}" }

### gauge (w=1) — use val_min/val_max from catalog for min/max; if unit=% use 0/100
{ "kind": "timeseries", "asset_id": "${ex.exAssetId}", "namespace": "${ex.exNs}", "metric": "${ex.exMetric}", "min": 0, "max": 100 }

### events (w=1 or w=2)
{ "kind": "events", "namespace": "${ex.firstEvNs}", "limit": 20 }
{ "kind": "events", "namespace": "${ex.firstEvNs}"${evKindFilter}, "limit": 20 }
{ "kind": "events", "namespace": "${ex.firstEvNs}"${evSevFilter}, "limit": 50 }
{ "kind": "events", "namespace": "${ex.firstEvNs}"${evAgentFilter}, "limit": 20 }

### eps (w=2) — events-per-second line chart
{ "kind": "event_count", "namespace": "${ex.firstEvNs}" }
{ "kind": "event_count", "namespace": "${ex.firstEvNs}"${evAgentFilter} }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STRICT DATA RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${allowed}

CRITICAL CONSTRAINTS:
1. Return ONLY the JSON object — no markdown fences, no text outside JSON
2. NEVER include "from" or "to" in any query
3. timeseries, kpi and gauge MUST have "asset_id" — use ONLY asset_ids from the list above
4. gauge MUST have "min" and "max" — use value ranges from the catalog
5. timeseries_multi MUST have "series" array — each entry MUST have asset_id+namespace+metric+label
6. eps query.kind MUST be "event_count"
7. events query.kind MUST be "events"
8. NEVER invent or guess asset_ids, metrics, or namespaces. If the user asks for data that does not exist, use the closest available match and explain in the dashboard description.
9. If there are no metrics or events available, create an empty dashboard with a description explaining no data is available.
`;
}

// ─── System Prompt: Smart Dashboard HTML ─────────────────────────────────────

function buildSmartDashboardPrompt(catalog: RagCatalog): string {
  const metricCatalog = formatMetricCatalog(catalog);
  const eventCatalog  = formatEventCatalog(catalog);
  const connCatalog   = formatConnectorCatalog(catalog);
  const allowed       = buildAllowedList(catalog);

  return `You are a dashboard designer for orbit-core. You generate lightweight HTML pages that use the OrbitViz SDK to render charts.

OUTPUT: Return ONLY a valid JSON object:
{ "name": "Dashboard Name", "description": "One-line description", "html": "<!DOCTYPE html>..." }

═══════════════════════════════════════════════════════
 DATA CATALOG — REAL DATA FROM THIS INSTANCE
═══════════════════════════════════════════════════════

METRICS (asset_id → namespace → metric with value ranges):
${metricCatalog}

EVENTS (namespace → kinds / agents / severities):
${eventCatalog}

CONNECTORS:
${connCatalog}

═══════════════════════════════════════════════════════
 STRICT DATA VALIDATION
═══════════════════════════════════════════════════════
${allowed}

You MUST ONLY use identifiers from the lists above.
If the user asks for data that does not exist, pick the closest match and note it in the description.

═══════════════════════════════════════════════════════
 OrbitViz SDK — VISUALIZATION LIBRARY
═══════════════════════════════════════════════════════

The page loads orbit-viz.js automatically (injected by the host). It provides window.OrbitViz.
OrbitViz.init() is called automatically with baseUrl, apiKey, from, to — you do NOT need to call it.

── AVAILABLE METHODS ──

Each method takes a CSS selector and an options object. The library handles:
  - querying the orbit-core API
  - rendering (Canvas 2D, SVG, or DOM)
  - auto-refresh every 30s
  - loading spinners and error states
  - DPR-aware canvas scaling
  - card wrapper with title and unit label

1. OrbitViz.line(selector, opts)
   Timeseries line chart (with area fill). For metrics over time.
   opts: { metric, asset, namespace, title, unit, color, height }

2. OrbitViz.area(selector, opts)
   Same as line() but always with area fill.

3. OrbitViz.multiLine(selector, opts)
   Multi-series line chart comparing metrics across assets.
   opts: { series: [{ asset_id, namespace, metric, label }], title, unit, colors, height }

4. OrbitViz.bar(selector, opts)
   Bar chart comparing multiple metrics (last value).
   opts: { metrics: [{ metric, asset, namespace, label }], title, unit, colors, height }

5. OrbitViz.gauge(selector, opts)
   Gauge arc for percentage values. Auto-colors by range.
   opts: { metric, asset, namespace, title, unit, max, size }
   Use val_min/val_max from catalog for gauge range. If unit=%, use max:100.

6. OrbitViz.kpi(selector, opts)
   Big number KPI card (latest value).
   opts: { metric, asset, namespace, title, unit, subtitle, color, aggregate, queryKind }

7. OrbitViz.events(selector, opts)
   Event table with severity badges.
   opts: { namespace, asset, severities, kinds, limit, title, height }

8. OrbitViz.eps(selector, opts)
   Events Per Second line chart.
   opts: { namespace, asset, severities, title, color, height }

9. OrbitViz.donut(selector, opts)
   Donut chart for event distribution.
   opts: { namespace, asset, groupBy, title, limit, items }
   groupBy: 'severity' (default), 'kind', 'asset_id'

10. OrbitViz.table(selector, opts)
    Alias for events().

11. OrbitViz.layout(selector, { cols, gap })
    Apply responsive CSS grid.

═══════════════════════════════════════════════════════
 DATA → VISUALIZATION MAPPING
═══════════════════════════════════════════════════════

Use the catalog above and AUTOMATICALLY choose:
- metric with "usage" or "pct" or "%" → gauge()
- metric over time → line() or area()
- multiple same metrics, different assets → multiLine()
- current/latest value → kpi()
- event feed / security alerts → events()
- events per second → eps()
- severity distribution → donut() with groupBy:'severity'
- event type distribution → donut() with groupBy:'kind'
- comparing values across metrics → bar()

═══════════════════════════════════════════════════════
 HTML TEMPLATE — FOLLOW THIS STRUCTURE
═══════════════════════════════════════════════════════

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard Name</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: transparent; font-family: 'Inter', system-ui, sans-serif; color: #e2e8f0; padding: 20px; }
  h1 { font-size: 18px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
  .wide { grid-column: span 2; }
  .full { grid-column: 1 / -1; }
</style>
</head>
<body>
<h1>Dashboard Title</h1>
<div class="grid">
  <div id="chart1"></div>
  <div id="chart2"></div>
  <div id="chart3"></div>
  <div id="chart4" class="wide"></div>
</div>
<script>
  OrbitViz.line('#chart1', { ... });
  OrbitViz.gauge('#chart2', { ... });
  OrbitViz.kpi('#chart3', { ... });
  OrbitViz.events('#chart4', { ... });
</script>
</body>
</html>

═══════════════════════════════════════════════════════
 RULES (NEVER VIOLATE)
═══════════════════════════════════════════════════════

1. Output ONLY valid JSON: { "name": "...", "description": "...", "html": "..." }
2. html MUST be a complete HTML page starting with <!DOCTYPE html>
3. NEVER write Canvas, SVG, or fetch() code manually. ALWAYS use OrbitViz.* methods.
4. OrbitViz.init() is called automatically — do NOT call it yourself.
5. Use ONLY asset_ids, namespaces, metrics from the ALLOWED lists above. NEVER invent data.
6. body background MUST be transparent.
7. Keep HTML under 200 lines — OrbitViz handles all rendering logic.
8. Use class="wide" for wider charts, class="full" for full-width.
9. Create a visually balanced dashboard with a mix of chart types appropriate to the data.
10. If the user asks for data that does not exist in the catalog, use the closest match and note it in the description.
`;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export function aiRouter(pool: Pool | null): Router {
  const r = Router();

  // ── RAG Catalog Endpoint ──────────────────────────────────────────────────
  r.get('/ai/rag', async (_req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'No database connection' });

    try {
      const catalog = await getRagCatalog(pool);
      const cached = ragCache !== null && (Date.now() - ragCache.ts) < 1000; // fresh if just built
      return res.json({ ok: true, cached: !cached, ...catalog });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Failed to build RAG catalog', detail: String(err) });
    }
  });

  // ── AI Plugin Generator ─────────────────────────────────────────────────
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

  // ── AI Dashboard Spec Generator ─────────────────────────────────────────
  r.post('/ai/dashboard', async (req, res) => {
    const aiKey   = req.headers['x-ai-key']   as string | undefined;
    const aiModel = req.headers['x-ai-model'] as string | undefined;

    if (!aiKey)   return res.status(400).json({ ok: false, error: 'Missing X-Ai-Key header' });
    if (!aiModel) return res.status(400).json({ ok: false, error: 'Missing X-Ai-Model header' });

    const { prompt } = (req.body ?? {}) as { prompt?: string };
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing prompt in body' });
    }

    // Fetch RAG catalog (cached)
    let catalog: RagCatalog = { generated_at: new Date().toISOString(), assets: [], metrics: [], events: [], connectors: [] };
    if (pool) {
      try { catalog = await getRagCatalog(pool); } catch { /* empty catalog fallback */ }
    }

    const systemPrompt = buildSystemPrompt(catalog);

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

  // ── AI Smart Dashboard (HTML/CSS/JS generator) ──────────────────────────
  r.post('/ai/smart-dashboard', async (req, res) => {
    const aiKey   = req.headers['x-ai-key']   as string | undefined;
    const aiModel = req.headers['x-ai-model'] as string | undefined;

    if (!aiKey)   return res.status(400).json({ ok: false, error: 'Missing X-Ai-Key header' });
    if (!aiModel) return res.status(400).json({ ok: false, error: 'Missing X-Ai-Model header' });

    const { prompt } = (req.body ?? {}) as { prompt?: string };
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      return res.status(400).json({ ok: false, error: 'Provide a prompt of at least 5 characters' });
    }

    // Fetch RAG catalog (cached)
    let catalog: RagCatalog = { generated_at: new Date().toISOString(), assets: [], metrics: [], events: [], connectors: [] };
    if (pool) {
      try { catalog = await getRagCatalog(pool); } catch { /* empty catalog fallback */ }
    }

    const systemPrompt = buildSmartDashboardPrompt(catalog);

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
      if (rawText.includes('<!DOCTYPE') || rawText.includes('<html')) {
        result = { html: rawText.trim(), name: 'AI Dashboard', description: prompt };
      } else {
        return res.status(502).json({ ok: false, error: 'AI returned invalid response', raw: rawText.slice(0, 500) });
      }
    }

    if (!result.html) {
      return res.status(502).json({ ok: false, error: 'AI returned no HTML', raw: rawText.slice(0, 500) });
    }

    return res.json({
      ok: true,
      html: result.html,
      name: result.name ?? 'AI Dashboard',
      description: result.description ?? prompt,
    });
  });

  // ── AI Alert Generator ───────────────────────────────────────────────────
  r.post('/ai/alerts', async (req, res) => {
    const aiKey   = req.headers['x-ai-key']   as string | undefined;
    const aiModel = req.headers['x-ai-model'] as string | undefined;

    if (!aiKey)   return res.status(400).json({ ok: false, error: 'Missing X-Ai-Key header' });
    if (!aiModel) return res.status(400).json({ ok: false, error: 'Missing X-Ai-Model header' });

    const { prompt } = (req.body ?? {}) as { prompt?: string };
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      return res.status(400).json({ ok: false, error: 'Provide a prompt of at least 5 characters' });
    }

    let catalog: RagCatalog = { generated_at: new Date().toISOString(), assets: [], metrics: [], events: [], connectors: [] };
    if (pool) {
      try { catalog = await getRagCatalog(pool); } catch { /* empty catalog fallback */ }
    }

    // Load existing channels so AI can reference them
    let channelList: Array<{ id: string; name: string; kind: string }> = [];
    if (pool) {
      try {
        const { rows } = await pool.query(`SELECT id, name, kind FROM alert_channels ORDER BY created_at`);
        channelList = rows;
      } catch { /* ignore */ }
    }

    const systemPrompt = buildAlertSystemPrompt(catalog, channelList);

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

    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1].trim() : rawText.trim();

    let result: unknown;
    try {
      result = JSON.parse(jsonText);
    } catch {
      return res.status(502).json({ ok: false, error: 'AI returned invalid JSON', raw: rawText.slice(0, 500) });
    }

    return res.json({ ok: true, result });
  });

  return r;
}

// ─── System Prompt: Alert Generator ──────────────────────────────────────────

function buildAlertSystemPrompt(catalog: RagCatalog, channels: Array<{ id: string; name: string; kind: string }>): string {
  const metricCatalog = formatMetricCatalog(catalog);
  const eventCatalog  = formatEventCatalog(catalog);
  const allowed       = buildAllowedList(catalog);

  const channelList = channels.length
    ? channels.map(c => `  - id="${c.id}" name="${c.name}" kind=${c.kind}`).join('\n')
    : '  (no channels configured yet — omit channels array or leave empty)';

  return `You are orbit-core Alert Builder AI. You generate alert rule configurations from natural language descriptions.

Output ONLY a valid JSON object (no markdown, no explanation):
{
  "rules": [
    {
      "name":      "Human-readable alert name",
      "asset_id":  "host:xxx" | null,
      "namespace": "nagios" | null,
      "metric":    "cpu" | null,
      "condition": {
        "kind": "threshold",
        "op": ">" | ">=" | "<" | "<=",
        "value": 80,
        "window_min": 5,
        "agg": "avg" | "max"
      },
      "severity": "info" | "low" | "medium" | "high" | "critical",
      "channels": ["channel-id-1"]
    }
  ],
  "summary": "Brief description of what was generated and why"
}

CONDITION TYPES:
1. threshold — fires when agg(metric) op value over window_min minutes
   { "kind": "threshold", "op": ">", "value": 80, "window_min": 5, "agg": "avg" }
2. absence — fires when no data received in window_min minutes
   { "kind": "absence", "window_min": 10 }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## METRIC CATALOG (available for threshold/absence alerts)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${metricCatalog}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EVENT CATALOG (context about what data flows through the system)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${eventCatalog}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EXISTING NOTIFICATION CHANNELS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${channelList}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STRICT DATA RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${allowed}

CRITICAL CONSTRAINTS:
1. Return ONLY valid JSON — no markdown fences, no text outside JSON
2. NEVER invent asset_ids, namespaces, or metric names — use ONLY values from the catalogs above
3. Use appropriate thresholds based on the metric value ranges in the catalog
4. For CPU/memory metrics with percentage values, typical thresholds: warning >75, critical >90
5. For load metrics, base thresholds on the observed ranges in the catalog
6. Always set severity appropriately: absence → high, high threshold → critical, moderate → medium
7. If user asks about events/security (Wazuh, threat intel, etc.), create absence alerts on relevant namespaces/metrics
8. window_min should be 5 for fast metrics, 10-15 for slower ones
9. If channels exist, assign the most appropriate ones to each rule
10. Generate multiple rules when the request implies it (e.g. "monitor host X" → CPU + memory + load + disk alerts)
11. If the user mentions a technology not in the catalog, explain in summary that no data is available for it yet
12. agg defaults to "avg" — use "max" for spike detection
`;
}

// ─── Plugin system prompt (unchanged) ────────────────────────────────────────

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
