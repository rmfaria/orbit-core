-- 0007_correlations.sql
--
-- Stores metric anomalies automatically correlated with events.
-- event_key = fingerprint column, or a synthetic key built as
--   asset_id:namespace:kind:ts
-- when fingerprint is null.
--
-- z_score     = (peak − baseline_avg) / baseline_std
-- rel_change  = (peak − baseline_avg) / |baseline_avg|
--
-- Both are nullable: z_score is null when baseline_std = 0 (constant series);
-- rel_change is null when baseline_avg = 0.

CREATE TABLE IF NOT EXISTS orbit_correlations (
  id            bigserial        PRIMARY KEY,
  event_ts      timestamptz      NOT NULL,
  event_key     text             NOT NULL,   -- links back to orbit_events
  asset_id      text             NOT NULL,
  metric_ns     text             NOT NULL,   -- namespace of the correlated metric
  metric        text             NOT NULL,
  baseline_avg  double precision,
  baseline_std  double precision,
  peak_value    double precision,
  z_score       double precision,
  rel_change    double precision,
  detected_at   timestamptz      NOT NULL DEFAULT now(),
  UNIQUE (event_key, metric_ns, metric)
);

CREATE INDEX IF NOT EXISTS idx_corr_asset_ts  ON orbit_correlations (asset_id, event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_corr_event_key ON orbit_correlations (event_key);
CREATE INDEX IF NOT EXISTS idx_corr_detected  ON orbit_correlations (detected_at DESC);
