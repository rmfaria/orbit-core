-- Performance indexes — v1.6.3
-- Addresses findings from performance audit 2026-03-08

-- F1: Composite index for Wazuh dashboard queries (namespace + kind + ts)
-- Speeds up all /wazuh/summary queries that filter by namespace='wazuh' AND kind='...'
-- Note: cannot use CONCURRENTLY on partitioned tables
CREATE INDEX IF NOT EXISTS idx_orbit_events_ns_kind_ts
  ON orbit_events (namespace, kind, ts DESC);

-- F5: Composite indexes on rollup tables for timeseries queries
-- Query pattern: WHERE asset_id=$1 AND namespace=$2 AND metric=$3 AND bucket_ts BETWEEN $4 AND $5
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rollup5_asset_ns_metric_ts
  ON metric_rollup_5m (asset_id, namespace, metric, bucket_ts DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rollup1h_asset_ns_metric_ts
  ON metric_rollup_1h (asset_id, namespace, metric, bucket_ts DESC);

-- F7: Index for global alert history listing (without rule_id filter)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alert_notif_sent
  ON alert_notifications (sent_at DESC);

-- F12: Drop redundant fingerprint-only index (covered by fingerprint+ts unique index)
DROP INDEX IF EXISTS idx_orbit_events_fingerprint;

-- Retention: add cleanup for tables missing from purge_old_data
-- connector_runs: keep 30 days
-- alert_notifications: keep 90 days
CREATE OR REPLACE FUNCTION purge_connector_alert_data() RETURNS void AS $$
BEGIN
  DELETE FROM connector_runs WHERE started_at < now() - interval '30 days';
  DELETE FROM alert_notifications WHERE sent_at < now() - interval '90 days';
END;
$$ LANGUAGE plpgsql;
