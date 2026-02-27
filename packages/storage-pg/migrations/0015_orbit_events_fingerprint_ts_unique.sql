-- Migration 0015: replace per-partition fingerprint unique indexes with a
-- parent-level (fingerprint, ts) unique index.
--
-- Context: ON CONFLICT (fingerprint) WHERE fingerprint IS NOT NULL fails on a
-- partitioned table because PostgreSQL requires any UNIQUE index used as an
-- ON CONFLICT arbiter on the parent to include the partition key (ts).
--
-- Fix: drop the per-partition (fingerprint) unique indexes created in 0014
-- and create a single (fingerprint, ts) UNIQUE index on the parent.
-- This satisfies the partition-key requirement and enables:
--
--   ON CONFLICT (fingerprint, ts) WHERE fingerprint IS NOT NULL
--   DO UPDATE SET severity = EXCLUDED.severity, ...
--
-- Semantic change: uniqueness is now per (fingerprint, timestamp) rather than
-- per fingerprint globally. An idempotent retry (same payload, same ts) still
-- triggers DO UPDATE. A re-notification with a new ts creates a new row —
-- which is correct behaviour for a partitioned event log.
--
-- The ingest routes are updated separately to use (fingerprint, ts).

-- ── Step 1: drop per-partition (fingerprint-only) unique indexes from 0014 ────

DROP INDEX IF EXISTS orbit_events_2025_01_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2025_02_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2025_03_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2025_04_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2025_05_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2025_06_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2025_07_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2025_08_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2025_09_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2025_10_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2025_11_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2025_12_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2026_01_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2026_02_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2026_03_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2026_04_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2026_05_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2026_06_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2026_07_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2026_08_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2026_09_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2026_10_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2026_11_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2026_12_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2027_01_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2027_02_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2027_03_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2027_04_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2027_05_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2027_06_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2027_07_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2027_08_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2027_09_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2027_10_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2027_11_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_2027_12_fingerprint_idx1;
DROP INDEX IF EXISTS orbit_events_default_fingerprint_idx1;

-- ── Step 2: parent-level unique index (fingerprint, ts) ──────────────────────
-- Includes the partition key ts — satisfies PostgreSQL's requirement.
-- Propagated automatically to all existing and future child partitions.

CREATE UNIQUE INDEX idx_orbit_events_fp_ts
  ON orbit_events (fingerprint, ts)
  WHERE fingerprint IS NOT NULL;
