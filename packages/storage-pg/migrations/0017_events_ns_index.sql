-- Migration 0017: composite index (namespace, ts DESC) on orbit_events
--
-- Without this index, any query with WHERE namespace = 'X' AND ts >= ...
-- (HomeTab event feeds, EPS counts, live feed) triggers a full sequential scan
-- of the 1.97M-row events partition (~3.9 GB) — measured at 3,374 ms.
--
-- With this index, the same queries resolve via index scan in ~2 ms.
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block, which
-- the migration runner uses.  This migration uses IF NOT EXISTS so it is a no-op
-- when the index already exists (applied directly on the production server first).

CREATE INDEX IF NOT EXISTS idx_orbit_events_ns_ts
  ON orbit_events (namespace, ts DESC);
