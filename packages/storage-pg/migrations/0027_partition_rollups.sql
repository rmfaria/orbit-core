-- Partition metric_rollup_5m and metric_rollup_1h by bucket_ts (monthly range).
--
-- Why: INSERT ON CONFLICT on a 90-day unpartitioned rollup_5m table scans the
-- entire PK index. Monthly partitions reduce the conflict-check scope to ~30 days
-- of data and enable O(1) DROP for retention.
--
-- Strategy: rename old table → create partitioned parent → copy data → drop old.
-- FK to assets is dropped (partitioned tables cannot reference non-partitioned ones
-- via PG declarative partitioning); the rollup worker already guarantees asset exists.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- metric_rollup_5m
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE metric_rollup_5m RENAME TO metric_rollup_5m_old;

CREATE TABLE metric_rollup_5m (
  bucket_ts       timestamptz      NOT NULL,
  asset_id        text             NOT NULL,
  namespace       text             NOT NULL,
  metric          text             NOT NULL,
  dimensions      jsonb            NOT NULL DEFAULT '{}'::jsonb,
  dimensions_hash text             NOT NULL,
  avg             double precision NOT NULL,
  min             double precision NOT NULL,
  max             double precision NOT NULL,
  sum             double precision NOT NULL,
  count           bigint           NOT NULL,
  PRIMARY KEY (bucket_ts, asset_id, namespace, metric, dimensions_hash)
) PARTITION BY RANGE (bucket_ts);

-- Create monthly partitions (2025-01 through 2027-12)
DO $$
DECLARE
  y int; m int;
  p_name text;
  p_start text;
  p_end text;
BEGIN
  FOR y IN 2025..2027 LOOP
    FOR m IN 1..12 LOOP
      p_name  := format('metric_rollup_5m_%s_%s', y, lpad(m::text, 2, '0'));
      p_start := format('%s-%s-01', y, lpad(m::text, 2, '0'));
      IF m = 12 THEN
        p_end := format('%s-01-01', y + 1);
      ELSE
        p_end := format('%s-%s-01', y, lpad((m + 1)::text, 2, '0'));
      END IF;
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF metric_rollup_5m FOR VALUES FROM (%L) TO (%L)',
        p_name, p_start, p_end
      );
    END LOOP;
  END LOOP;
END $$;

CREATE TABLE metric_rollup_5m_default PARTITION OF metric_rollup_5m DEFAULT;

-- Copy existing data
INSERT INTO metric_rollup_5m
  SELECT * FROM metric_rollup_5m_old;

-- Recreate indexes on the partitioned table
CREATE INDEX idx_rollup5_asset_ts ON metric_rollup_5m (asset_id, bucket_ts DESC);
CREATE INDEX idx_rollup5_ns_metric_ts ON metric_rollup_5m (namespace, metric, bucket_ts DESC);
CREATE INDEX idx_rollup5_dims_gin ON metric_rollup_5m USING gin (dimensions);
CREATE INDEX idx_rollup5_asset_ns_metric_ts ON metric_rollup_5m (asset_id, namespace, metric, bucket_ts DESC);

DROP TABLE metric_rollup_5m_old;

-- ═══════════════════════════════════════════════════════════════════════════════
-- metric_rollup_1h
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE metric_rollup_1h RENAME TO metric_rollup_1h_old;

CREATE TABLE metric_rollup_1h (
  bucket_ts       timestamptz      NOT NULL,
  asset_id        text             NOT NULL,
  namespace       text             NOT NULL,
  metric          text             NOT NULL,
  dimensions      jsonb            NOT NULL DEFAULT '{}'::jsonb,
  dimensions_hash text             NOT NULL,
  avg             double precision NOT NULL,
  min             double precision NOT NULL,
  max             double precision NOT NULL,
  sum             double precision NOT NULL,
  count           bigint           NOT NULL,
  PRIMARY KEY (bucket_ts, asset_id, namespace, metric, dimensions_hash)
) PARTITION BY RANGE (bucket_ts);

-- Create monthly partitions (2025-01 through 2027-12)
DO $$
DECLARE
  y int; m int;
  p_name text;
  p_start text;
  p_end text;
BEGIN
  FOR y IN 2025..2027 LOOP
    FOR m IN 1..12 LOOP
      p_name  := format('metric_rollup_1h_%s_%s', y, lpad(m::text, 2, '0'));
      p_start := format('%s-%s-01', y, lpad(m::text, 2, '0'));
      IF m = 12 THEN
        p_end := format('%s-01-01', y + 1);
      ELSE
        p_end := format('%s-%s-01', y, lpad((m + 1)::text, 2, '0'));
      END IF;
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF metric_rollup_1h FOR VALUES FROM (%L) TO (%L)',
        p_name, p_start, p_end
      );
    END LOOP;
  END LOOP;
END $$;

CREATE TABLE metric_rollup_1h_default PARTITION OF metric_rollup_1h DEFAULT;

-- Copy existing data
INSERT INTO metric_rollup_1h
  SELECT * FROM metric_rollup_1h_old;

-- Recreate indexes on the partitioned table
CREATE INDEX idx_rollup1h_asset_ts ON metric_rollup_1h (asset_id, bucket_ts DESC);
CREATE INDEX idx_rollup1h_ns_metric_ts ON metric_rollup_1h (namespace, metric, bucket_ts DESC);
CREATE INDEX idx_rollup1h_dims_gin ON metric_rollup_1h USING gin (dimensions);
CREATE INDEX idx_rollup1h_asset_ns_metric_ts ON metric_rollup_1h (asset_id, namespace, metric, bucket_ts DESC);

DROP TABLE metric_rollup_1h_old;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Autovacuum tuning for new partitions (same settings as orbit_events)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables
    WHERE tablename LIKE 'metric_rollup_5m_20%'
       OR tablename LIKE 'metric_rollup_1h_20%'
  LOOP
    EXECUTE format('ALTER TABLE %I SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02)', tbl);
  END LOOP;
END $$;

COMMIT;
