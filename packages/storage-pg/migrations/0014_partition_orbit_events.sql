-- Migration 0014: convert orbit_events to monthly range-partitioned table
--
-- Why: with 1.5M+ rows and ON CONFLICT DO UPDATE, table bloat grows fast;
-- DELETE-based retention is O(n). Monthly partitions allow O(1) DROP for
-- retention and partition pruning on all time-range queries.
--
-- Strategy (single transaction, safe rename-swap):
--   1. Rename existing table → orbit_events_legacy  (kept as backup)
--   2. Create orbit_events PARTITION BY RANGE(ts)
--   3. Create monthly child partitions 2025-01 → 2027-12 + default
--   4. Recreate all indexes locally on partitioned parent
--   5. Copy all rows from orbit_events_legacy → orbit_events
--   6. Reset id sequence to max(id)
--   7. Update purge_old_data to DROP entire monthly partitions
--
-- NOTE on fingerprint uniqueness:
--   A UNIQUE constraint including a partition key is required for global
--   uniqueness on partitioned tables. We do NOT include ts in the unique
--   index, so the index is LOCAL per partition (per-month uniqueness).
--   ON CONFLICT (fingerprint) WHERE fingerprint IS NOT NULL still works
--   because PostgreSQL routes each INSERT to one partition first, then
--   checks that partition's local unique index for conflicts.
--   Trade-off: the same fingerprint in two different months creates two
--   separate rows (no cross-month upsert). This is acceptable for our
--   Nagios/shipper use case where batches are time-coherent.
--
-- FK note: orbit_correlations.event_key is TEXT (no FK) — safe to partition.
-- PK change: (id) → (id, ts) — required for range-partitioned tables in PG.
--
-- Transaction note: the migration runner (migrate.ts) wraps each file in
-- BEGIN/COMMIT. No explicit BEGIN/COMMIT needed here.

-- ── Step 1: preserve existing table ─────────────────────────────────────────
-- Rename indexes first: PostgreSQL index names are schema-global and do NOT
-- follow table renames. We must free the names before recreating them below.

ALTER INDEX IF EXISTS idx_orbit_events_ts                  RENAME TO idx_orbit_events_ts_legacy;
ALTER INDEX IF EXISTS idx_orbit_events_asset_ts            RENAME TO idx_orbit_events_asset_ts_legacy;
ALTER INDEX IF EXISTS idx_orbit_events_sev_ts              RENAME TO idx_orbit_events_sev_ts_legacy;
ALTER INDEX IF EXISTS idx_orbit_events_kind_ts             RENAME TO idx_orbit_events_kind_ts_legacy;
ALTER INDEX IF EXISTS idx_orbit_events_fingerprint         RENAME TO idx_orbit_events_fingerprint_legacy;
ALTER INDEX IF EXISTS idx_orbit_events_sev_ts_correlate    RENAME TO idx_orbit_events_sev_ts_correlate_legacy;
ALTER INDEX IF EXISTS idx_orbit_events_fingerprint_unique  RENAME TO idx_orbit_events_fingerprint_unique_legacy;

ALTER TABLE orbit_events RENAME TO orbit_events_legacy;

-- ── Step 2: create partitioned table ────────────────────────────────────────

