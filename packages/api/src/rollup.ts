// Rollup worker — runs inside the API process.
//
// Every 5 minutes: materialise metric_rollup_5m for the last 2 completed
// 5-minute buckets (gives a 5-minute overlap to handle late-arriving data).
//
// Every 60 minutes: materialise metric_rollup_1h for the last 2 completed
// 1-hour buckets.
//
// Every 24 hours: purge old data via purge_old_data() (migration 0006).
//
// Both rollup queries use INSERT … ON CONFLICT DO UPDATE so re-runs are idempotent.

import type { Pool } from 'pg';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'rollup' });

const ROLLUP_5M_INTERVAL_MS  =  5 * 60 * 1000;
const ROLLUP_1H_INTERVAL_MS  = 60 * 60 * 1000;
const RETENTION_INTERVAL_MS  = 24 * 60 * 60 * 1000;

// Retention windows — override via env vars (values in days).
const RETAIN_RAW_DAYS     = Number(process.env.ORBIT_RETAIN_RAW_DAYS     ?? 14);
const RETAIN_5M_DAYS      = Number(process.env.ORBIT_RETAIN_5M_DAYS      ?? 90);
const RETAIN_1H_DAYS      = Number(process.env.ORBIT_RETAIN_1H_DAYS      ?? 180);
const RETAIN_EVENTS_DAYS  = Number(process.env.ORBIT_RETAIN_EVENTS_DAYS  ?? 180);

// Number of completed buckets to (re)compute on each run — handles late data.
const LOOKBACK_BUCKETS_5M = 2;
const LOOKBACK_BUCKETS_1H = 2;

async function rollup5m(pool: Pool): Promise<void> {
  // Recompute the last N completed 5-minute buckets.
  // date_trunc('hour',...) + floor(min/5)*5 gives the bucket start aligned to
  // wall-clock 5-minute boundaries.
  const sql = `
    insert into metric_rollup_5m
      (bucket_ts, asset_id, namespace, metric, dimensions, dimensions_hash,
       avg, min, max, sum, count)
    select
      date_bin('5 minutes', ts, '1970-01-01'::timestamptz)        as bucket_ts,
      asset_id,
      namespace,
      metric,
      dimensions,
      md5(dimensions::text)                                         as dimensions_hash,
      avg(value)::double precision,
      min(value)::double precision,
      max(value)::double precision,
      sum(value)::double precision,
      count(*)::bigint
    from metric_points
    where ts >= date_bin('5 minutes', now(), '1970-01-01'::timestamptz)
                 - ($1::int * interval '5 minutes')
      and ts <  date_bin('5 minutes', now(), '1970-01-01'::timestamptz)
    group by 1, asset_id, namespace, metric, dimensions
    on conflict (bucket_ts, asset_id, namespace, metric, dimensions_hash)
    do update set
      avg   = excluded.avg,
      min   = excluded.min,
      max   = excluded.max,
      sum   = excluded.sum,
      count = excluded.count
  `;
  const res = await pool.query(sql, [LOOKBACK_BUCKETS_5M]);
  logger.info({ rows: res.rowCount }, 'rollup_5m done');
}

async function rollup1h(pool: Pool): Promise<void> {
  // Aggregate from metric_rollup_5m (not raw points) for efficiency.
  const sql = `
    insert into metric_rollup_1h
      (bucket_ts, asset_id, namespace, metric, dimensions, dimensions_hash,
       avg, min, max, sum, count)
    select
      date_bin('1 hour', bucket_ts, '1970-01-01'::timestamptz)    as bucket_ts,
      asset_id,
      namespace,
      metric,
      dimensions,
      dimensions_hash,
      -- weighted average from 5m avg+count
      (sum(avg * count) / nullif(sum(count), 0))::double precision as avg,
      min(min)::double precision,
      max(max)::double precision,
      sum(sum)::double precision,
      sum(count)::bigint
    from metric_rollup_5m
    where bucket_ts >= date_bin('1 hour', now(), '1970-01-01'::timestamptz)
                       - ($1::int * interval '1 hour')
      and bucket_ts <  date_bin('1 hour', now(), '1970-01-01'::timestamptz)
    group by 1, asset_id, namespace, metric, dimensions, dimensions_hash
    on conflict (bucket_ts, asset_id, namespace, metric, dimensions_hash)
    do update set
      avg   = excluded.avg,
      min   = excluded.min,
      max   = excluded.max,
      sum   = excluded.sum,
      count = excluded.count
  `;
  const res = await pool.query(sql, [LOOKBACK_BUCKETS_1H]);
  logger.info({ rows: res.rowCount }, 'rollup_1h done');
}

async function runSafe(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error({ err, job: name }, 'rollup job failed');
  }
}

async function purgeOldData(pool: Pool): Promise<void> {
  const res = await pool.query(
    `select * from purge_old_data($1, $2, $3, $4)`,
    [RETAIN_RAW_DAYS, RETAIN_5M_DAYS, RETAIN_1H_DAYS, RETAIN_EVENTS_DAYS]
  );
  for (const row of res.rows) {
    if (row.rows_deleted > 0) {
      logger.info({ table: row.table_name, deleted: Number(row.rows_deleted) }, 'retention purge');
    }
  }
}

export function startRollupWorker(pool: Pool): () => void {
  // Run rollups immediately on start (catches any gap since last restart),
  // then on their respective intervals.
  runSafe('rollup_5m', () => rollup5m(pool));

  const t5m = setInterval(() => runSafe('rollup_5m', () => rollup5m(pool)), ROLLUP_5M_INTERVAL_MS);
  const t1h = setInterval(() => runSafe('rollup_1h', () => rollup1h(pool)), ROLLUP_1H_INTERVAL_MS);

  // Run 1h rollup once at start as well, offset by 30 s to avoid thundering.
  const t1hInit = setTimeout(() => runSafe('rollup_1h', () => rollup1h(pool)), 30_000);

  // Retention: run once at startup (offset 60 s) then every 24 h.
  const tRetentionInit = setTimeout(() => runSafe('retention', () => purgeOldData(pool)), 60_000);
  const tRetention = setInterval(() => runSafe('retention', () => purgeOldData(pool)), RETENTION_INTERVAL_MS);

  logger.info(
    { retain_raw_days: RETAIN_RAW_DAYS, retain_5m_days: RETAIN_5M_DAYS,
      retain_1h_days: RETAIN_1H_DAYS, retain_events_days: RETAIN_EVENTS_DAYS },
    'rollup worker started (5m + 1h + retention)'
  );

  return () => {
    clearInterval(t5m);
    clearInterval(t1h);
    clearInterval(tRetention);
    clearTimeout(t1hInit);
    clearTimeout(tRetentionInit);
  };
}
