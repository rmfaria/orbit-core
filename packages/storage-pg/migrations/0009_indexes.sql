-- 0009_indexes.sql
--
-- Additional indexes to improve query performance for catalog lookups,
-- correlate worker, and high-cardinality metric scans.

-- Simple index on asset_id for catalog queries that don't filter by ts
-- (e.g. SELECT DISTINCT namespace, metric FROM metric_points WHERE asset_id = $1)
CREATE INDEX IF NOT EXISTS idx_metric_points_asset
  ON metric_points (asset_id);

-- Composite index on namespace+metric for catalog of available metrics
-- (e.g. SELECT DISTINCT namespace, metric FROM metric_points)
CREATE INDEX IF NOT EXISTS idx_metric_points_ns_metric
  ON metric_points (namespace, metric);

-- Partial index on fingerprint for fast event_key lookups in correlate worker
CREATE INDEX IF NOT EXISTS idx_orbit_events_fingerprint
  ON orbit_events (fingerprint)
  WHERE fingerprint IS NOT NULL;

-- Partial index on ts for the correlate worker's severity filter
-- avoids full table scan on every 5-minute run
CREATE INDEX IF NOT EXISTS idx_orbit_events_sev_ts_correlate
  ON orbit_events (ts DESC)
  WHERE severity IN ('medium', 'high', 'critical');
