import pg from 'pg';
import pino from 'pino';
import { loadEnv } from './env.js';

const env = loadEnv();
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'db' });

export const pool = env.DATABASE_URL
  ? new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      query_timeout: 15_000,
    })
  : null;

// Log idle client errors (e.g. network reset while connection sits in pool)
pool?.on('error', (err) => {
  logger.error({ err }, 'pg pool idle client error');
});

// Log pool saturation when all connections are in use
pool?.on('connect', () => {
  const p = pool as pg.Pool & { totalCount: number; idleCount: number; waitingCount: number };
  if (p.waitingCount > 0) {
    logger.warn(
      { total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount },
      'pg pool: clients waiting for connection',
    );
  }
});
