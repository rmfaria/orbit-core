-- Migration 0029: Add unique constraint for metrics dedup
-- Prevents inflated values when shippers retry and re-send the same data points.
-- Uses ON CONFLICT to upsert (last write wins) instead of inserting duplicates.

-- Create unique index on the DEFAULT partition and all monthly partitions.
-- Partitioned tables require the unique constraint columns to include the partition key.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS part_name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'metric_points'
  LOOP
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (ts, asset_id, namespace, metric, dimensions)',
      'ux_mp_dedup_' || r.part_name,
      r.part_name
    );
  END LOOP;
END $$;
