import pg from "pg";
import pino from "pino";
import { loadEnv } from "./env.js";

const env = loadEnv();
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" }).child({
  module: "db",
});

// ── API pool — serves HTTP route handlers ────────────────────────────────────
export const pool = env.DATABASE_URL
  ? new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 50,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000,
      query_timeout: 30_000,
    })
  : null;

// ── Worker pool — serves background workers (rollup, correlate, alerts, etc.) ─
export const workerPool = env.DATABASE_URL
  ? new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 15,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 120_000,
      query_timeout: 120_000,
    })
  : null;

function monitorPool(p: pg.Pool, name: string): void {
  p.on("error", (err) => {
    logger.error({ err, pool: name }, "pg pool idle client error");
  });
  p.on("connect", () => {
    const s = p as pg.Pool & {
      totalCount: number;
      idleCount: number;
      waitingCount: number;
    };
    if (s.waitingCount > 0) {
      logger.warn(
        {
          pool: name,
          total: s.totalCount,
          idle: s.idleCount,
          waiting: s.waitingCount,
        },
        "pg pool: clients waiting for connection",
      );
    }
  });
}

if (pool) monitorPool(pool, "api");
if (workerPool) monitorPool(workerPool, "worker");
