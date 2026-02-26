/**
 * orbit-core — AI Connector Framework
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sprint 2: POST /api/v1/connectors/generate — AI-powered spec generation.
 *   Accepts a sample payload + source hint, calls Anthropic, validates the
 *   returned DSL spec, and saves it as a draft connector.
 *
 * Sprint 1: connector_specs CRUD + universal raw ingest endpoint.
 *
 * POST /api/v1/ingest/raw/:source_id   — accept any JSON payload, map to
 *   canonical metrics or events using the saved DSL spec for that source.
 *
 * DSL spec format (stored in connector_specs.spec JSONB):
 *
 *   {
 *     "type": "metric" | "event",
 *     "items_path": "data.items",     // optional: path to array inside payload
 *     "mappings": {
 *       "<target_field>": {
 *         "path":      "$.host.name",  // JSONish dot/bracket path in each item
 *         "value":     "nagios",       // static literal (overrides path)
 *         "transform": "number",       // optional post-transform
 *         "default":   "unknown"       // fallback when path resolves to undefined
 *       }
 *     }
 *   }
 *
 * Supported transforms: number | string | boolean | round | abs | iso8601 | severity_map
 *
 * Required mappings for type="metric": ts, asset_id, namespace, metric, value
 * Required mappings for type="event":  ts, asset_id, namespace, kind, severity, title
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { applySpec, type FieldMapping, type ConnectorSpec } from '../connectors/dsl.js';
import { ingestMapped, logRun } from '../connectors/ingest.js';

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const FieldMappingSchema: z.ZodType<FieldMapping> = z.object({
  path:      z.string().optional(),
  value:     z.unknown().optional(),
  transform: z.enum(['number','string','boolean','round','abs','iso8601','severity_map']).optional(),
  default:   z.unknown().optional(),
});

const SpecSchema: z.ZodType<ConnectorSpec> = z.object({
  type:        z.enum(['metric', 'event']),
  items_path:  z.string().optional(),
  mappings:    z.record(FieldMappingSchema),
});

const CreateConnectorSchema = z.object({
  id:                z.string().min(1).regex(/^[a-z0-9-]+$/, 'id must be lowercase alphanumeric with dashes'),
  source_id:         z.string().min(1),
  mode:              z.enum(['push', 'pull']).default('push'),
  type:              z.enum(['metric', 'event']).default('metric'),
  spec:              SpecSchema,
  description:       z.string().optional(),
  pull_url:          z.string().url().optional(),
  pull_interval_min: z.number().int().min(1).max(1440).default(5),
});

const PatchConnectorSchema = z.object({
  spec:              SpecSchema.optional(),
  description:       z.string().optional(),
  pull_url:          z.string().url().nullable().optional(),
  pull_interval_min: z.number().int().min(1).max(1440).optional(),
  mode:              z.enum(['push', 'pull']).optional(),
  type:              z.enum(['metric', 'event']).optional(),
});

const GenerateSchema = z.object({
  // Connector identity — auto-generated from source_type+timestamp if omitted
  id:          z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
  source_id:   z.string().min(1).optional(),
  // Hints for the AI
  source_type: z.string().min(1).optional(),   // e.g. "nagios", "wazuh", "fortigate"
  type:        z.enum(['metric', 'event']).optional(), // inferred by AI if absent
  description: z.string().optional(),
  // Required: a representative sample of the raw payload
  payload:     z.union([z.record(z.unknown()), z.array(z.unknown())]),
});


// ── Router ────────────────────────────────────────────────────────────────────

export function connectorsRouter(pool?: Pool | null): Router {
  const r = Router();

  // ── List specs ────────────────────────────────────────────────────────────

  r.get('/connectors', async (_req, res) => {
    if (!pool) return res.json({ ok: true, connectors: [] });
    const { rows } = await pool.query(
      `SELECT id, source_id, mode, type, status, auto, description,
              pull_url, pull_interval_min, created_at, updated_at
       FROM connector_specs
       ORDER BY created_at DESC`
    );
    return res.json({ ok: true, connectors: rows });
  });

  // ── AI-generate spec from sample payload ─────────────────────────────────
  //
  // POST /api/v1/connectors/generate
  //
  // Headers: X-Ai-Key (Anthropic API key), X-Ai-Model (e.g. claude-sonnet-4-6)
  // Body:    { payload, source_type?, type?, id?, source_id?, description? }
  //
  // Calls Claude to generate a DSL spec from the sample payload,
  // validates it, and saves it as a draft connector (auto=true).

  r.post('/connectors/generate', async (req, res) => {
    const aiKey   = req.headers['x-ai-key']   as string | undefined;
    const aiModel = req.headers['x-ai-model'] as string | undefined;

    if (!aiKey)   return res.status(400).json({ ok: false, error: 'Missing X-Ai-Key header' });
    if (!aiModel) return res.status(400).json({ ok: false, error: 'Missing X-Ai-Model header' });

    const bodyParsed = GenerateSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return res.status(400).json({ ok: false, error: bodyParsed.error.errors });
    }
    const d = bodyParsed.data;

    const sourceType = d.source_type ?? 'custom';
    const slug       = sourceType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const connId     = d.id        ?? `${slug}-${Date.now()}`;
    const sourceId   = d.source_id ?? connId;

    // ── Call Anthropic ───────────────────────────────────────────────────────
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
          max_tokens: 2048,
          system:     buildGenerateSystemPrompt(),
          messages:   [{
            role:    'user',
            content: buildGenerateUserMessage(sourceType, d.type, d.payload),
          }],
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

    // Strip markdown fences if the model wrapped in ```json ... ```
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();

    let specRaw: unknown;
    try {
      specRaw = JSON.parse(jsonText);
    } catch {
      return res.status(502).json({
        ok: false,
        error: 'AI returned invalid JSON',
        raw: rawText.slice(0, 1000),
      });
    }

    // Validate against DSL schema
    const specParsed = SpecSchema.safeParse(specRaw);
    if (!specParsed.success) {
      return res.status(502).json({
        ok: false,
        error: 'AI returned invalid connector spec',
        issues: specParsed.error.issues,
        raw:    specRaw,
      });
    }

    const spec     = specParsed.data;
    const connType = spec.type;

    // Save to DB as auto-generated draft
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO connector_specs
             (id, source_id, mode, type, spec, status, auto, description)
           VALUES ($1,$2,'push',$3,$4,'draft',true,$5)
           ON CONFLICT (id) DO UPDATE SET
             spec = EXCLUDED.spec, type = EXCLUDED.type,
             auto = true, description = EXCLUDED.description, updated_at = now()`,
          [connId, sourceId, connType, JSON.stringify(spec),
           d.description ?? `Auto-generated connector for ${sourceType}`]
        );
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'Failed to save connector', detail: String(e) });
      }
    }

    return res.status(201).json({
      ok:        true,
      id:        connId,
      source_id: sourceId,
      type:      connType,
      status:    'draft',
      auto:      true,
      spec,
      next_step: `Review the spec, then POST /api/v1/connectors/${connId}/approve to activate.`,
    });
  });

  // ── Get spec ──────────────────────────────────────────────────────────────

  r.get('/connectors/:id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const { rows } = await pool.query(
      `SELECT * FROM connector_specs WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'connector not found' });
    return res.json({ ok: true, connector: rows[0] });
  });

  // ── Create spec ───────────────────────────────────────────────────────────

  r.post('/connectors', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const parsed = CreateConnectorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.errors });
    const d = parsed.data;
    await pool.query(
      `INSERT INTO connector_specs
         (id, source_id, mode, type, spec, status, description, pull_url, pull_interval_min)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8)`,
      [d.id, d.source_id, d.mode, d.type, JSON.stringify(d.spec),
       d.description ?? null, d.pull_url ?? null, d.pull_interval_min]
    );
    return res.status(201).json({ ok: true, id: d.id });
  });

  // ── Update spec ───────────────────────────────────────────────────────────

  r.patch('/connectors/:id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const parsed = PatchConnectorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.errors });
    const d = parsed.data;

    const sets: string[] = ['updated_at = now()'];
    const vals: unknown[] = [];
    let i = 1;

    if (d.spec              !== undefined) { sets.push(`spec = $${i++}`);              vals.push(JSON.stringify(d.spec)); }
    if (d.description       !== undefined) { sets.push(`description = $${i++}`);       vals.push(d.description); }
    if (d.mode              !== undefined) { sets.push(`mode = $${i++}`);              vals.push(d.mode); }
    if (d.type              !== undefined) { sets.push(`type = $${i++}`);              vals.push(d.type); }
    if (d.pull_url          !== undefined) { sets.push(`pull_url = $${i++}`);          vals.push(d.pull_url); }
    if (d.pull_interval_min !== undefined) { sets.push(`pull_interval_min = $${i++}`); vals.push(d.pull_interval_min); }

    vals.push(req.params.id);
    const { rowCount } = await pool.query(
      `UPDATE connector_specs SET ${sets.join(', ')} WHERE id = $${i}`,
      vals
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: 'connector not found' });
    return res.json({ ok: true });
  });

  // ── Approve spec ──────────────────────────────────────────────────────────

  r.post('/connectors/:id/approve', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const { rowCount } = await pool.query(
      `UPDATE connector_specs SET status = 'approved', updated_at = now() WHERE id = $1`,
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: 'connector not found' });
    return res.json({ ok: true });
  });

  // ── Disable spec ──────────────────────────────────────────────────────────

  r.post('/connectors/:id/disable', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const { rowCount } = await pool.query(
      `UPDATE connector_specs SET status = 'disabled', updated_at = now() WHERE id = $1`,
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: 'connector not found' });
    return res.json({ ok: true });
  });

  // ── Delete spec ───────────────────────────────────────────────────────────

  r.delete('/connectors/:id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const { rowCount } = await pool.query(
      `DELETE FROM connector_specs WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: 'connector not found' });
    return res.json({ ok: true });
  });

  // ── Get run history ───────────────────────────────────────────────────────

  r.get('/connectors/:id/runs', async (req, res) => {
    if (!pool) return res.json({ ok: true, runs: [] });
    // Look up source_id by connector id
    const { rows: spec } = await pool.query(
      `SELECT source_id FROM connector_specs WHERE id = $1`, [req.params.id]
    );
    if (!spec.length) return res.status(404).json({ ok: false, error: 'connector not found' });
    const { rows } = await pool.query(
      `SELECT id, source_id, started_at, finished_at, status, ingested, raw_size, error
       FROM connector_runs
       WHERE source_id = $1
       ORDER BY started_at DESC
       LIMIT 50`,
      [spec[0].source_id]
    );
    return res.json({ ok: true, runs: rows });
  });

  // ── Universal raw ingest ──────────────────────────────────────────────────
  //
  // POST /api/v1/ingest/raw/:source_id
  //
  // Accepts any JSON payload. Looks up the approved spec for the source_id,
  // applies the DSL mapping, validates each resulting item, and bulk-inserts
  // into metric_points or orbit_events as appropriate.

  r.post('/ingest/raw/:source_id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });

    const { source_id } = req.params;
    const startedAt = new Date();
    const rawSize = JSON.stringify(req.body).length;

    // Load spec
    const { rows } = await pool.query(
      `SELECT spec, type, status FROM connector_specs WHERE source_id = $1`,
      [source_id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: `no connector spec found for source '${source_id}'` });
    }
    const { spec: rawSpec, type: connType, status } = rows[0];
    if (status !== 'approved') {
      return res.status(409).json({
        ok: false,
        error: `connector spec for '${source_id}' is '${status}' — must be approved before ingesting`,
      });
    }

    const spec = rawSpec as ConnectorSpec;
    let items: Record<string, unknown>[];
    try {
      items = applySpec(req.body, spec);
    } catch (e: unknown) {
      await logRun(pool, source_id, startedAt, 0, rawSize, `DSL error: ${String(e)}`);
      return res.status(422).json({ ok: false, error: `DSL mapping failed: ${String(e)}` });
    }

    if (!items.length) {
      await logRun(pool, source_id, startedAt, 0, rawSize, null);
      return res.json({ ok: true, ingested: 0, skipped: 0 });
    }

    const { ingested, skipped, errors } = await ingestMapped(pool, connType as 'metric' | 'event', items);
    await logRun(pool, source_id, startedAt, ingested, rawSize, null);
    return res.json({ ok: true, ingested, skipped, ...(errors.length ? { errors } : {}) });
  });

  return r;
}

// ── AI prompt builders ────────────────────────────────────────────────────────

function buildGenerateSystemPrompt(): string {
  return `\
You are an orbit-core Connector Spec Builder AI.

Your job: analyze a sample JSON payload from a data source and output a valid
DSL mapping spec that transforms it into orbit-core's canonical schema.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY a single JSON object — no markdown, no explanation, nothing else.

{
  "type":        "metric" | "event",
  "items_path":  "path.to.array",    // OPTIONAL — path to the items array inside root
  "mappings": {
    "<target_field>": {
      "path":      "$.some.field",   // dot/bracket path in each item
      "value":     "static",         // static literal (overrides path)
      "transform": "number",         // optional post-transform
      "default":   "unknown"         // fallback if path is missing or null
    }
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## REQUIRED MAPPINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For type="metric" (numeric time series):
  ts        — timestamp string in ISO 8601 with timezone (REQUIRED)
  asset_id  — unique identifier for the host/device/service (REQUIRED)
  namespace — data source category, e.g. "nagios", "snmp", "aws" (REQUIRED)
  metric    — metric name, e.g. "cpu_load", "mem_free_bytes" (REQUIRED)
  value     — the numeric measurement (REQUIRED)
  unit      — unit of measure e.g. "%" "MB" "ms" (optional)

For type="event" (security/operational events):
  ts          — timestamp string in ISO 8601 with timezone (REQUIRED)
  asset_id    — unique identifier for the affected host/device (REQUIRED)
  namespace   — data source category, e.g. "wazuh", "fortigate" (REQUIRED)
  kind        — event category or rule name (REQUIRED)
  severity    — one of: info | low | medium | high | critical (REQUIRED)
  title       — brief human-readable description (REQUIRED)
  message     — full log line or detailed description (optional)
  fingerprint — deduplication key, e.g. alert ID (optional)
  attributes  — any extra fields as a sub-object (optional)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## PATH SYNTAX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  "$.field"              — top-level field
  "$.parent.child"       — nested field
  "$.list[0].value"      — first element of an array
  "parent.child"         — same as "$.parent.child"

items_path rules:
  - Set items_path when the records array is nested inside the root object
    e.g. root = { "data": { "metrics": [...] } } → items_path = "data.metrics"
  - Omit items_path when root IS the array  [ {...}, {...} ]
  - Omit items_path when root is a single record (not an array)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## AVAILABLE TRANSFORMS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  number      → cast to Number (always use for "value" field)
  string      → cast to String
  boolean     → cast to Boolean
  round       → Math.round(Number(v))
  abs         → Math.abs(Number(v))
  iso8601     → convert Unix timestamp (seconds if <1e12, ms otherwise)
                or any date string to ISO 8601 UTC string
                USE THIS when ts is a Unix integer or non-ISO date string
  severity_map → maps numeric (0=info,1=low,2=medium,3=high,4=critical)
                 or text (warning→medium, error→high, alert→high, emergency→critical)
                 to orbit severity. USE THIS when severity is numeric or non-standard.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## DECISION GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Prefer type="metric" when payload contains numeric measurements over time.
Prefer type="event"  when payload describes alerts, logs, or incidents.

For ts:
  - Integer field          → add transform: "iso8601"
  - ISO 8601 string        → no transform
  - Non-standard date str  → add transform: "iso8601"

For asset_id: choose the most specific host/device identifier
  (hostname, device_id, agent.name, host, src_ip of the monitored asset)

For namespace: use the source_type hint. If source_type is "custom",
  infer from the payload structure or key names.

For severity (events): if numeric → transform: "severity_map"
  if text matching (warning/error/alert/low/medium/high/critical) → transform: "severity_map"
  if already orbit-compatible (info/low/medium/high/critical) → no transform, use "default": "medium"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STRICT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Return ONLY the JSON object — no markdown, no text before or after
2. Always include transform: "number" for the "value" field in metric specs
3. Always map ts to an ISO 8601 string — use transform: "iso8601" for Unix ints
4. For namespace, prefer a static "value" over a dynamic path when
   the source type is known and consistent
5. Include "default" for optional fields that may be missing in some payloads
6. Do NOT invent field names — only use paths that exist in the sample payload`;
}

function buildGenerateUserMessage(
  sourceType: string,
  typeHint:   'metric' | 'event' | undefined,
  payload:    unknown,
): string {
  const payloadStr = JSON.stringify(payload, null, 2);
  const truncated  = payloadStr.length > 8000
    ? payloadStr.slice(0, 8000) + '\n... (truncated)'
    : payloadStr;

  return [
    `Source type: ${sourceType}`,
    typeHint ? `Target type: ${typeHint}` : 'Target type: infer from payload',
    '',
    'Sample payload:',
    truncated,
    '',
    'Generate the DSL spec.',
  ].join('\n');
}