CREATE TABLE orbit_events (
  id          bigint       NOT NULL DEFAULT nextval('orbit_events_id_seq'),
  ts          timestamptz  NOT NULL,
  asset_id    text         NOT NULL,
  namespace   text         NOT NULL,
  kind        text         NOT NULL,
  severity    text         NOT NULL,
  title       text         NOT NULL,
  message     text,
  fingerprint text,
  attributes  jsonb        NOT NULL DEFAULT '{}'::jsonb,
  ingested_at timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

ALTER TABLE orbit_events
  ADD CONSTRAINT orbit_events_asset_id_fkey
  FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE;

-- Transfer sequence ownership from legacy table to new partitioned table
ALTER SEQUENCE orbit_events_id_seq OWNED BY orbit_events.id;

-- ── Step 3: monthly child partitions 2025-01 → 2027-12 ──────────────────────

CREATE TABLE orbit_events_2025_01 PARTITION OF orbit_events FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE orbit_events_2025_02 PARTITION OF orbit_events FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE orbit_events_2025_03 PARTITION OF orbit_events FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE orbit_events_2025_04 PARTITION OF orbit_events FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE orbit_events_2025_05 PARTITION OF orbit_events FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE orbit_events_2025_06 PARTITION OF orbit_events FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE orbit_events_2025_07 PARTITION OF orbit_events FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE orbit_events_2025_08 PARTITION OF orbit_events FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE orbit_events_2025_09 PARTITION OF orbit_events FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE orbit_events_2025_10 PARTITION OF orbit_events FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE orbit_events_2025_11 PARTITION OF orbit_events FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE orbit_events_2025_12 PARTITION OF orbit_events FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE orbit_events_2026_01 PARTITION OF orbit_events FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE orbit_events_2026_02 PARTITION OF orbit_events FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE orbit_events_2026_03 PARTITION OF orbit_events FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE orbit_events_2026_04 PARTITION OF orbit_events FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE orbit_events_2026_05 PARTITION OF orbit_events FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE orbit_events_2026_06 PARTITION OF orbit_events FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE orbit_events_2026_07 PARTITION OF orbit_events FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE orbit_events_2026_08 PARTITION OF orbit_events FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE orbit_events_2026_09 PARTITION OF orbit_events FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE orbit_events_2026_10 PARTITION OF orbit_events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE orbit_events_2026_11 PARTITION OF orbit_events FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE orbit_events_2026_12 PARTITION OF orbit_events FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE orbit_events_2027_01 PARTITION OF orbit_events FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE orbit_events_2027_02 PARTITION OF orbit_events FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE orbit_events_2027_03 PARTITION OF orbit_events FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE orbit_events_2027_04 PARTITION OF orbit_events FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE orbit_events_2027_05 PARTITION OF orbit_events FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE orbit_events_2027_06 PARTITION OF orbit_events FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE orbit_events_2027_07 PARTITION OF orbit_events FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE orbit_events_2027_08 PARTITION OF orbit_events FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE orbit_events_2027_09 PARTITION OF orbit_events FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE orbit_events_2027_10 PARTITION OF orbit_events FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE orbit_events_2027_11 PARTITION OF orbit_events FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE orbit_events_2027_12 PARTITION OF orbit_events FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');

-- Catch-all for timestamps outside 2025-2027
CREATE TABLE orbit_events_default PARTITION OF orbit_events DEFAULT;

-- ── Step 4: indexes on partitioned parent ────────────────────────────────────
-- Each index below is automatically propagated to all child partitions.

-- Unique fingerprint (local per partition — per-month dedup).
-- Replaces: idx_orbit_events_fingerprint_unique from migration 0010.
CREATE UNIQUE INDEX idx_orbit_events_fingerprint_unique
  ON orbit_events (fingerprint)
  WHERE fingerprint IS NOT NULL;

-- Query acceleration (same names as 0002 / 0009 — recreated on new table)
CREATE INDEX idx_orbit_events_ts
  ON orbit_events (ts DESC);

CREATE INDEX idx_orbit_events_asset_ts
  ON orbit_events (asset_id, ts DESC);

CREATE INDEX idx_orbit_events_sev_ts
  ON orbit_events (severity, ts DESC);

CREATE INDEX idx_orbit_events_kind_ts
  ON orbit_events (kind, ts DESC);

-- Non-unique fingerprint lookup index (from 0009 — kept for correlate worker)
CREATE INDEX idx_orbit_events_fingerprint
  ON orbit_events (fingerprint)
  WHERE fingerprint IS NOT NULL;

-- Correlate worker partial index (from 0009)
CREATE INDEX idx_orbit_events_sev_ts_correlate
  ON orbit_events (ts DESC)
  WHERE severity IN ('medium', 'high', 'critical');

-- ── Step 5: copy all historical rows ────────────────────────────────────────
-- NOTE: this INSERT holds ACCESS EXCLUSIVE on orbit_events_legacy for its
-- duration (~15-60 s depending on server). New writes go to the new
-- orbit_events table (visible to other sessions) via the partitioned table.

INSERT INTO orbit_events
  (id, ts, asset_id, namespace, kind, severity, title, message,
   fingerprint, attributes, ingested_at)
SELECT
   id, ts, asset_id, namespace, kind, severity, title, message,
   fingerprint, attributes, ingested_at
FROM orbit_events_legacy;

-- ── Step 6: reset sequence to max(id) across all data ───────────────────────

SELECT setval(
  'orbit_events_id_seq',
  COALESCE((SELECT MAX(id) FROM orbit_events), 1)
);

-- ── Step 7: update purge_old_data — DROP partitions instead of DELETE ────────

CREATE OR REPLACE FUNCTION purge_old_data(
  p_metric_raw_days    int DEFAULT 14,
  p_rollup_5m_days     int DEFAULT 90,
  p_rollup_1h_days     int DEFAULT 180,
  p_events_days        int DEFAULT 180
) RETURNS TABLE (table_name text, rows_deleted bigint)
LANGUAGE plpgsql AS $$
DECLARE
  v_deleted       bigint;
  v_cutoff        timestamptz;
  v_part          record;
  v_part_from     timestamptz;
  v_part_to       timestamptz;
  v_parts_dropped bigint := 0;
BEGIN
  -- metric_points: unchanged
  DELETE FROM metric_points
    WHERE ts < now() - (p_metric_raw_days || ' days')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'metric_points'::text, v_deleted;

  DELETE FROM metric_rollup_5m
    WHERE bucket_ts < now() - (p_rollup_5m_days || ' days')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'metric_rollup_5m'::text, v_deleted;

  DELETE FROM metric_rollup_1h
    WHERE bucket_ts < now() - (p_rollup_1h_days || ' days')::interval;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'metric_rollup_1h'::text, v_deleted;

  -- orbit_events: drop entire monthly partitions older than the retention
  -- window (O(1) per partition vs O(n) DELETE), then clean up any stale
  -- rows left in the boundary partition via a targeted DELETE.
  v_cutoff := now() - (p_events_days || ' days')::interval;

  FOR v_part IN
    SELECT c.relname AS partition_name
    FROM   pg_class p
    JOIN   pg_inherits i ON i.inhparent = p.oid
    JOIN   pg_class c    ON c.oid = i.inhrelid
    WHERE  p.relname = 'orbit_events'
      AND  c.relname ~ '^orbit_events_\d{4}_\d{2}$'
      AND  c.relkind = 'r'
  LOOP
    -- Derive partition bounds from name: orbit_events_YYYY_MM
    v_part_from := make_timestamp(
      substring(v_part.partition_name FROM 'orbit_events_(\d{4})_\d{2}')::int,
      substring(v_part.partition_name FROM 'orbit_events_\d{4}_(\d{2})')::int,
      1, 0, 0, 0
    )::timestamptz;
    v_part_to := v_part_from + INTERVAL '1 month';

    -- Entire partition is older than the cutoff — drop it
    IF v_part_to <= v_cutoff THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', v_part.partition_name);
      v_parts_dropped := v_parts_dropped + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT 'orbit_events_partitions_dropped'::text, v_parts_dropped;

  -- Clean up any remaining stale rows in boundary partitions
  DELETE FROM orbit_events WHERE ts < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'orbit_events_stale_rows'::text, v_deleted;
END;
$$;
