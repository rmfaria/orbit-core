import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { execSync } from "node:child_process";

// Skip integration tests when Docker is not available
function isDockerRunning(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const DOCKER_AVAILABLE = isDockerRunning();

let container: import("@testcontainers/postgresql").StartedPostgreSqlContainer;
let pool: pg.Pool;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS assets (
    asset_id text PRIMARY KEY,
    type text NOT NULL DEFAULT 'host',
    name text NOT NULL DEFAULT '',
    labels jsonb NOT NULL DEFAULT '{}',
    tags text[] NOT NULL DEFAULT '{}',
    criticality text,
    enabled boolean NOT NULL DEFAULT true,
    first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS metric_points (
    id bigserial PRIMARY KEY,
    ts timestamptz NOT NULL,
    asset_id text NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    namespace text NOT NULL,
    metric text NOT NULL,
    value double precision NOT NULL,
    unit text,
    dimensions jsonb NOT NULL DEFAULT '{}'
  );

  CREATE UNIQUE INDEX IF NOT EXISTS ux_mp_dedup
    ON metric_points (ts, asset_id, namespace, metric, dimensions);

  CREATE TABLE IF NOT EXISTS orbit_events (
    id bigserial PRIMARY KEY,
    ts timestamptz NOT NULL,
    asset_id text NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    namespace text NOT NULL,
    kind text NOT NULL,
    severity text NOT NULL,
    title text NOT NULL,
    message text,
    fingerprint text,
    attributes jsonb NOT NULL DEFAULT '{}',
    ingested_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS ux_events_fp_ts
    ON orbit_events (fingerprint, ts) WHERE fingerprint IS NOT NULL;
`;

describe.skipIf(!DOCKER_AVAILABLE)(
  "Integration: ingest + query with real PG",
  () => {
    beforeAll(async () => {
      const { PostgreSqlContainer } =
        await import("@testcontainers/postgresql");
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      pool = new pg.Pool({ connectionString: container.getConnectionUri() });
      await pool.query(SCHEMA);
    }, 60_000);

    afterAll(async () => {
      await pool?.end();
      await container?.stop();
    }, 30_000);

    it("inserts and queries events", async () => {
      // Ensure asset exists
      await pool.query(
        `INSERT INTO assets (asset_id, type, name) VALUES ($1, $2, $3)
       ON CONFLICT (asset_id) DO NOTHING`,
        ["host:srv1", "host", "srv1"],
      );

      // Insert event
      await pool.query(
        `INSERT INTO orbit_events (ts, asset_id, namespace, kind, severity, title, fingerprint, attributes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          "2024-06-01T12:00:00Z",
          "host:srv1",
          "wazuh",
          "alert",
          "high",
          "Suspicious login",
          "fp-int-001",
          JSON.stringify({ rule_id: "1234" }),
        ],
      );

      // Query back
      const { rows } = await pool.query(
        `SELECT * FROM orbit_events WHERE namespace = $1`,
        ["wazuh"],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe("Suspicious login");
      expect(rows[0].severity).toBe("high");
      expect(rows[0].attributes.rule_id).toBe("1234");
    });

    it("deduplicates events by fingerprint+ts", async () => {
      // Insert same fingerprint+ts again with updated title
      await pool.query(
        `INSERT INTO orbit_events (ts, asset_id, namespace, kind, severity, title, fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (fingerprint, ts) WHERE fingerprint IS NOT NULL
       DO UPDATE SET title = excluded.title, ingested_at = now()`,
        [
          "2024-06-01T12:00:00Z",
          "host:srv1",
          "wazuh",
          "alert",
          "high",
          "Updated title",
          "fp-int-001",
        ],
      );

      const { rows } = await pool.query(
        `SELECT * FROM orbit_events WHERE fingerprint = $1`,
        ["fp-int-001"],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe("Updated title");
    });

    it("inserts and queries metrics", async () => {
      await pool.query(
        `INSERT INTO metric_points (ts, asset_id, namespace, metric, value, unit, dimensions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          "2024-06-01T12:00:00Z",
          "host:srv1",
          "nagios",
          "load1",
          2.5,
          null,
          JSON.stringify({ service: "cpu" }),
        ],
      );

      const { rows } = await pool.query(
        `SELECT * FROM metric_points WHERE metric = $1`,
        ["load1"],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe(2.5);
      expect(rows[0].namespace).toBe("nagios");
    });

    it("deduplicates metrics by ts+asset+ns+metric+dimensions", async () => {
      // Insert same metric again with new value (upsert)
      await pool.query(
        `INSERT INTO metric_points (ts, asset_id, namespace, metric, value, dimensions)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (ts, asset_id, namespace, metric, dimensions)
       DO UPDATE SET value = excluded.value`,
        [
          "2024-06-01T12:00:00Z",
          "host:srv1",
          "nagios",
          "load1",
          3.7,
          JSON.stringify({ service: "cpu" }),
        ],
      );

      const { rows } = await pool.query(
        `SELECT * FROM metric_points WHERE metric = $1`,
        ["load1"],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe(3.7);
    });

    it("enforces asset foreign key", async () => {
      await expect(
        pool.query(
          `INSERT INTO orbit_events (ts, asset_id, namespace, kind, severity, title)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            "2024-06-01T12:00:00Z",
            "host:nonexistent",
            "wazuh",
            "alert",
            "high",
            "Should fail",
          ],
        ),
      ).rejects.toThrow(/violates foreign key/);
    });

    it("handles concurrent inserts without conflict", async () => {
      await pool.query(
        `INSERT INTO assets (asset_id, type, name) VALUES ($1, $2, $3)
       ON CONFLICT (asset_id) DO NOTHING`,
        ["host:srv2", "host", "srv2"],
      );

      const inserts = Array.from({ length: 10 }, (_, i) =>
        pool.query(
          `INSERT INTO metric_points (ts, asset_id, namespace, metric, value, dimensions)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (ts, asset_id, namespace, metric, dimensions)
         DO UPDATE SET value = excluded.value`,
          [
            `2024-06-01T12:0${i}:00Z`,
            "host:srv2",
            "nagios",
            "load1",
            i * 0.5,
            "{}",
          ],
        ),
      );

      await Promise.all(inserts);

      const { rows } = await pool.query(
        `SELECT count(*)::int AS cnt FROM metric_points WHERE asset_id = $1`,
        ["host:srv2"],
      );
      expect(rows[0].cnt).toBe(10);
    });
  },
);
