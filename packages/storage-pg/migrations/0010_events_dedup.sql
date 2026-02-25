-- Migration 0010: deduplicate orbit_events by fingerprint
-- Problem: ingest was doing plain INSERT with no ON CONFLICT, causing
-- repeated checks (e.g. Nagios every 2.5 min) to create thousands of
-- duplicate rows for the same logical event.
--
-- Strategy: keep the EARLIEST record per fingerprint (min id = first seen),
-- then add a UNIQUE index so future inserts can use ON CONFLICT.

-- Step 1: remove duplicates, keeping the oldest row per fingerprint
DELETE FROM orbit_events
WHERE id NOT IN (
  SELECT MIN(id)
  FROM orbit_events
  WHERE fingerprint IS NOT NULL
  GROUP BY fingerprint
)
AND fingerprint IS NOT NULL;

-- Step 2: add unique index on fingerprint (partial: only when not null,
-- so events without fingerprint can still coexist freely)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orbit_events_fingerprint_unique
  ON orbit_events (fingerprint)
  WHERE fingerprint IS NOT NULL;
