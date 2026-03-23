-- 0026_pg_tuning.sql — Autovacuum tuning for large partitions + index optimization

-- orbit_events partitions: 15M+ rows, heavy insert, needs aggressive vacuum
-- Default scale_factor=0.2 = vacuum only at 3M dead tuples on 15M table → too late
-- Note: storage params must be set on leaf partitions, not parent
DO $$
DECLARE
  part text;
BEGIN
  FOR part IN
    SELECT tablename FROM pg_tables
    WHERE tablename LIKE 'orbit_events_%' AND schemaname = 'public'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01, autovacuum_vacuum_cost_delay = 2)',
      part
    );
  END LOOP;
  FOR part IN
    SELECT tablename FROM pg_tables
    WHERE tablename LIKE 'metric_points_%' AND schemaname = 'public'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02)',
      part
    );
  END LOOP;
END $$;

ALTER TABLE metric_rollup_5m SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

-- Optimized index for threat_indicators batch lookup (worker uses lower(value) + enabled filter)
CREATE INDEX IF NOT EXISTS idx_threat_indicators_enabled_lower_value
  ON threat_indicators (lower(value))
  WHERE enabled = true AND (expires_at IS NULL OR expires_at > now());
