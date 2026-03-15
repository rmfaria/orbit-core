-- Threat intel correlation — records matches between orbit events and threat indicators
-- Populated by the threat-intel background worker

CREATE TABLE IF NOT EXISTS threat_matches (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      bigint       NOT NULL,              -- FK to orbit_events.id
  indicator_id  bigint       NOT NULL,              -- FK to threat_indicators.id
  matched_field text         NOT NULL,              -- which field matched (e.g., 'src_ip', 'dst_ip', 'domain')
  matched_value text         NOT NULL,              -- the actual matched value
  indicator_type text        NOT NULL,              -- indicator type at match time (ip-src, domain, etc.)
  threat_level  text         NOT NULL DEFAULT 'unknown',
  detected_at   timestamptz  NOT NULL DEFAULT now()
);

-- Prevent duplicate matches
CREATE UNIQUE INDEX IF NOT EXISTS idx_threat_matches_event_indicator
  ON threat_matches (event_id, indicator_id);

-- Lookup by event
CREATE INDEX IF NOT EXISTS idx_threat_matches_event_id
  ON threat_matches (event_id);

-- Lookup by indicator (which events hit this IoC?)
CREATE INDEX IF NOT EXISTS idx_threat_matches_indicator_id
  ON threat_matches (indicator_id);

-- Timeline queries
CREATE INDEX IF NOT EXISTS idx_threat_matches_detected
  ON threat_matches (detected_at DESC);
