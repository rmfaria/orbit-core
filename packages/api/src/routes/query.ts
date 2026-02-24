import type { Request, Response } from 'express';
import { z } from 'zod';
import type { QueryRequest, QueryResponse, OrbitQlQuery } from '@orbit/core-contracts';
import { pool } from '../db.js';

const TimeseriesQuerySchema = z.object({
  kind: z.literal('timeseries'),
  asset_id: z.string().min(1),
  namespace: z.string().min(1),
  metric: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  bucket_sec: z.number().int().positive().max(86400).optional(),
  agg: z.enum(['avg', 'min', 'max', 'sum']).optional(),
  dimensions: z.record(z.string()).optional(),
  limit: z.number().int().positive().max(200000).optional()
});

const TimeseriesMultiQuerySchema = z.object({
  kind: z.literal('timeseries_multi'),
  from: z.string().min(1),
  to: z.string().min(1),
  bucket_sec: z.number().int().positive().max(86400).optional(),
  agg: z.enum(['avg', 'min', 'max', 'sum']).optional(),
  group_by_dimension: z.string().min(1).optional(),
  top_n: z.number().int().positive().max(200).optional(),
  top_by: z.enum(['count', 'last']).optional(),
  top_lookback_days: z.number().int().positive().max(365).optional(),
  series: z
    .array(
      z.object({
        asset_id: z.string().min(1),
        namespace: z.string().min(1),
        metric: z.string().min(1),
        label: z.string().min(1).optional(),
        dimensions: z.record(z.string()).optional()
      })
    )
    .min(1)
    .max(50),
  limit: z.number().int().positive().max(200000).optional()
});

const EventsQuerySchema = z.object({
  kind: z.literal('events'),
  asset_id: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  severities: z.array(z.enum(['info', 'low', 'medium', 'high', 'critical'])).optional(),
  kinds: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(10000).optional()
});

const EventCountQuerySchema = z.object({
  kind: z.literal('event_count'),
  namespace: z.string().min(1).optional(),
  asset_id: z.string().min(1).optional(),
  severities: z.array(z.enum(['info', 'low', 'medium', 'high', 'critical'])).optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  bucket_sec: z.number().int().positive().max(86400).optional(),
});

const OrbitQlQuerySchema = z.discriminatedUnion('kind', [TimeseriesQuerySchema, TimeseriesMultiQuerySchema, EventsQuerySchema, EventCountQuerySchema]);

const QueryRequestSchema = z.object({
  language: z.enum(['sql', 'orbitql']).default('orbitql'),
  query: z.union([z.string().min(1), OrbitQlQuerySchema]),
  limit: z.number().int().positive().max(10000).optional()
});

