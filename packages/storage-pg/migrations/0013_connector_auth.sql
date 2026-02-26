-- Migration 0013: Auth for pull connectors
--
-- auth JSONB column stores credentials used when fetching pull_url.
-- Three supported kinds:
--   { "kind": "bearer", "token": "sk-..." }
--   { "kind": "basic",  "user": "admin", "pass": "secret" }
--   { "kind": "header", "name": "X-Api-Key", "value": "abc123" }

ALTER TABLE connector_specs ADD COLUMN IF NOT EXISTS auth JSONB;
