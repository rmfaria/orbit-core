import { describe, it, expect } from "vitest";
import { compileQuery } from "../index.js";
import type { QueryRequest } from "@orbit/core-contracts";

describe("compileQuery", () => {
  it("compiles a raw SQL query for postgres", () => {
    const req: QueryRequest = {
      language: "sql",
      query: "SELECT * FROM metric_points LIMIT 10",
    };
    const plan = compileQuery(req, { target: "postgres" });

    expect(plan.target).toBe("postgres");
    expect(plan.statement).toBe("SELECT * FROM metric_points LIMIT 10");
    expect(plan.params).toEqual([]);
  });

  it("compiles a raw SQL query for clickhouse", () => {
    const req: QueryRequest = {
      language: "sql",
      query: "SELECT count() FROM events",
    };
    const plan = compileQuery(req, { target: "clickhouse" });

    expect(plan.target).toBe("clickhouse");
    expect(plan.statement).toBe("SELECT count() FROM events");
  });

  it("serializes a structured orbitql query to JSON", () => {
    const req: QueryRequest = {
      language: "orbitql",
      query: {
        kind: "timeseries",
        asset_id: "host:srv1",
        namespace: "nagios",
        metric: "load1",
        from: "2024-01-01T00:00:00Z",
        to: "2024-01-02T00:00:00Z",
        bucket_sec: 300,
        agg: "avg",
      },
    };
    const plan = compileQuery(req, { target: "postgres" });

    expect(plan.target).toBe("postgres");
    const parsed = JSON.parse(plan.statement);
    expect(parsed.kind).toBe("timeseries");
    expect(parsed.asset_id).toBe("host:srv1");
    expect(parsed.metric).toBe("load1");
    expect(parsed.bucket_sec).toBe(300);
  });

  it("serializes events query", () => {
    const req: QueryRequest = {
      language: "orbitql",
      query: {
        kind: "events",
        namespace: "wazuh",
        from: "2024-01-01T00:00:00Z",
        to: "2024-01-02T00:00:00Z",
        severities: ["high", "critical"],
        limit: 50,
      },
    };
    const plan = compileQuery(req, { target: "postgres" });
    const parsed = JSON.parse(plan.statement);

    expect(parsed.kind).toBe("events");
    expect(parsed.severities).toEqual(["high", "critical"]);
    expect(parsed.limit).toBe(50);
  });

  it("always returns empty params array", () => {
    const req: QueryRequest = { language: "sql", query: "SELECT 1" };
    const plan = compileQuery(req, { target: "postgres" });
    expect(plan.params).toEqual([]);
  });
});
