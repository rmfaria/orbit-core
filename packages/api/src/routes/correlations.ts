import type { Request, Response } from 'express';
import { pool } from '../db.js';

export async function correlationsHandler(req: Request, res: Response): Promise<void> {
  if (!pool) {
    (res as Response).status(500).json({ ok: false, error: 'DATABASE_URL not configured' });
    return;
  }

  const limit = Math.min(Number(req.query.limit ?? 200), 1000);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (req.query.asset_id) {
    params.push(req.query.asset_id);
    conditions.push(`asset_id = $${params.length}`);
  }
  if (req.query.from) {
    params.push(req.query.from);
    conditions.push(`event_ts >= $${params.length}::timestamptz`);
  }
  if (req.query.to) {
    params.push(req.query.to);
    conditions.push(`event_ts <= $${params.length}::timestamptz`);
  }
  if (req.query.min_z) {
    params.push(Number(req.query.min_z));
    conditions.push(`z_score >= $${params.length}`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(limit);

  const sql = `
    SELECT
      event_key, event_ts, asset_id, metric_ns, metric,
      baseline_avg, baseline_std, peak_value, z_score, rel_change, detected_at
    FROM orbit_correlations
    ${where}
    ORDER BY detected_at DESC
    LIMIT $${params.length}
  `;

  const result = await pool.query(sql, params);
  res.json({ ok: true, correlations: result.rows });
}

/** Aggregated summary for the modernized correlations dashboard.
 *  Pulls from orbit_correlations + orbit_events + metric_points + assets
 *  so we see ALL assets from ALL sources, not just those with anomalies. */
export async function correlationsSummaryHandler(req: Request, res: Response): Promise<void> {
  if (!pool) {
    (res as Response).status(500).json({ ok: false, error: 'DATABASE_URL not configured' });
    return;
  }

  // Build WHERE clauses. For standalone queries each uses its own $1,$2.
  // For combined queries (byNamespace, byAsset) we build offset versions.
  const fromTs = req.query.from as string | undefined;
  const toTs   = req.query.to   as string | undefined;

  const corrParams: unknown[] = [];
  const corrConds: string[] = [];
  const evtParams: unknown[] = [];
  const evtConds: string[] = ['TRUE'];

  if (fromTs) {
    corrParams.push(fromTs);
    corrConds.push(`event_ts >= $${corrParams.length}::timestamptz`);
    evtParams.push(fromTs);
    evtConds.push(`ts >= $${evtParams.length}::timestamptz`);
  }
  if (toTs) {
    corrParams.push(toTs);
    corrConds.push(`event_ts <= $${corrParams.length}::timestamptz`);
    evtParams.push(toTs);
    evtConds.push(`ts <= $${evtParams.length}::timestamptz`);
  }

  const corrWhere = corrConds.length ? 'WHERE ' + corrConds.join(' AND ') : '';
  const evtWhere  = 'WHERE ' + evtConds.join(' AND ');

  // For combined queries: corr params first, then evt params with offset placeholders
  const comboParams = [...corrParams, ...evtParams];
  const offset = corrParams.length;
  const evtCondsOffset: string[] = ['TRUE'];
  let evtIdx = offset;
  if (fromTs) { evtIdx++; evtCondsOffset.push(`ts >= $${evtIdx}::timestamptz`); }
  if (toTs)   { evtIdx++; evtCondsOffset.push(`ts <= $${evtIdx}::timestamptz`); }
  const evtWhereOffset = 'WHERE ' + evtCondsOffset.join(' AND ');

  // Run all aggregation queries in parallel
  const [kpis, byNamespace, byAsset, timelineEvts, timelineCorr, topAnomalies, allAssets, eventSources] = await Promise.all([
    // KPIs from correlations
    pool.query(`
      SELECT
        count(*)::int                                    AS total,
        count(DISTINCT asset_id)::int                    AS affected_assets,
        count(DISTINCT metric_ns)::int                   AS namespaces,
        COALESCE(avg(z_score), 0)::float8                AS avg_z,
        COALESCE(max(z_score), 0)::float8                AS max_z,
        COALESCE(avg(abs(rel_change)), 0)::float8        AS avg_rel,
        count(*) FILTER (WHERE z_score >= 4)::int        AS critical_count,
        count(*) FILTER (WHERE z_score >= 2 AND z_score < 4)::int AS high_count
      FROM orbit_correlations ${corrWhere}
    `, corrParams),

    // Per-namespace: combine correlations + event counts from orbit_events
    pool.query(`
      WITH corr_ns AS (
        SELECT metric_ns AS ns,
               count(*)::int AS anomaly_count,
               COALESCE(avg(z_score), 0)::float8 AS avg_z,
               COALESCE(max(z_score), 0)::float8 AS max_z,
               COALESCE(avg(abs(rel_change)), 0)::float8 AS avg_rel,
               count(DISTINCT asset_id)::int AS asset_count,
               count(DISTINCT metric)::int AS metric_count
        FROM orbit_correlations ${corrWhere}
        GROUP BY metric_ns
      ),
      evt_ns AS (
        SELECT namespace AS ns,
               count(*)::int AS event_count,
               count(DISTINCT asset_id)::int AS evt_asset_count,
               count(*) FILTER (WHERE severity IN ('high','critical'))::int AS severe_events
        FROM orbit_events ${evtWhereOffset}
        GROUP BY namespace
      )
      SELECT COALESCE(c.ns, e.ns)                      AS metric_ns,
             COALESCE(c.anomaly_count, 0)               AS anomaly_count,
             COALESCE(c.avg_z, 0)                       AS avg_z,
             COALESCE(c.max_z, 0)                       AS max_z,
             COALESCE(c.avg_rel, 0)                     AS avg_rel,
             COALESCE(c.asset_count, e.evt_asset_count, 0) AS asset_count,
             COALESCE(c.metric_count, 0)                AS metric_count,
             COALESCE(e.event_count, 0)                 AS event_count,
             COALESCE(e.severe_events, 0)               AS severe_events
      FROM corr_ns c
      FULL OUTER JOIN evt_ns e ON c.ns = e.ns
      ORDER BY COALESCE(c.anomaly_count, 0) + COALESCE(e.event_count, 0) DESC
    `, comboParams),

    // Per-asset: ALL assets with correlation stats + event severity summary
    pool.query(`
      WITH corr_a AS (
        SELECT asset_id,
               count(*)::int AS anomaly_count,
               COALESCE(avg(z_score), 0)::float8 AS avg_z,
               COALESCE(max(z_score), 0)::float8 AS max_z,
               count(DISTINCT metric_ns)::int AS namespace_count,
               count(*) FILTER (WHERE z_score >= 4)::int AS critical_count,
               max(detected_at) AS last_anomaly
        FROM orbit_correlations ${corrWhere}
        GROUP BY asset_id
      ),
      evt_a AS (
        SELECT asset_id,
               count(*)::int AS event_count,
               array_agg(DISTINCT namespace) AS sources,
               count(*) FILTER (WHERE severity = 'critical')::int AS crit_events,
               count(*) FILTER (WHERE severity = 'high')::int AS high_events,
               max(ts) AS last_event
        FROM orbit_events ${evtWhereOffset}
        GROUP BY asset_id
      )
      SELECT a.asset_id,
             a.name,
             COALESCE(c.anomaly_count, 0) AS anomaly_count,
             COALESCE(c.avg_z, 0)         AS avg_z,
             COALESCE(c.max_z, 0)         AS max_z,
             COALESCE(c.namespace_count,0) AS namespace_count,
             COALESCE(c.critical_count, 0) AS critical_count,
             c.last_anomaly,
             COALESCE(e.event_count, 0)    AS event_count,
             COALESCE(e.sources, '{}')     AS sources,
             COALESCE(e.crit_events, 0)    AS crit_events,
             COALESCE(e.high_events, 0)    AS high_events,
             e.last_event
      FROM assets a
      LEFT JOIN corr_a c ON c.asset_id = a.asset_id
      LEFT JOIN evt_a  e ON e.asset_id = a.asset_id
      WHERE c.asset_id IS NOT NULL OR e.asset_id IS NOT NULL
      ORDER BY COALESCE(c.anomaly_count,0) + COALESCE(e.crit_events,0) DESC, a.asset_id
    `, comboParams),

    // Timeline (hourly buckets) — events only (anomaly count added client-side if needed)
    pool.query(`
      SELECT
        date_trunc('hour', ts)::text AS bucket,
        count(*)::int AS event_count,
        count(*) FILTER (WHERE severity IN ('high','critical'))::int AS severe_count
      FROM orbit_events ${evtWhere}
      GROUP BY 1
      ORDER BY 1 ASC
    `, evtParams),

    // Timeline anomaly counts (separate query to avoid param index conflict)
    pool.query(`
      SELECT
        date_trunc('hour', event_ts)::text AS bucket,
        count(*)::int AS anomaly_count
      FROM orbit_correlations ${corrWhere}
      GROUP BY 1
      ORDER BY 1 ASC
    `, corrParams),

    // Top anomalies by z-score (from correlations)
    pool.query(`
      SELECT asset_id, metric_ns, metric, z_score, rel_change, peak_value, baseline_avg, event_ts, detected_at
      FROM orbit_correlations ${corrWhere}
      ORDER BY z_score DESC NULLS LAST
      LIMIT 10
    `, corrParams),

    // Total registered assets
    pool.query(`SELECT count(*)::int AS total FROM assets`),

    // Distinct event sources/namespaces
    pool.query(`
      SELECT namespace, count(DISTINCT asset_id)::int AS asset_count, count(*)::int AS event_count
      FROM orbit_events ${evtWhere}
      GROUP BY namespace
      ORDER BY event_count DESC
    `, evtParams),
  ]);

  const kpiRow = kpis.rows[0] ?? {};

  // Merge timeline events + correlation anomaly counts by bucket
  const corrByBucket: Record<string, number> = {};
  for (const r of timelineCorr.rows) corrByBucket[r.bucket] = r.anomaly_count;
  const timeline = timelineEvts.rows.map((r: { bucket: string; event_count: number; severe_count: number }) => ({
    ...r,
    anomaly_count: corrByBucket[r.bucket] ?? 0,
  }));

  res.json({
    ok: true,
    kpis: {
      ...kpiRow,
      total_assets: allAssets.rows[0]?.total ?? 0,
      total_sources: eventSources.rows.length,
    },
    by_namespace: byNamespace.rows,
    by_asset: byAsset.rows,
    timeline,
    top_anomalies: topAnomalies.rows,
    event_sources: eventSources.rows,
  });
}
