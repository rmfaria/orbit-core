-- Smart dashboards: AI-generated HTML/CSS/JS visualizations
CREATE TABLE IF NOT EXISTS smart_dashboards (
  id          TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  description TEXT,
  prompt      TEXT        NOT NULL,
  html        TEXT        NOT NULL,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smart_dashboards_updated ON smart_dashboards(updated_at DESC);
