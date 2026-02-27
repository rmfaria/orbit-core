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
import { ensureAssets } from '../connectors/ingest.js';

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

  res.json({ ok: true, inserted: body.metrics.length });
}

export async function ingestEventsHandler(req: Request, res: Response) {
  const body: IngestEventsRequest = IngestEventsSchema.parse(req.body);
  if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

  await ensureAssets(pool, body.events.map(e => e.asset_id));

  if (body.events.length) {
    await pool.query(
      `INSERT INTO orbit_events(ts, asset_id, namespace, kind, severity, title, message, fingerprint, attributes)
       SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::jsonb[])
         AS t(ts, asset_id, namespace, kind, severity, title, message, fingerprint, attributes)
       ON CONFLICT (fingerprint) WHERE fingerprint IS NOT NULL
       DO UPDATE SET
         ts          = excluded.ts,
         severity    = excluded.severity,
         title       = excluded.title,
         message     = excluded.message,
         attributes  = excluded.attributes,
         ingested_at = now()`,
      [
        body.events.map(e => e.ts),
        body.events.map(e => e.asset_id),
        body.events.map(e => e.namespace),
        body.events.map(e => e.kind),
        body.events.map(e => e.severity),
        body.events.map(e => e.title),
        body.events.map(e => e.message ?? null),
        body.events.map(e => e.fingerprint ?? null),
        body.events.map(e => JSON.stringify(e.attributes ?? {})),
      ]
    );
  }

  res.json({ ok: true, inserted: body.events.length });
}
