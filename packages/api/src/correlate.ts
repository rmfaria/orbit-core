// correlate.ts — background event-metric correlation engine.
//
// Runs every 5 minutes. Algorithm per event:
//   1. Find all metrics for the same asset_id within ±WIN_MIN of the event,
//      along with their baseline stats and peak values — all in one CTE query.
//   2. Compute z_score = (peak − avg) / stddev  and
//      rel_change = (peak − avg) / |avg|.
//   3. If z_score ≥ Z_THRESHOLD  OR  rel_change ≥ REL_THRESHOLD → anomaly.
//   4. INSERT … ON CONFLICT DO UPDATE → idempotent; re-runs are safe.
//
// Performance: O(events × 1) queries instead of the previous O(events × metrics × 3).

import type { Pool } from 'pg';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'correlate' });

const CORRELATE_INTERVAL_MS = 5 * 60 * 1000;

// Minutes around the event to search for correlated metric activity.
const WIN_MIN  = 20;
// Narrower window used to extract the peak value.
const PEAK_MIN = 15;
// Hours of history used to build the baseline.
const BASELINE_H = 24;
// Anomaly detection thresholds.
const Z_THRESHOLD   = 2.0;  // standard deviations from mean
const REL_THRESHOLD = 0.5;  // 50 % relative change

// Only correlate events with these severities.
const SEV_FILTER = ['medium', 'high', 'critical'];

// How far back to look for events on each run.
// Wide enough to survive a process restart.
const LOOKBACK_H = 2;

// Single CTE that discovers active metrics + computes baseline + peak in one round-trip.
// Parameters: $1=asset_id, $2=event_ts, $3=WIN_MIN, $4=BASELINE_H, $5=PEAK_MIN
const CORRELATE_CTE = `
  WITH active AS (
    SELECT DISTINCT namespace, metric
    FROM metric_points
    WHERE asset_id = $1
      AND ts BETWEEN $2::timestamptz - make_interval(mins => $3)
               AND $2::timestamptz + make_interval(mins => $3)
  ),
  baselines AS (
    SELECT namespace, metric,
           AVG(value)::float8    AS baseline_avg,
           STDDEV(value)::float8 AS baseline_std
    FROM metric_points
    WHERE asset_id = $1
      AND (namespace, metric) IN (SELECT namespace, metric FROM active)
      AND ts >= $2::timestamptz - make_interval(hours => $4)
      AND ts <  $2::timestamptz - make_interval(mins => $3)
    GROUP BY namespace, metric
  ),
  peaks AS (
    SELECT namespace, metric, MAX(value)::float8 AS peak_value
    FROM metric_points
    WHERE asset_id = $1
      AND (namespace, metric) IN (SELECT namespace, metric FROM active)
      AND ts BETWEEN $2::timestamptz - make_interval(mins => $5)
               AND $2::timestamptz + make_interval(mins => $5)
    GROUP BY namespace, metric
  )
  SELECT b.namespace, b.metric, b.baseline_avg, b.baseline_std, p.peak_value
  FROM baselines b
  JOIN peaks p USING (namespace, metric)
  WHERE b.baseline_avg IS NOT NULL
`;

async function runCorrelation(pool: Pool): Promise<void> {
  // Step 1 — fetch events eligible for correlation.
  const evRes = await pool.query<{
    event_key: string;
    asset_id: string;
    event_ts: Date;
  }>(
    `SELECT
       COALESCE(fingerprint,
         asset_id || ':' || namespace || ':' || kind || ':' || ts::text
       ) AS event_key,
       asset_id,
       ts AS event_ts
     FROM orbit_events
     WHERE severity = ANY($1::text[])
       AND ts >= now() - ($2 || ' hours')::interval
       AND ts <  now() - interval '1 minute'`,
    [SEV_FILTER, LOOKBACK_H]
  );

  if (evRes.rows.length === 0) {
    logger.debug('correlate: no eligible events');
    return;
  }

  logger.debug({ count: evRes.rows.length }, 'correlate: processing events');

  let anomalyCount = 0;

  for (const ev of evRes.rows) {
    const { event_key, asset_id, event_ts } = ev;

    // Step 2 — single CTE returns all active metrics + baseline + peak for this event.
    const statsRes = await pool.query<{
      namespace:    string;
      metric:       string;
      baseline_avg: number;
      baseline_std: number | null;
      peak_value:   number;
    }>(CORRELATE_CTE, [asset_id, event_ts, WIN_MIN, BASELINE_H, PEAK_MIN]);

    if (statsRes.rows.length === 0) continue;

    for (const row of statsRes.rows) {
      const { namespace: mns, metric, baseline_avg, baseline_std, peak_value } = row;

      // Step 3 — compute scores.
      const zScore =
        baseline_std != null && baseline_std > 0
          ? (peak_value - baseline_avg) / baseline_std
          : null;
      const relChange =
        Math.abs(baseline_avg) > 0
          ? (peak_value - baseline_avg) / Math.abs(baseline_avg)
          : null;

      const isAnomaly =
        (zScore != null && zScore >= Z_THRESHOLD) ||
        (relChange != null && relChange >= REL_THRESHOLD);

      if (!isAnomaly) continue;

      // Step 4 — persist (idempotent).
      await pool.query(
        `INSERT INTO orbit_correlations
           (event_ts, event_key, asset_id, metric_ns, metric,
            baseline_avg, baseline_std, peak_value, z_score, rel_change)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (event_key, metric_ns, metric) DO UPDATE SET
           peak_value  = excluded.peak_value,
           z_score     = excluded.z_score,
           rel_change  = excluded.rel_change,
           detected_at = now()`,
        [
          event_ts, event_key, asset_id, mns, metric,
          baseline_avg, baseline_std, peak_value, zScore, relChange,
        ]
      );

      anomalyCount++;
      logger.info(
        {
          asset_id,
          metric: `${mns}/${metric}`,
          z_score: zScore?.toFixed(2),
          rel_change: relChange != null ? `${(relChange * 100).toFixed(1)}%` : null,
        },
        'correlate: anomaly detected'
      );
    }
  }

  if (anomalyCount > 0) {
    logger.info({ events: evRes.rows.length, anomalies: anomalyCount }, 'correlate: run complete');
  }
}

async function runSafe(pool: Pool): Promise<void> {
  const t0 = Date.now();
  try {
    await runCorrelation(pool);
    logger.debug({ ms: Date.now() - t0 }, 'correlate: job finished');
  } catch (err) {
    logger.error({ err }, 'correlate: job failed');
  }
}

export function startCorrelateWorker(pool: Pool): () => void {
  // Offset 90 s from startup so the 5 m rollup can complete first.
  const tInit     = setTimeout(() => runSafe(pool), 90_000);
  const tInterval = setInterval(() => runSafe(pool), CORRELATE_INTERVAL_MS);

  logger.info(
    {
      z_threshold:   Z_THRESHOLD,
      rel_threshold: REL_THRESHOLD,
      lookback_h:    LOOKBACK_H,
      win_min:       WIN_MIN,
    },
    'correlate worker started'
  );

  return () => {
    clearTimeout(tInit);
    clearInterval(tInterval);
  };
}
