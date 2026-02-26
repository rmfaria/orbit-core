/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import cors from 'cors';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { ZodError } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { randomUUID } from 'crypto';

import { loadEnv } from './env.js';
import { makeAuthMiddleware } from './auth.js';
import { healthHandler } from './routes/health.js';
import { queryHandler } from './routes/query.js';
import { ingestEventsHandler, ingestMetricsHandler } from './routes/ingest.js';
import { catalogAssetsHandler, catalogMetricsHandler, catalogDimensionsHandler, catalogEventsHandler } from './routes/catalog.js';
import { metricsHandler, metricsMiddleware } from './metrics.js';
import { metricsPromHandler } from './metrics_prom.js';
import { dashboardsRouter } from './routes/dashboards.js';
import { aiRouter } from './routes/ai.js';
import { alertsRouter } from './routes/alerts.js';
import { correlationsHandler } from './routes/correlations.js';
import { connectorsRouter } from './routes/connectors.js';
import { startRollupWorker } from './rollup.js';
import { startCorrelateWorker } from './correlate.js';
import { startAlertWorker } from './alerting/worker.js';
import { pool } from './db.js';

// Wrap async Express handlers so their rejected promises reach the error handler.
function a(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const env = loadEnv();
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));
app.use(metricsMiddleware);

// Attach a unique request ID for log correlation.
app.use((req, _res, next) => {
  req.headers['x-request-id'] ??= randomUUID();
  next();
});

// Health is always public — used by load-balancers and readiness probes.
app.get('/api/v1/health', a(healthHandler));

// Rate limiting: 300 req/min keyed by API key or IP.
// Applied after /health so probes are never throttled.
const limiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.headers['x-api-key'] as string) || ipKeyGenerator(req.ip ?? 'anon'),
});
app.use('/api/v1', limiter);

// All other endpoints require authentication when ORBIT_API_KEY is set.
app.use(makeAuthMiddleware(env));

app.get('/api/v1/metrics', metricsHandler);
app.get('/api/v1/metrics/prom', metricsPromHandler);

// catalog (MVP)
app.get('/api/v1/catalog/assets', a(catalogAssetsHandler));
app.get('/api/v1/catalog/metrics', a(catalogMetricsHandler));
app.get('/api/v1/catalog/dimensions', a(catalogDimensionsHandler));
app.get('/api/v1/catalog/events', a(catalogEventsHandler));

app.post('/api/v1/query', a(queryHandler));

// ingestion (MVP1)
app.post('/api/v1/ingest/metrics', a(ingestMetricsHandler));
app.post('/api/v1/ingest/events', a(ingestEventsHandler));

// dashboards — CRUD + AI agent proxy
app.use('/api/v1', dashboardsRouter(pool));
app.use('/api/v1', aiRouter(pool));

// alerts — rules, channels, history
app.use('/api/v1', alertsRouter(pool));

// correlations
app.get('/api/v1/correlations', a(correlationsHandler));

// AI connector framework — specs CRUD + universal raw ingest
app.use('/api/v1', connectorsRouter(pool));

// Global error handler — catches ZodErrors (→ 400) and all other thrown errors (→ 500).
// Must have 4 parameters for Express to recognise it as an error handler.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ ok: false, error: 'validation error', details: err.errors });
  }
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ ok: false, error: 'internal server error' });
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, auth: !!env.ORBIT_API_KEY }, 'orbit-api listening');
});

// Start background workers if DB is available.
let stopRollups:   (() => void) | undefined;
let stopCorrelate: (() => void) | undefined;
let stopAlerts:    (() => void) | undefined;
if (pool) {
  stopRollups   = startRollupWorker(pool);
  stopCorrelate = startCorrelateWorker(pool);
  stopAlerts    = startAlertWorker(pool);
}

// Graceful shutdown.
function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  stopRollups?.();
  stopCorrelate?.();
  stopAlerts?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
