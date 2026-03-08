// correlate.ts — background event-metric correlation engine.
//
// Runs every 5 minutes. Three correlation modes:
//
//   MODE 1 — Metric anomaly (original):
//     For events with severity medium/high/critical, check if any metric
//     for the same asset spiked (z-score ≥ 2σ or Δ ≥ 50%) around event time.
//
//   MODE 2 — Event frequency anomaly:
//     For every asset with recent events, compare the event rate in the last
//     window vs the 24h baseline. If the burst exceeds the threshold, record
//     an anomaly with metric_ns='_events' and metric='frequency'.
//
//   MODE 3 — Severity escalation:
//     For every asset, compare the ratio of high/critical events in the last
//     window vs the 24h baseline. Spike → anomaly with metric='severity_ratio'.
//
// All modes write to orbit_correlations with idempotent ON CONFLICT DO UPDATE.

import type { Pool } from 'pg';
import pino from 'pino';
import { heartbeat, workerError } from './worker-registry.js';

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

// Only correlate events with these severities (mode 1).
const SEV_FILTER = ['medium', 'high', 'critical'];

// How far back to look for events on each run.
const LOOKBACK_H = 2;

// Event frequency anomaly: window in minutes for burst detection.
const FREQ_WIN_MIN = 30;
// Minimum events in the burst window to consider (avoids noise from low-volume assets).
const FREQ_MIN_EVENTS = 5;

// ─── MODE 1: Metric anomaly ─────────────────────────────────────────────────

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

async function runMetricCorrelation(pool: Pool): Promise<number> {
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

  if (evRes.rows.length === 0) return 0;

  let anomalyCount = 0;

  for (const ev of evRes.rows) {
    const { event_key, asset_id, event_ts } = ev;

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

      await persistCorrelation(pool, event_ts, event_key, asset_id, mns, metric,
        baseline_avg, baseline_std, peak_value, zScore, relChange);
      anomalyCount++;

      logger.info(
        { asset_id, metric: `${mns}/${metric}`, z_score: zScore?.toFixed(2),
          rel_change: relChange != null ? `${(relChange * 100).toFixed(1)}%` : null },
        'correlate: metric anomaly detected'
      );
    }
  }

  return anomalyCount;
}

// ─── MODE 2: Event frequency anomaly ─────────────────────────────────────────

async function runFrequencyCorrelation(pool: Pool): Promise<number> {
  // Compare event count in the last FREQ_WIN_MIN vs 24h hourly baseline per asset+namespace.
  const res = await pool.query<{
    asset_id: string;
    namespace: string;
    recent_count: number;
    baseline_avg: number;
    baseline_std: number;
  }>(`
    WITH recent AS (
      SELECT asset_id, namespace, count(*)::float8 AS recent_count
      FROM orbit_events
      WHERE ts >= now() - make_interval(mins => $1)
      GROUP BY asset_id, namespace
      HAVING count(*) >= $2
    ),
    hourly AS (
      SELECT asset_id, namespace,
             date_trunc('hour', ts) AS h,
             count(*)::float8 AS cnt
      FROM orbit_events
      WHERE ts >= now() - make_interval(hours => $3)
        AND ts <  now() - make_interval(mins => $1)
        AND (asset_id, namespace) IN (SELECT asset_id, namespace FROM recent)
      GROUP BY asset_id, namespace, date_trunc('hour', ts)
    ),
    baselines AS (
      SELECT asset_id, namespace,
             AVG(cnt)::float8    AS baseline_avg,
             STDDEV(cnt)::float8 AS baseline_std
      FROM hourly
      GROUP BY asset_id, namespace
      HAVING count(*) >= 3
    )
    SELECT r.asset_id, r.namespace,
           r.recent_count,
           b.baseline_avg,
           COALESCE(b.baseline_std, 0)::float8 AS baseline_std
    FROM recent r
    JOIN baselines b USING (asset_id, namespace)
  `, [FREQ_WIN_MIN, FREQ_MIN_EVENTS, BASELINE_H]);

  let anomalyCount = 0;

  for (const row of res.rows) {
    const { asset_id, namespace: ns, recent_count, baseline_avg, baseline_std } = row;

    // Normalize to same time unit (events per FREQ_WIN_MIN window vs hourly baseline scaled)
    const scaledBaseline = baseline_avg * (FREQ_WIN_MIN / 60);
    const scaledStd      = baseline_std * (FREQ_WIN_MIN / 60);

    const zScore = scaledStd > 0
      ? (recent_count - scaledBaseline) / scaledStd
      : null;
    const relChange = scaledBaseline > 0
      ? (recent_count - scaledBaseline) / scaledBaseline
      : null;

    const isAnomaly =
      (zScore != null && zScore >= Z_THRESHOLD) ||
      (relChange != null && relChange >= REL_THRESHOLD);

    if (!isAnomaly) continue;

    const eventKey = `freq:${asset_id}:${ns}:${new Date().toISOString().slice(0, 13)}`;

    await persistCorrelation(pool, new Date(), eventKey, asset_id, ns, 'event_frequency',
      scaledBaseline, scaledStd, recent_count, zScore, relChange);
    anomalyCount++;

    logger.info(
      { asset_id, namespace: ns, recent: recent_count, baseline: scaledBaseline.toFixed(1),
        z_score: zScore?.toFixed(2) },
      'correlate: event frequency anomaly'
    );
  }

  return anomalyCount;
}

