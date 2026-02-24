import { Router } from 'express';
import type { Pool } from 'pg';
import { DashboardSpecSchema } from '@orbit/core-contracts';

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

    // Fetch catalog context from DB
    let assets:   Array<{ asset_id: string; name: string }> = [];
    let metrics:  Array<{ namespace: string; metric: string }> = [];
    let eventNs:  string[] = [];

    if (pool) {
      try {
        const [ar, mr, er] = await Promise.all([
          pool.query<{ asset_id: string; name: string }>(
            'SELECT asset_id, name FROM assets ORDER BY last_seen DESC LIMIT 100'
          ),
          pool.query<{ namespace: string; metric: string }>(
            'SELECT DISTINCT namespace, metric FROM metric_points LIMIT 200'
          ),
          pool.query<{ namespace: string }>(
            'SELECT DISTINCT namespace FROM orbit_events LIMIT 20'
          ),
        ]);
        assets  = ar.rows;
        metrics = mr.rows;
        eventNs = er.rows.map(r => r.namespace);
      } catch { /* catalog may be empty — continue */ }
    }

    const systemPrompt = buildSystemPrompt(assets, metrics, eventNs);

    // Call Anthropic API via native fetch (Node 22 — no SDK needed)
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

function buildSystemPrompt(
  assets:  Array<{ asset_id: string; name: string }>,
  metrics: Array<{ namespace: string; metric: string }>,
  eventNs: string[],
): string {
  const assetList  = assets.length
    ? assets.map(a => `  - ${a.asset_id}${a.name ? ` (${a.name})` : ''}`).join('\n')
    : '  (no assets registered)';

  const metricList = metrics.length
    ? metrics.map(m => `  - namespace=${m.namespace}  metric=${m.metric}`).join('\n')
    : '  (no metrics registered)';

  const nsList = eventNs.length
    ? eventNs.map(n => `  - ${n}`).join('\n')
    : '  (no events registered)';

  // Build concrete examples using real asset_ids from catalog
  const firstAsset  = assets[0]?.asset_id ?? 'host:server1';
  const secondAsset = assets[1]?.asset_id ?? 'host:server2';
  const firstMetric = metrics[0] ?? { namespace: 'nagios', metric: 'load1' };
  const multiMetric = metrics.find(m => m.namespace === firstMetric.namespace) ?? firstMetric;

  // Build a realistic timeseries_multi example using real assets
  const multiSeriesExample = assets.slice(0, 3).map((a, i) => ({
    asset_id:  a.asset_id,
    namespace: multiMetric.namespace,
    metric:    multiMetric.metric,
    label:     a.name ?? a.asset_id,
  }));
  const multiSeriesJson = JSON.stringify(multiSeriesExample, null, 4).replace(/^/gm, '  ');

  return `You are an orbit-core Dashboard Builder AI. Your only job is to output a single valid JSON object conforming to the DashboardSpec schema below.

## Available data sources

### Assets (asset_id):
${assetList}

### Metrics (namespace + metric):
${metricList}

### Event namespaces:
${nsList}

## DashboardSpec schema

\`\`\`
{
  id:           string,          // slug, e.g. "dash-cpu-memory"
  name:         string,
  description?: string,
  version:      "v1",
  time:         { preset: "60m" | "6h" | "24h" | "7d" | "30d" },
  tags:         string[],
  widgets:      WidgetSpec[]     // 1–20 widgets
}

WidgetSpec = {
  id:      string,
  title:   string,
  kind:    "timeseries" | "timeseries_multi" | "events" | "eps" | "kpi",
  layout:  { x: 0, y: 0, w: 1 | 2, h: 1 },
  query:   OrbitQlQuery          // NO "from" or "to"
}
\`\`\`

## CRITICAL: Exact query format per widget kind

### timeseries — single asset, single metric (w=1)
REQUIRED field: asset_id
\`\`\`json
{ "kind": "timeseries", "asset_id": "${firstAsset}", "namespace": "${firstMetric.namespace}", "metric": "${firstMetric.metric}" }
\`\`\`

### timeseries_multi — same metric across multiple assets (w=2)
REQUIRED field: series array with asset_id per entry
\`\`\`json
{
  "kind": "timeseries_multi",
  "series": ${multiSeriesJson}
}
\`\`\`

### events — event feed (w=1 or w=2)
\`\`\`json
{ "kind": "events", "namespace": "wazuh", "limit": 20 }
\`\`\`

### eps — events-per-second chart (w=2)
\`\`\`json
{ "kind": "event_count", "namespace": "wazuh" }
\`\`\`

### kpi — latest value of a metric (w=1)
REQUIRED field: asset_id
\`\`\`json
{ "kind": "timeseries", "asset_id": "${firstAsset}", "namespace": "${firstMetric.namespace}", "metric": "${firstMetric.metric}" }
\`\`\`

## Rules
- Return ONLY the JSON object — no markdown, no explanation, no fences
- Use real asset_ids and metrics from the catalog above
- Do NOT include "from" or "to" in any query
- timeseries and kpi queries MUST have "asset_id" — use a real asset_id from the list above
- timeseries_multi queries MUST have "series" array — each entry MUST have asset_id, namespace, metric, label
- For kind=eps the query.kind must be "event_count"
- For kind=events the query.kind must be "events"
- Use w=2 for wide charts (eps, multi-series, event feeds)
`;
}
