/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';

const AssetsQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional()
});

export async function catalogAssetsHandler(req: Request, res: Response) {
  if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

  const { q, limit } = AssetsQuerySchema.parse(req.query);
  const lim = limit ?? 100;

  if (q && q.trim()) {
    const qq = `%${q.trim()}%`;
    const r = await pool.query(
      `select asset_id, type, name, enabled, last_seen
       from assets
       where asset_id ilike $1 or name ilike $1
       order by last_seen desc
       limit $2`,
      [qq, lim]
    );
    return res.json({ ok: true, assets: r.rows });
  }

  const r = await pool.query(
    `select asset_id, type, name, enabled, last_seen
     from assets
     order by last_seen desc
     limit $1`,
    [lim]
  );
  return res.json({ ok: true, assets: r.rows });
}

const MetricsQuerySchema = z.object({
  asset_id: z.string().min(1),
  limit: z.coerce.number().int().positive().max(2000).optional(),
  namespace: z.string().optional()
});

export async function catalogMetricsHandler(req: Request, res: Response) {
  if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

  const { asset_id, limit, namespace } = MetricsQuerySchema.parse(req.query);
  const lim = limit ?? 500;

  const params: any[] = [asset_id];
  const where: string[] = ['asset_id = $1'];
  if (namespace && namespace.trim()) {
    params.push(namespace.trim());
    where.push(`namespace = $${params.length}`);
  }
  params.push(lim);

  where.push(`ts > now() - interval '7 days'`);
  const r = await pool.query(
    `select namespace, metric,
            count(*)::bigint as points,
            max(ts) as last_ts
     from metric_points
     where ${where.join(' and ')}
     group by namespace, metric
     order by max(ts) desc
     limit $${params.length}`,
    params
  );

  return res.json({ ok: true, metrics: r.rows });
}

// ── Events catalog ────────────────────────────────────────────────────────────

interface EventNsCatalog {
  namespace:  string;
  total:      number;
  last_seen:  string | null;
  kinds:      string[];
  agents:     string[];
  severities: string[];
}

export async function catalogEventsHandler(req: Request, res: Response) {
  if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

  try {
    // Read from pre-computed cache (refreshed every 5 min by rollup worker).
    const r = await pool.query<{
      namespace: string; total: number; last_seen: string | null;
      kinds: string[]; agents: string[]; severities: string[];
    }>(
      `SELECT namespace, total, last_seen::text, kinds, agents, severities
       FROM catalog_event_cache
       ORDER BY total DESC`
    );

    const namespaces: EventNsCatalog[] = r.rows.map(row => ({
      namespace:  row.namespace,
      total:      row.total,
      last_seen:  row.last_seen,
      kinds:      row.kinds,
      agents:     row.agents,
      severities: row.severities,
    }));

    return res.json({ ok: true, namespaces });
  } catch (err) {
    console.error('[catalog] catalogEventsHandler error:', err);
    return res.status(500).json({ ok: false, error: 'failed to load events catalog' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const DimensionsQuerySchema = z.object({
  asset_id: z.string().min(1),
  namespace: z.string().min(1),
  metric: z.string().min(1),
  /** If set, return top values for this key. Otherwise list keys. */
  key: z.string().min(1).optional(),
  /** Lookback window (days) to limit scan. */
  lookback_days: z.coerce.number().int().positive().max(365).optional(),
  limit_keys: z.coerce.number().int().positive().max(200).optional(),
  limit_values: z.coerce.number().int().positive().max(200).optional()
});

export async function catalogDimensionsHandler(req: Request, res: Response) {
  if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

  const q = DimensionsQuerySchema.parse(req.query);
  const lookbackDays = q.lookback_days ?? 30;

  if (!q.key) {
    const r = await pool.query(
      `with filtered as (
         select dimensions
         from metric_points
         where asset_id = $1 and namespace = $2 and metric = $3
           and ts >= now() - ($4::text || ' days')::interval
       )
       select k as key, count(*)::bigint as seen
       from filtered, lateral jsonb_object_keys(filtered.dimensions) as k
       group by k
       order by count(*) desc
       limit $5`,
      [q.asset_id, q.namespace, q.metric, String(lookbackDays), q.limit_keys ?? 50]
    );

    return res.json({ ok: true, keys: r.rows, lookback_days: lookbackDays });
  }

  {
    const r = await pool.query(
      `select (dimensions ->> $4::text) as value, count(*)::bigint as seen
       from metric_points
       where asset_id = $1 and namespace = $2 and metric = $3
         and ts >= now() - ($5::text || ' days')::interval
         and (dimensions ? $4::text)
       group by 1
       order by count(*) desc
       limit $6`,
      [q.asset_id, q.namespace, q.metric, q.key, String(lookbackDays), q.limit_values ?? 50]
    );

    return res.json({ ok: true, key: q.key, values: r.rows, lookback_days: lookbackDays });
  }
}
