-- Migration 0012: AI Connector Specs and Run History

-- Connector specs: one row per data source, holds the DSL mapping spec
CREATE TABLE IF NOT EXISTS connector_specs (
  id                TEXT        PRIMARY KEY,          -- slug: 'nagios-webhook', 'wazuh-siem'
  source_id         TEXT        NOT NULL UNIQUE,       -- matches :source_id in /ingest/raw/:source_id
  mode              TEXT        NOT NULL DEFAULT 'push', -- 'push' | 'pull'
  type              TEXT        NOT NULL DEFAULT 'metric', -- 'metric' | 'event'
  spec              JSONB       NOT NULL,              -- DSL mapping spec (see routes/connectors.ts)
  status            TEXT        NOT NULL DEFAULT 'draft', -- 'draft' | 'approved' | 'disabled'
  auto              BOOLEAN     NOT NULL DEFAULT false, -- true = AI-generated (Sprint 2)
  description       TEXT,
  -- pull-mode config (ignored for push mode)
  pull_url          TEXT,                              -- URL to fetch from
  pull_interval_min INT         DEFAULT 5,             -- polling interval in minutes
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Run history: one row per ingest execution (push payload or pull cycle)
CREATE TABLE IF NOT EXISTS connector_runs (
  id          BIGSERIAL   PRIMARY KEY,
  source_id   TEXT        NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT        NOT NULL,   -- 'ok' | 'error'
  ingested    INT         DEFAULT 0,  -- number of items written to DB
  raw_size    INT,                    -- payload size in bytes
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_connector_specs_status
  ON connector_specs (status);

CREATE INDEX IF NOT EXISTS idx_connector_runs_source
  ON connector_runs (source_id, started_at DESC);
