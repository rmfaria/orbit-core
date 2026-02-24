// correlate.ts — background event-metric correlation engine.
//
// Runs every 5 minutes. Algorithm per event:
//   1. Find all metrics for the same asset_id within ±WIN_MIN of the event.
//   2. Compute baseline (avg + stddev) from the 24 h preceding the event
//      (excluding the ±WIN_MIN window, which may be noisy).
//   3. Find the peak value within ±PEAK_MIN of the event.
//   4. Compute z_score = (peak − avg) / stddev  and
//      rel_change = (peak − avg) / |avg|.
//   5. If z_score ≥ Z_THRESHOLD  OR  rel_change ≥ REL_THRESHOLD → anomaly.
//   6. INSERT … ON CONFLICT DO UPDATE → idempotent; re-runs are safe.

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

  for (const ev of evRes.rows) {
    const { event_key, asset_id, event_ts } = ev;

    // Step 2 — discover metrics active near this event.
    const mRes = await pool.query<{ namespace: string; metric: string }>(
      `SELECT DISTINCT namespace, metric
       FROM metric_points
       WHERE asset_id = $1
         AND ts BETWEEN $2::timestamptz - ($3 || ' minutes')::interval
                    AND $2::timestamptz + ($3 || ' minutes')::interval`,
      [asset_id, event_ts, WIN_MIN]
    );

    if (mRes.rows.length === 0) continue;

    for (const { namespace: mns, metric } of mRes.rows) {
      // Step 3 — baseline stats (avg + stddev) from 24 h before the event,
      // excluding the noisy window around the event itself.
      const blRes = await pool.query<{
        baseline_avg: string | null;
        baseline_std: string | null;
      }>(
        `SELECT
           AVG(value)::double precision    AS baseline_avg,
           STDDEV(value)::double precision AS baseline_std
         FROM metric_points
         WHERE asset_id  = $1
           AND namespace = $2
           AND metric    = $3
           AND ts >= $4::timestamptz - ($5 || ' hours')::interval
           AND ts <  $4::timestamptz - ($6 || ' minutes')::interval`,
        [asset_id, mns, metric, event_ts, BASELINE_H, WIN_MIN]
      );

      const baselineAvg =
        blRes.rows[0]?.baseline_avg != null ? Number(blRes.rows[0].baseline_avg) : null;
      const baselineStd =
        blRes.rows[0]?.baseline_std != null ? Number(blRes.rows[0].baseline_std) : null;

      if (baselineAvg == null) continue; // insufficient baseline data

      // Step 4 — peak value in the tighter ±PEAK_MIN window.
      const pkRes = await pool.query<{ peak_value: string | null }>(
        `SELECT MAX(value)::double precision AS peak_value
         FROM metric_points
         WHERE asset_id  = $1
           AND namespace = $2
           AND metric    = $3
           AND ts BETWEEN $4::timestamptz - ($5 || ' minutes')::interval
                      AND $4::timestamptz + ($5 || ' minutes')::interval`,
        [asset_id, mns, metric, event_ts, PEAK_MIN]
      );

      const peakValue =
        pkRes.rows[0]?.peak_value != null ? Number(pkRes.rows[0].peak_value) : null;
      if (peakValue == null) continue;

      // Step 5 — compute scores.
      const zScore =
        baselineStd != null && baselineStd > 0
          ? (peakValue - baselineAvg) / baselineStd
          : null;
      const relChange =
        Math.abs(baselineAvg) > 0
          ? (peakValue - baselineAvg) / Math.abs(baselineAvg)
          : null;

      const isAnomaly =
        (zScore != null && zScore >= Z_THRESHOLD) ||
        (relChange != null && relChange >= REL_THRESHOLD);

      if (!isAnomaly) continue;

      // Step 6 — persist (idempotent).
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
          baselineAvg, baselineStd, peakValue, zScore, relChange,
        ]
      );

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
}

async function runSafe(pool: Pool): Promise<void> {
  try {
    await runCorrelation(pool);
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
