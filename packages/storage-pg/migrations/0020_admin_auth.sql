-- Migration 0020: Admin auth (first-access password setup)

INSERT INTO orbit_settings (key, value) VALUES
  ('admin_password_hash', ''),
  ('admin_api_key', '')
ON CONFLICT (key) DO NOTHING;