export async function queryHandler(req: Request, res: Response<QueryResponse>) {
  const reqBody: QueryRequest = QueryRequestSchema.parse(req.body);
  if (!pool) return (res as Response).status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

  if (reqBody.language === 'sql') {
    // Intentionally disabled for now (avoid exposing raw SQL execution in MVP).
    return (res as Response).status(400).json({ ok: false, error: 'sql language not enabled' });
  }

  let q: OrbitQlQuery;
  try {
    q = typeof reqBody.query === 'string' ? JSON.parse(reqBody.query) : reqBody.query;
  } catch {
    return (res as Response).status(400).json({ ok: false, error: 'query is not valid JSON' });
  }

  const aggExpr = (agg?: string) => {
    switch (agg) {
      case 'min':
        return 'min(value)::double precision';
      case 'max':
        return 'max(value)::double precision';
      case 'sum':
        return 'sum(value)::double precision';
      case 'avg':
      default:
        return 'avg(value)::double precision';
    }
  };

  const chooseBucket = (fromIso: string, toIso: string): number => {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    const sec = Math.max(0, Math.floor((to - from) / 1000));

    // performance-first defaults for raw queries (<= 14d)
    if (sec <= 2 * 3600) return 10;
    if (sec <= 12 * 3600) return 60;
    if (sec <= 48 * 3600) return 300;
    if (sec <= 14 * 86400) return 900;
    return 3600;
  };

  const chooseSource = (fromIso: string, toIso: string): { table: string; bucket_sec: number | null } => {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    const sec = Math.max(0, Math.floor((to - from) / 1000));

    // Retention policy:
    // raw metric_points: 14d
    // rollup_5m: 90d
    // rollup_1h: 180d
    const d14 = 14 * 86400;
    const d90 = 90 * 86400;

    if (sec > d90) return { table: 'metric_rollup_1h', bucket_sec: 3600 };
    if (sec > d14) return { table: 'metric_rollup_5m', bucket_sec: 300 };
    return { table: 'metric_points', bucket_sec: null };
  };

  const rollupValueExpr = (agg?: string) => {
    switch (agg) {
      case 'min':
        return 'min';
      case 'max':
        return 'max';
      case 'sum':
        return 'sum';
      case 'avg':
      default:
        return 'avg';
    }
  };

  if (q.kind === 'timeseries') {
    const src = chooseSource(q.from, q.to);

    // performance-first: bucket by default. For rollup sources, bucket is fixed.
    const effectiveBucket = src.bucket_sec ?? (q.bucket_sec ?? chooseBucket(q.from, q.to));
    const limit = q.limit ?? 10000;

    if (effectiveBucket) {
      const bucket = `${effectiveBucket} seconds`;

      if (src.table === 'metric_points') {
        const params: any[] = [bucket, q.from, q.to, q.asset_id, q.namespace, q.metric];
        let dimsSql = '';
        if (q.dimensions && Object.keys(q.dimensions).length) {
          params.push(q.dimensions);
          dimsSql = `and dimensions @> $${params.length}::jsonb`;
        }
        params.push(limit);

        const sql = `
          select
            date_bin($1::interval, ts, '1970-01-01'::timestamptz) as ts,
            ${aggExpr(q.agg)} as value
          from metric_points
          where ts >= $2::timestamptz and ts <= $3::timestamptz
            and asset_id = $4 and namespace = $5 and metric = $6
            ${dimsSql}
          group by 1
          order by 1 asc
          limit $${params.length}`;

        const r = await pool.query(sql, params);
        return res.json({
          ok: true,
          result: {
            columns: [
              { name: 'ts', type: 'timestamptz' },
              { name: 'value', type: 'float8' }
            ],
            rows: r.rows
          },
          meta: {
            effective_bucket_sec: effectiveBucket,
            effective_limit: limit,
            mode: 'bucketed',
            source_table: src.table as any
          }
        });
      }

      // rollup tables are already bucketed; do not pass unused $1 params.
      {
        const tsCol = 'bucket_ts';
        const valueCol = rollupValueExpr(q.agg);

        const params: any[] = [q.from, q.to, q.asset_id, q.namespace, q.metric];
        let dimsSql = '';
        if (q.dimensions && Object.keys(q.dimensions).length) {
          params.push(q.dimensions);
          dimsSql = `and dimensions @> $${params.length}::jsonb`;
        }
        params.push(limit);

        const sql = `
          select
            ${tsCol} as ts,
            ${valueCol}::double precision as value
          from ${src.table}
          where ${tsCol} >= $1::timestamptz and ${tsCol} <= $2::timestamptz
            and asset_id = $3 and namespace = $4 and metric = $5
            ${dimsSql}
          order by 1 asc
          limit $${params.length}`;

        const r = await pool.query(sql, params);
        return res.json({
          ok: true,
          result: {
            columns: [
              { name: 'ts', type: 'timestamptz' },
              { name: 'value', type: 'float8' }
            ],
            rows: r.rows
          },
          meta: {
            effective_bucket_sec: effectiveBucket,
            effective_limit: limit,
            mode: 'bucketed',
            source_table: src.table as any
          }
        });
      }
    }

    const params: any[] = [q.from, q.to, q.asset_id, q.namespace, q.metric];
    let dimsSql = '';
    if (q.dimensions && Object.keys(q.dimensions).length) {
      params.push(q.dimensions);
      dimsSql = `and dimensions @> $${params.length}::jsonb`;
    }
    params.push(limit);

    // If range exceeds raw retention, fall back to rollup.
    if (src.table !== 'metric_points') {
      const tsCol = 'bucket_ts';
      const valueCol = rollupValueExpr(q.agg);
      const params: any[] = [q.from, q.to, q.asset_id, q.namespace, q.metric];
      let dimsSql = '';
      if (q.dimensions && Object.keys(q.dimensions).length) {
        params.push(q.dimensions);
        dimsSql = `and dimensions @> $${params.length}::jsonb`;
      }
      params.push(limit);

      const sql = `
        select ${tsCol} as ts, ${valueCol}::double precision as value
        from ${src.table}
        where ${tsCol} >= $1::timestamptz and ${tsCol} <= $2::timestamptz
          and asset_id = $3 and namespace = $4 and metric = $5
          ${dimsSql}
        order by 1 asc
        limit $${params.length}`;

      const r = await pool.query(sql, params);
      return res.json({
        ok: true,
        result: {
          columns: [
            { name: 'ts', type: 'timestamptz' },
            { name: 'value', type: 'float8' }
          ],
          rows: r.rows
        },
        meta: {
          effective_bucket_sec: src.bucket_sec ?? undefined,
          effective_limit: limit,
          mode: 'bucketed',
          source_table: src.table as any
        }
      });
    }

    const sql = `
      select ts, value
      from metric_points
      where ts >= $1::timestamptz and ts <= $2::timestamptz
        and asset_id = $3 and namespace = $4 and metric = $5
        ${dimsSql}
      order by ts asc
      limit $${params.length}`;

    const r = await pool.query(sql, params);
    return res.json({
      ok: true,
      result: {
        columns: [
          { name: 'ts', type: 'timestamptz' },
          { name: 'value', type: 'float8' }
        ],
        rows: r.rows
      }
    });
  }

  if (q.kind === 'timeseries_multi') {
    const src = chooseSource(q.from, q.to);

    // performance-first: default to bucketed if bucket_sec not provided.
    // For rollup sources, bucket is fixed.
    const effectiveBucket = src.bucket_sec ?? (q.bucket_sec ?? chooseBucket(q.from, q.to));

    // Default limit based on expected buckets.
    const fromMs = Date.parse(q.from);
    const toMs = Date.parse(q.to);
    const rangeSec = Math.max(0, Math.floor((toMs - fromMs) / 1000));
    const buckets = effectiveBucket ? Math.max(1, Math.ceil(rangeSec / effectiveBucket)) : Math.min(20000, rangeSec);

    const defaultLimit = Math.min(20000, buckets * q.series.length * (q.group_by_dimension ? 20 : 1));
    const limit = q.limit ?? defaultLimit;

    // Build a UNION ALL query: each series is a subquery.
    const parts: string[] = [];
    const params: any[] = [];

    const useBucket = !!effectiveBucket;
    const bucket = useBucket ? `${effectiveBucket} seconds` : null;
    const gb = q.group_by_dimension?.trim();

    // Top-N dimension values (default: top 20 by count over 7 days) when group_by_dimension is used.
    let topValues: string[] | null = null;
    if (gb) {
      const topN = q.top_n ?? 20;
      const topBy = q.top_by ?? 'count';
      const lookbackDays = q.top_lookback_days ?? 7;

      // Rank across the UNION of series definitions.
      const rankParts: string[] = [];
      const rankParams: any[] = [gb, String(lookbackDays), q.from, q.to];
      // params: 1=gb, 2=lookbackDays, 3=from, 4=to

      for (const s of q.series) {
        const p0 = rankParams.length;
        rankParams.push(s.asset_id, s.namespace, s.metric);
        const pAsset = p0 + 1;
        const pNs = p0 + 2;
        const pMetric = p0 + 3;

        let dimsSql = '';
        if (s.dimensions && Object.keys(s.dimensions).length) {
          rankParams.push(s.dimensions);
          dimsSql = `and dimensions @> $${rankParams.length}::jsonb`;
        }

        // Keep ranking scoped to a bounded window (intersection of query range and lookback days).
        const timeSql = `ts >= greatest($3::timestamptz, now() - ($2::text || ' days')::interval) and ts <= $4::timestamptz`;

        rankParts.push(`
          select (dimensions ->> $1::text) as dimension, ts, value
          from metric_points
          where ${timeSql}
            and asset_id = $${pAsset} and namespace = $${pNs} and metric = $${pMetric}
            and (dimensions ? $1::text)
            ${dimsSql}
        `);
      }

      const unionSql = rankParts.join('\nunion all\n');

      rankParams.push(topN);
      const pTopN = rankParams.length;

      const rankSql =
        topBy === 'last'
          ? `
            with u as (
              ${unionSql}
            ), last_per_dim as (
              select distinct on (dimension) dimension, value, ts
              from u
              where dimension is not null
              order by dimension, ts desc
            )
            select dimension
            from last_per_dim
            order by value desc nulls last
            limit $${pTopN}
          `
          : `
            with u as (
              ${unionSql}
            )
            select dimension
            from u
            where dimension is not null
            group by dimension
            order by count(*) desc
            limit $${pTopN}
          `;

      const rankRes = await pool.query(rankSql, rankParams);
      topValues = rankRes.rows.map((r: any) => r.dimension).filter((v: any) => typeof v === 'string' && v.length);
      if (!topValues.length) topValues = null;
    }

    // shared range
    params.push(q.from, q.to);
    const pFrom = 1;
    const pTo = 2;

    // Global parameter for dimension key (so we can reuse in filters/selects)
    let pDimKeyGlobal: number | null = null;
    if (gb) {
      params.push(gb);
      pDimKeyGlobal = params.length;
    }

    for (let i = 0; i < q.series.length; i++) {
      const s = q.series[i];
      const label = s.label ?? `${s.asset_id}:${s.namespace}:${s.metric}`;

      params.push(s.asset_id, s.namespace, s.metric, label);
      const pAsset = params.length - 3;
      const pNs = params.length - 2;
      const pMetric = params.length - 1;
      const pLabel = params.length;

      let dimsSql = '';
      if (s.dimensions && Object.keys(s.dimensions).length) {
        params.push(s.dimensions);
        dimsSql = `and dimensions @> $${params.length}::jsonb`;
      }

      // Apply top-N filter for group_by_dimension
      let topDimSql = '';
      if (gb && topValues && topValues.length && pDimKeyGlobal) {
        params.push(topValues);
        const pTopVals = params.length;
        topDimSql = `and (dimensions ->> $${pDimKeyGlobal}::text) = any($${pTopVals}::text[])`;
      }

      const tsExpr = useBucket
        ? `date_bin('${bucket}'::interval, ts, '1970-01-01'::timestamptz)`
        : 'ts';

      let dimSelect = '';
      let dimGroup = '';
      if (gb && pDimKeyGlobal) {
        dimSelect = `, (dimensions ->> $${pDimKeyGlobal}::text) as dimension`;
        dimGroup = `, dimension`;
      }
      const sql = useBucket
        ? `
          select ${tsExpr} as ts,
                 $${pLabel}::text as series
                 ${dimSelect},
                 ${aggExpr(q.agg)} as value
          from metric_points
          where ts >= $${pFrom}::timestamptz and ts <= $${pTo}::timestamptz
            and asset_id = $${pAsset} and namespace = $${pNs} and metric = $${pMetric}
            ${dimsSql}
            ${topDimSql}
          group by ts, series ${dimGroup}
        `
        : `
          select ${tsExpr} as ts,
                 $${pLabel}::text as series
                 ${dimSelect},
                 value::double precision as value
          from metric_points
          where ts >= $${pFrom}::timestamptz and ts <= $${pTo}::timestamptz
            and asset_id = $${pAsset} and namespace = $${pNs} and metric = $${pMetric}
            ${dimsSql}
            ${topDimSql}
        `;

      parts.push(sql);
    }

    params.push(limit);

    const finalSql = `
      ${parts.join('\nunion all\n')}
      order by ts asc
      limit $${params.length}`;

    const r = await pool.query(finalSql, params);

    const columns = gb
      ? [
          { name: 'ts', type: 'timestamptz' },
          { name: 'series', type: 'text' },
          { name: 'dimension', type: 'text' },
          { name: 'value', type: 'float8' }
        ]
      : [
          { name: 'ts', type: 'timestamptz' },
          { name: 'series', type: 'text' },
          { name: 'value', type: 'float8' }
        ];

    return res.json({
      ok: true,
      result: { columns, rows: r.rows },
      meta: {
        effective_bucket_sec: effectiveBucket ?? undefined,
        effective_limit: limit,
        mode: useBucket ? 'bucketed' : 'raw',
        source_table: src.table as any
      }
    });
  }

  // event_count — bucketed EPS
  if (q.kind === 'event_count') {
    const bucketSec = q.bucket_sec ?? chooseBucket(q.from, q.to);
    const bucket = `${bucketSec} seconds`;
    const params: any[] = [bucket, bucketSec, q.from, q.to];
    const where: string[] = ['ts >= $3::timestamptz', 'ts <= $4::timestamptz'];

    if (q.namespace)          { params.push(q.namespace);   where.push(`namespace = $${params.length}`); }
    if (q.asset_id)           { params.push(q.asset_id);    where.push(`asset_id = $${params.length}`); }
    if (q.severities?.length) { params.push(q.severities);  where.push(`severity = any($${params.length}::text[])`); }

    params.push(10000);
    const sql = `
      select
        date_bin($1::interval, ts, '1970-01-01'::timestamptz) as ts,
        count(*)::float / $2 as value
      from orbit_events
      where ${where.join(' and ')}
      group by 1
      order by 1 asc
      limit $${params.length}`;

    const r = await pool.query(sql, params);
    return res.json({
      ok: true,
      result: {
        columns: [{ name: 'ts', type: 'timestamptz' }, { name: 'value', type: 'float8' }],
        rows: r.rows
      },
      meta: { effective_bucket_sec: bucketSec }
    });
  }

  // events
  {
    const limit = q.limit ?? 200;
    const params: any[] = [q.from, q.to];
    const where: string[] = ['ts >= $1::timestamptz', 'ts <= $2::timestamptz'];

    if (q.asset_id) {
      params.push(q.asset_id);
      where.push(`asset_id = $${params.length}`);
    }
    if (q.namespace) {
      params.push(q.namespace);
      where.push(`namespace = $${params.length}`);
    }
    if (q.severities?.length) {
      params.push(q.severities);
      where.push(`severity = any($${params.length}::text[])`);
    }
    if (q.kinds?.length) {
      params.push(q.kinds);
      where.push(`kind = any($${params.length}::text[])`);
    }

    params.push(limit);
    const sql = `
      select ts, asset_id, namespace, kind, severity, title, message
      from orbit_events
      where ${where.join(' and ')}
      order by ts desc
      limit $${params.length}`;

    const r = await pool.query(sql, params);
    return res.json({
      ok: true,
      result: {
        columns: [
          { name: 'ts', type: 'timestamptz' },
          { name: 'asset_id', type: 'text' },
          { name: 'namespace', type: 'text' },
          { name: 'kind', type: 'text' },
          { name: 'severity', type: 'text' },
          { name: 'title', type: 'text' },
          { name: 'message', type: 'text' }
        ],
        rows: r.rows
      }
    });
  }
}
