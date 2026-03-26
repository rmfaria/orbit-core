-- Materialized catalog cache for /api/v1/catalog/events.
--
-- The catalog endpoint runs 4 parallel GROUP BY queries over orbit_events (30 days).
-- On large datasets this takes 200-500ms per request. This table pre-computes the
-- result every 5 minutes via the rollup worker, reducing catalog reads to <5ms.

CREATE TABLE IF NOT EXISTS catalog_event_cache (
  namespace  text    NOT NULL,
  total      int     NOT NULL DEFAULT 0,
  last_seen  timestamptz,
  kinds      text[]  NOT NULL DEFAULT '{}',
  agents     text[]  NOT NULL DEFAULT '{}',
  severities text[]  NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace)
);

-- Function to refresh the cache (called by rollup worker).
CREATE OR REPLACE FUNCTION refresh_catalog_event_cache() RETURNS void AS $$
BEGIN
  -- Truncate + repopulate is faster than upsert for a small result set (<30 rows).
  TRUNCATE catalog_event_cache;

  INSERT INTO catalog_event_cache (namespace, total, last_seen, kinds, agents, severities, updated_at)
  SELECT
    ns.namespace,
    ns.total,
    ns.last_seen,
    COALESCE(k.kinds, '{}'),
    COALESCE(a.agents, '{}'),
    COALESCE(s.severities, '{}'),
    now()
  FROM (
    SELECT namespace, count(*)::int AS total, max(ts) AS last_seen
    FROM orbit_events
    WHERE ts > now() - interval '30 days'
    GROUP BY namespace
    ORDER BY total DESC
    LIMIT 30
  ) ns
  LEFT JOIN LATERAL (
    SELECT array_agg(kind ORDER BY cnt DESC) AS kinds
    FROM (
      SELECT kind, count(*) AS cnt
      FROM orbit_events
      WHERE namespace = ns.namespace AND ts > now() - interval '30 days'
      GROUP BY kind
      ORDER BY cnt DESC
      LIMIT 200
    ) _k
  ) k ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(asset_id ORDER BY cnt DESC) AS agents
    FROM (
      SELECT asset_id, count(*) AS cnt
      FROM orbit_events
      WHERE namespace = ns.namespace AND ts > now() - interval '30 days'
      GROUP BY asset_id
      ORDER BY cnt DESC
      LIMIT 100
    ) _a
  ) a ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(severity ORDER BY cnt DESC) AS severities
    FROM (
      SELECT severity, count(*) AS cnt
      FROM orbit_events
      WHERE namespace = ns.namespace AND ts > now() - interval '30 days'
      GROUP BY severity
      ORDER BY cnt DESC
    ) _s
  ) s ON true;
END;
$$ LANGUAGE plpgsql;

-- Seed the cache on migration.
SELECT refresh_catalog_event_cache();
