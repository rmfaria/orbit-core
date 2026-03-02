-- Migration 0018: Engine dispatch + persistent state for built-in connectors
--
-- engine: when set (e.g. 'n8n'), the pull worker dispatches to a specialized
--   engine module instead of the generic DSL fetch+map flow.
--   When NULL, the existing DSL flow applies (backward compatible).
--
-- state: JSONB for engine-specific persistent state (cursor, since timestamp).
--   Engines read/write this between runs. Ignored when engine IS NULL.

ALTER TABLE connector_specs ADD COLUMN IF NOT EXISTS engine TEXT;
ALTER TABLE connector_specs ADD COLUMN IF NOT EXISTS state  JSONB;
