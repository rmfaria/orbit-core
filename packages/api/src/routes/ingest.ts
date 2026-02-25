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

async function ensureAssets(assetIds: string[]) {
  if (!pool) throw new Error('DATABASE_URL not configured');
  const uniq = Array.from(new Set(assetIds)).filter(Boolean);
  if (!uniq.length) return;

  // Insert minimal assets if missing
  // type/name are unknown at ingest time; connectors should upsert full assets separately.
  const values: any[] = [];
  const rowsSql = uniq
    .map((id, i) => {
      values.push(id);
      return `($${i + 1}, 'custom', $${i + 1})`;
    })
    .join(',');

  await pool.query(
    `insert into assets(asset_id, type, name)
     values ${rowsSql}
     on conflict (asset_id) do nothing`,
    values
  );
}

export async function ingestMetricsHandler(req: Request, res: Response) {
  const body: IngestMetricsRequest = IngestMetricsSchema.parse(req.body);
  if (!pool) return res.status(500).json({ error: 'DATABASE_URL not configured' });

  await ensureAssets(body.metrics.map(m => m.asset_id));

  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const m of body.metrics) {
      await client.query(
        `insert into metric_points(ts, asset_id, namespace, metric, value, unit, dimensions)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [m.ts, m.asset_id, m.namespace, m.metric, m.value, m.unit ?? null, (m.dimensions ?? {})]
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }

  res.json({ ok: true, inserted: body.metrics.length });
}

export async function ingestEventsHandler(req: Request, res: Response) {
  const body: IngestEventsRequest = IngestEventsSchema.parse(req.body);
  if (!pool) return res.status(500).json({ error: 'DATABASE_URL not configured' });

  await ensureAssets(body.events.map(e => e.asset_id));

  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const ev of body.events) {
      await client.query(
        `insert into orbit_events(ts, asset_id, namespace, kind, severity, title, message, fingerprint, attributes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ev.ts, ev.asset_id, ev.namespace, ev.kind, ev.severity, ev.title, ev.message ?? null, ev.fingerprint ?? null, (ev.attributes ?? {})]
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }

  res.json({ ok: true, inserted: body.events.length });
}
