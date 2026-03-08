/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import type { IngestEventsRequest, IngestMetricsRequest } from '@orbit/core-contracts';
import { pool } from '../db.js';
import { ensureAssets, logRun } from '../connectors/ingest.js';
import { recordEvents } from '../eps-tracker.js';

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const isoTs = z.string().regex(ISO8601_RE, 'ts must be ISO 8601 with timezone (e.g. 2024-01-01T00:00:00Z)');

const MetricPointSchema = z.object({
  ts: isoTs,
  asset_id: z.string().min(1),
  namespace: z.string().min(1),
  metric: z.string().min(1),
  value: z.number(),
  unit: z.string().optional(),
  dimensions: z.record(z.string()).optional()
});

const EventSchema = z.object({
  ts: isoTs,
  asset_id: z.string().min(1),
  namespace: z.string().min(1),
  kind: z.string().min(1),
  severity: z.enum(['info','low','medium','high','critical']),
  title: z.string().min(1),
  message: z.string().optional(),
  fingerprint: z.string().optional(),
  attributes: z.record(z.any()).optional()
});

const IngestMetricsSchema = z.object({
  metrics: z.array(MetricPointSchema).max(5000)
});

const IngestEventsSchema = z.object({
  events: z.array(EventSchema).max(5000)
});

export async function ingestMetricsHandler(req: Request, res: Response) {
  const startedAt = new Date();
  const body: IngestMetricsRequest = IngestMetricsSchema.parse(req.body);
  if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

  await ensureAssets(pool, body.metrics.map(m => m.asset_id));

  if (body.metrics.length) {
    await pool.query(
      `INSERT INTO metric_points(ts, asset_id, namespace, metric, value, unit, dimensions)
       SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::float8[], $6::text[], $7::jsonb[])
         AS t(ts, asset_id, namespace, metric, value, unit, dimensions)`,
      [
        body.metrics.map(m => m.ts),
        body.metrics.map(m => m.asset_id),
        body.metrics.map(m => m.namespace),
        body.metrics.map(m => m.metric),
        body.metrics.map(m => m.value),
        body.metrics.map(m => m.unit ?? null),
        body.metrics.map(m => JSON.stringify(m.dimensions ?? {})),
      ]
    );
  }

  // Record connector run when X-Source-Id header is present
  const sourceId = req.headers['x-source-id'] as string | undefined;
  if (sourceId && pool) {
    const rawSize = req.headers['content-length'] ? parseInt(req.headers['content-length'] as string, 10) : 0;
    await logRun(pool, sourceId, startedAt, body.metrics.length, rawSize, null);
  }

  // Infer source from namespace if no X-Source-Id header
  const inferredSource = sourceId ?? inferSource(body.metrics.map(m => m.namespace));
  recordEvents(inferredSource, body.metrics.length);

  res.json({ ok: true, inserted: body.metrics.length });
}

/** Infer source label from the most common namespace in the batch */
function inferSource(namespaces: string[]): string {
  if (!namespaces.length) return 'unknown';
  const counts: Record<string, number> = {};
  for (const ns of namespaces) counts[ns] = (counts[ns] ?? 0) + 1;
  let best = 'unknown'; let max = 0;
  for (const [ns, c] of Object.entries(counts)) {
    if (c > max) { max = c; best = ns; }
  }
  return best;
}

export async function ingestEventsHandler(req: Request, res: Response) {
  const startedAt = new Date();
  const body: IngestEventsRequest = IngestEventsSchema.parse(req.body);
  if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

  await ensureAssets(pool, body.events.map(e => e.asset_id));

  // Deduplicate by fingerprint within the batch (keep last = latest ts).
  // ON CONFLICT DO UPDATE fails if the same fingerprint appears twice in one INSERT.
  const fpSeen = new Set<string>();
  const events: typeof body.events = [];
  for (let i = body.events.length - 1; i >= 0; i--) {
    const ev = body.events[i];
    if (ev.fingerprint) {
      if (!fpSeen.has(ev.fingerprint)) { fpSeen.add(ev.fingerprint); events.push(ev); }
    } else {
      events.push(ev);
    }
  }

  if (events.length) {
    await pool.query(
      `INSERT INTO orbit_events(ts, asset_id, namespace, kind, severity, title, message, fingerprint, attributes)
       SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::jsonb[])
         AS t(ts, asset_id, namespace, kind, severity, title, message, fingerprint, attributes)
       ON CONFLICT (fingerprint, ts) WHERE fingerprint IS NOT NULL
       DO UPDATE SET
         severity    = excluded.severity,
         title       = excluded.title,
         message     = excluded.message,
         attributes  = excluded.attributes,
         ingested_at = now()`,
      [
        events.map(e => e.ts),
        events.map(e => e.asset_id),
        events.map(e => e.namespace),
        events.map(e => e.kind),
        events.map(e => e.severity),
        events.map(e => e.title),
        events.map(e => e.message ?? null),
        events.map(e => e.fingerprint ?? null),
        events.map(e => JSON.stringify(e.attributes ?? {})),
      ]
    );
  }

  // Record connector run when X-Source-Id header is present
  const sourceId = req.headers['x-source-id'] as string | undefined;
  if (sourceId && pool) {
    const rawSize = req.headers['content-length'] ? parseInt(req.headers['content-length'] as string, 10) : 0;
    await logRun(pool, sourceId, startedAt, events.length, rawSize, null);
  }

  const inferredSource = sourceId ?? inferSource(events.map(e => e.namespace));
  recordEvents(inferredSource, events.length);

  res.json({ ok: true, inserted: body.events.length });
}
