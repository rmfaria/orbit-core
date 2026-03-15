-- Threat intelligence indicators (IoCs) — MISP integration
-- Stores indicators of compromise for correlation with orbit events

-- Install pg_trgm for fuzzy/partial matching (best-effort — may not be available)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm extension not available — trigram index will be skipped';
END;
$$;

CREATE TABLE IF NOT EXISTS threat_indicators (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source        text        NOT NULL DEFAULT 'misp',        -- origin platform
  source_id     text        NOT NULL,                       -- external ID (MISP event/attribute UUID)
  type          text        NOT NULL,                       -- MISP type: ip-src, ip-dst, domain, md5, sha256, url, etc.
  value         text        NOT NULL,                       -- the actual IoC value
  threat_level  text        NOT NULL DEFAULT 'unknown',     -- high, medium, low, undefined, unknown
  tags          text[]      NOT NULL DEFAULT '{}',          -- TLP, taxonomies, galaxies
  event_info    text,                                       -- MISP event title/info
  comment       text,                                       -- attribute-level comment
  attributes    jsonb       NOT NULL DEFAULT '{}',          -- extra fields (category, to_ids, misp_event_id, etc.)
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,                                -- NULL = never expires
  enabled       boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by IoC value (the hot path for correlation)
CREATE INDEX IF NOT EXISTS idx_threat_indicators_value ON threat_indicators (value);

-- Deduplication: same source + source_id = same indicator
CREATE UNIQUE INDEX IF NOT EXISTS idx_threat_indicators_source_sid
  ON threat_indicators (source, source_id);

-- Filter by type (ip-src, domain, sha256, etc.)
CREATE INDEX IF NOT EXISTS idx_threat_indicators_type ON threat_indicators (type);

-- Active indicators query (enabled + not expired)
CREATE INDEX IF NOT EXISTS idx_threat_indicators_active
  ON threat_indicators (enabled, expires_at)
  WHERE enabled = true;

-- Full-text on value for partial/prefix matching (requires pg_trgm)
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_threat_indicators_value_trgm
    ON threat_indicators USING gin (value gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Trigram index skipped — pg_trgm not available';
END;
$$;
