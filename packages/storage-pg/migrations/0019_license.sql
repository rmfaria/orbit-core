-- Migration 0019: License settings (key-value store)

CREATE TABLE IF NOT EXISTS orbit_settings (
  key         TEXT        PRIMARY KEY,
  value       TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO orbit_settings (key, value) VALUES
  ('deployment_id',     gen_random_uuid()::text),
  ('first_boot_at',     now()::text),
  ('license_key',       ''),
  ('telemetry_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
