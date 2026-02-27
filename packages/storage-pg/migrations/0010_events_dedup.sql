-- Migration 0010: deduplicate orbit_events by fingerprint
-- Problem: ingest was doing plain INSERT with no ON CONFLICT, causing
-- repeated checks (e.g. Nagios every 2.5 min) to create thousands of
-- duplicate rows for the same logical event.
--
-- Strategy: keep the EARLIEST record per fingerprint (min id = first seen),
-- then add a UNIQUE index so future inserts can use ON CONFLICT.
--
-- PERFORMANCE NOTE:
--   The original version used `NOT IN (SELECT MIN(id) ... GROUP BY fingerprint)`.
--   On large tables (>100k rows) this is O(n²): for each row it scans the
--   entire subquery result.  Replaced with DELETE ... USING self-join which
--   leverages the partial index on fingerprint and runs in O(n log n).

-- Step 1: remove duplicates, keeping the oldest row per fingerprint.
-- Uses a self-join so the query planner can use idx_orbit_events_fingerprint.
DELETE FROM orbit_events a
USING  orbit_events b
WHERE  a.fingerprint IS NOT NULL
  AND  b.fingerprint = a.fingerprint
  AND  b.id < a.id;

-- Step 2: unique index so future inserts can use ON CONFLICT DO NOTHING.
-- Partial (WHERE fingerprint IS NOT NULL) so unfingerprintable events are
-- still allowed to accumulate freely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orbit_events_fingerprint_unique
  ON orbit_events (fingerprint)
  WHERE fingerprint IS NOT NULL;
