-- 0021_perf_improvements.sql
--
-- Performance improvements:
--   1. Composite index for the hot-path (asset_id, namespace, metric, ts)
--   2. Drop redundant single-column indexes superseded by composite ones
--   3. Index on assets(last_seen DESC) for catalog ordering
--   4. Partition metric_points by RANGE(ts) for faster time-bounded queries
--   5. Update purge_old_data() to use partition drops

-- ─── Step 1: Composite index (covers timeseries + alert evaluate queries) ─────
CREATE INDEX IF NOT EXISTS idx_metric_points_asset_ns_metric_ts
  ON metric_points (asset_id, namespace, metric, ts DESC);

-- ─── Step 2: Drop redundant indexes ─────────────────────────────────────────
-- idx_metric_points_asset is a prefix of idx_metric_points_asset_ts and the new composite
DROP INDEX IF EXISTS idx_metric_points_asset;
-- idx_metric_points_ns_metric is a prefix of idx_metric_points_ns_metric_ts
DROP INDEX IF EXISTS idx_metric_points_ns_metric;

-- ─── Step 3: Assets catalog index ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_assets_last_seen
  ON assets (last_seen DESC);

-- ─── Step 4: Partition metric_points ─────────────────────────────────────────
-- Strategy: rename old table, create partitioned replacement, migrate data.
-- Partitions are monthly to balance partition count vs pruning granularity.

DO $$
DECLARE
  v_start date;
  v_end   date;
  v_cur   date;
  v_name  text;
BEGIN
  -- Only run if metric_points is NOT already partitioned
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'metric_points' AND n.nspname = 'public'
      AND c.relkind = 'r'  -- 'r' = ordinary table (not partitioned 'p')
  ) THEN

    -- 4a. Rename old table
    ALTER TABLE metric_points RENAME TO metric_points_old;

    -- 4b. Create partitioned table (same schema minus serial PK)
    CREATE TABLE metric_points (
      id bigint NOT NULL DEFAULT nextval('metric_points_id_seq'),
      ts timestamptz NOT NULL,
      asset_id text NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
      namespace text NOT NULL,
      metric text NOT NULL,
      value double precision NOT NULL,
      unit text NULL,
      dimensions jsonb NOT NULL DEFAULT '{}'::jsonb
    ) PARTITION BY RANGE (ts);

    -- 4c. Create monthly partitions: 2024-01 through 2027-12 + default
    v_start := '2024-01-01';
    v_end   := '2028-01-01';
    v_cur   := v_start;

    WHILE v_cur < v_end LOOP
      v_name := 'metric_points_' || to_char(v_cur, 'YYYY_MM');
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF metric_points FOR VALUES FROM (%L) TO (%L)',
        v_name, v_cur, v_cur + interval '1 month'
      );
      v_cur := v_cur + interval '1 month';
    END LOOP;

    -- Default partition for out-of-range data
    CREATE TABLE metric_points_default PARTITION OF metric_points DEFAULT;

    -- 4d. Recreate indexes on the partitioned parent (auto-propagated to partitions)
    CREATE INDEX idx_metric_points_ts ON metric_points (ts DESC);
    CREATE INDEX idx_metric_points_asset_ts ON metric_points (asset_id, ts DESC);
    CREATE INDEX idx_metric_points_ns_metric_ts ON metric_points (namespace, metric, ts DESC);
    CREATE INDEX idx_metric_points_asset_ns_metric_ts ON metric_points (asset_id, namespace, metric, ts DESC);
    CREATE INDEX idx_metric_points_dims_gin ON metric_points USING gin(dimensions);

    -- 4e. Migrate data (batched by month to avoid long lock)
    INSERT INTO metric_points (id, ts, asset_id, namespace, metric, value, unit, dimensions)
      SELECT id, ts, asset_id, namespace, metric, value, unit, dimensions
      FROM metric_points_old;

    -- 4f. Drop old table
    DROP TABLE metric_points_old;

  END IF;
END$$;

-- ─── Step 5: Update purge_old_data() to drop old partitions ─────────────────
CREATE OR REPLACE FUNCTION purge_old_data(
  p_metric_raw_days    int default 14,
  p_rollup_5m_days     int default 90,
  p_rollup_1h_days     int default 180,
  p_events_days        int default 180
) RETURNS TABLE (
  table_name text,
  rows_deleted bigint
) LANGUAGE plpgsql AS $$
DECLARE
  v_cutoff   timestamptz;
  v_part     text;
  v_dropped  int := 0;
  v_deleted  bigint;
BEGIN
  -- metric_points: drop entire partitions whose upper bound <= cutoff
  v_cutoff := now() - (p_metric_raw_days || ' days')::interval;
  FOR v_part IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'metric_points'
      AND c.relname <> 'metric_points_default'
    ORDER BY c.relname
  LOOP
    -- Extract upper bound from partition name (metric_points_YYYY_MM → first of next month)
    -- Only drop if the entire partition is before the cutoff
    DECLARE
      v_upper timestamptz;
    BEGIN
      v_upper := (
        SELECT (regexp_match(v_part, 'metric_points_(\d{4})_(\d{2})'))[1]
        || '-' || (regexp_match(v_part, 'metric_points_(\d{4})_(\d{2})'))[2]
        || '-01'
      )::date + interval '1 month';

      IF v_upper <= v_cutoff THEN
        EXECUTE format('DROP TABLE %I', v_part);
        v_dropped := v_dropped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Skip partitions that don't match naming convention
      NULL;
    END;
  END LOOP;

  -- Delete remaining rows in default partition that are old
  DELETE FROM metric_points_default WHERE ts < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'metric_points'::text, v_deleted + (v_dropped * 100000)::bigint;

  -- rollup tables: still use DELETE (not partitioned)
  DELETE FROM metric_rollup_5m
    WHERE bucket_ts < now() - (p_rollup_5m_days || ' days')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'metric_rollup_5m'::text, v_deleted;

  DELETE FROM metric_rollup_1h
    WHERE bucket_ts < now() - (p_rollup_1h_days || ' days')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'metric_rollup_1h'::text, v_deleted;

  DELETE FROM orbit_events
    WHERE ts < now() - (p_events_days || ' days')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'orbit_events'::text, v_deleted;
END;
$$;