// ─── MODE 3: Severity escalation ─────────────────────────────────────────────

async function runSeverityCorrelation(pool: Pool): Promise<number> {
  // Compare ratio of high/critical events in the last window vs 24h baseline.
  const res = await pool.query<{
    asset_id: string;
    namespace: string;
    recent_severe: number;
    recent_total: number;
    baseline_ratio_avg: number;
    baseline_ratio_std: number;
  }>(`
    WITH recent AS (
      SELECT asset_id, namespace,
             count(*) FILTER (WHERE severity IN ('high','critical'))::float8 AS recent_severe,
             count(*)::float8 AS recent_total
      FROM orbit_events
      WHERE ts >= now() - make_interval(mins => $1)
      GROUP BY asset_id, namespace
      HAVING count(*) >= $2
    ),
    hourly AS (
      SELECT asset_id, namespace,
             date_trunc('hour', ts) AS h,
             count(*) FILTER (WHERE severity IN ('high','critical'))::float8 /
               GREATEST(count(*)::float8, 1) AS ratio
      FROM orbit_events
      WHERE ts >= now() - make_interval(hours => $3)
        AND ts <  now() - make_interval(mins => $1)
        AND (asset_id, namespace) IN (SELECT asset_id, namespace FROM recent)
      GROUP BY asset_id, namespace, date_trunc('hour', ts)
    ),
    baselines AS (
      SELECT asset_id, namespace,
             AVG(ratio)::float8    AS baseline_ratio_avg,
             STDDEV(ratio)::float8 AS baseline_ratio_std
      FROM hourly
      GROUP BY asset_id, namespace
      HAVING count(*) >= 3
    )
    SELECT r.asset_id, r.namespace,
           r.recent_severe, r.recent_total,
           b.baseline_ratio_avg,
           COALESCE(b.baseline_ratio_std, 0)::float8 AS baseline_ratio_std
    FROM recent r
    JOIN baselines b USING (asset_id, namespace)
    WHERE r.recent_severe > 0
  `, [FREQ_WIN_MIN, FREQ_MIN_EVENTS, BASELINE_H]);

  let anomalyCount = 0;

  for (const row of res.rows) {
    const { asset_id, namespace: ns, recent_severe, recent_total,
            baseline_ratio_avg, baseline_ratio_std } = row;

    const currentRatio = recent_severe / Math.max(recent_total, 1);

    const zScore = baseline_ratio_std > 0
      ? (currentRatio - baseline_ratio_avg) / baseline_ratio_std
      : null;
    const relChange = baseline_ratio_avg > 0
      ? (currentRatio - baseline_ratio_avg) / baseline_ratio_avg
      : null;

    const isAnomaly =
      (zScore != null && zScore >= Z_THRESHOLD) ||
      (relChange != null && relChange >= REL_THRESHOLD);

    if (!isAnomaly) continue;

    const eventKey = `sev:${asset_id}:${ns}:${new Date().toISOString().slice(0, 13)}`;

    await persistCorrelation(pool, new Date(), eventKey, asset_id, ns, 'severity_ratio',
      baseline_ratio_avg, baseline_ratio_std, currentRatio, zScore, relChange);
    anomalyCount++;

    logger.info(
      { asset_id, namespace: ns, ratio: `${(currentRatio*100).toFixed(1)}%`,
        baseline: `${(baseline_ratio_avg*100).toFixed(1)}%`, z_score: zScore?.toFixed(2) },
      'correlate: severity escalation'
    );
  }

  return anomalyCount;
}

// ─── Shared persistence ──────────────────────────────────────────────────────

async function persistCorrelation(
  pool: Pool,
  eventTs: Date,
  eventKey: string,
  assetId: string,
  metricNs: string,
  metric: string,
  baselineAvg: number | null,
  baselineStd: number | null,
  peakValue: number,
  zScore: number | null,
  relChange: number | null,
): Promise<void> {
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
    [eventTs, eventKey, assetId, metricNs, metric,
     baselineAvg, baselineStd, peakValue, zScore, relChange]
  );
}

// ─── Main runner ─────────────────────────────────────────────────────────────

async function runCorrelation(pool: Pool): Promise<void> {
  const [metricAnomalies, freqAnomalies, sevAnomalies] = await Promise.all([
    runMetricCorrelation(pool),
    runFrequencyCorrelation(pool),
    runSeverityCorrelation(pool),
  ]);

  const total = metricAnomalies + freqAnomalies + sevAnomalies;
  if (total > 0) {
    logger.info(
      { metric: metricAnomalies, frequency: freqAnomalies, severity: sevAnomalies, total },
      'correlate: run complete'
    );
  }
}

async function runSafe(pool: Pool): Promise<void> {
  const t0 = Date.now();
  try {
    await runCorrelation(pool);
    logger.debug({ ms: Date.now() - t0 }, 'correlate: job finished');
    heartbeat('correlate');
  } catch (err) {
    logger.error({ err }, 'correlate: job failed');
    workerError('correlate');
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
      freq_win_min:  FREQ_WIN_MIN,
    },
    'correlate worker started (3 modes: metric, frequency, severity)'
  );

  return () => {
    clearTimeout(tInit);
    clearInterval(tInterval);
  };
}
