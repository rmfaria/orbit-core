import express from 'express';
import cors from 'cors';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

import { loadEnv } from './env.js';
import { makeAuthMiddleware } from './auth.js';
import { healthHandler } from './routes/health.js';
import { queryHandler } from './routes/query.js';
import { ingestEventsHandler, ingestMetricsHandler } from './routes/ingest.js';
import { catalogAssetsHandler, catalogMetricsHandler, catalogDimensionsHandler } from './routes/catalog.js';
import { metricsHandler, metricsMiddleware } from './metrics.js';
import { metricsPromHandler } from './metrics_prom.js';
import { startRollupWorker } from './rollup.js';
import { pool } from './db.js';

const env = loadEnv();
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));
app.use(metricsMiddleware);

// Health is always public — used by load-balancers and readiness probes.
app.get('/api/v1/health', healthHandler);

// All other endpoints require authentication when ORBIT_API_KEY is set.
app.use(makeAuthMiddleware(env));

app.get('/api/v1/metrics', metricsHandler);
app.get('/api/v1/metrics/prom', metricsPromHandler);

// catalog (MVP)
app.get('/api/v1/catalog/assets', catalogAssetsHandler);
app.get('/api/v1/catalog/metrics', catalogMetricsHandler);
app.get('/api/v1/catalog/dimensions', catalogDimensionsHandler);

app.post('/api/v1/query', queryHandler);

// ingestion (MVP1)
app.post('/api/v1/ingest/metrics', ingestMetricsHandler);
app.post('/api/v1/ingest/events', ingestEventsHandler);

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, auth: !!env.ORBIT_API_KEY }, 'orbit-api listening');
});

// Start rollup background worker if DB is available.
let stopRollups: (() => void) | undefined;
if (pool) {
  stopRollups = startRollupWorker(pool);
}

// Graceful shutdown.
function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  stopRollups?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
