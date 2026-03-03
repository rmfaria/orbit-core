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
import { systemHandler } from './routes/system.js';
import { otlpRouter } from './routes/otlp.js';
import { startConnectorWorker } from './connectors/worker.js';
import { startRollupWorker } from './rollup.js';
import { startCorrelateWorker } from './correlate.js';
import { startAlertWorker } from './alerting/worker.js';
import { startTelemetryWorker } from './telemetry/worker.js';
import { pool } from './db.js';
import { makeLicenseMiddleware } from './license/middleware.js';
import { licenseRouter } from './license/routes.js';
import { authRouter } from './routes/auth.js';

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

// License and auth endpoints are public — required before auth for first-run setup.
if (pool) {
  app.use('/api/v1', licenseRouter(pool));
  app.use('/api/v1', authRouter(pool));
}

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

// License check: blocks requests when unlicensed and grace period expired.
app.use(makeLicenseMiddleware(pool));

// All other endpoints require authentication when ORBIT_API_KEY is set or DB key exists.
app.use(makeAuthMiddleware(env, pool));

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

// OpenTelemetry OTLP/HTTP receiver — traces, metrics, logs from instrumented apps
app.use('/', otlpRouter(pool));

// System / infra metrics — process, CPU, memory, network, workers, DB pool
app.get('/api/v1/system', a(systemHandler(pool)));

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

// Bootstrap license from env var (Docker / CI deployments).
if (pool && env.ORBIT_LICENSE_KEY) {
  pool.query(
    `INSERT INTO orbit_settings (key, value, updated_at) VALUES ('license_key', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [env.ORBIT_LICENSE_KEY],
  ).catch(err => logger.error({ err }, 'failed to store ORBIT_LICENSE_KEY'));
}

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, auth: !!env.ORBIT_API_KEY }, 'orbit-api listening');
});

// Start background workers if DB is available.
let stopRollups:     (() => void) | undefined;
let stopCorrelate:   (() => void) | undefined;
let stopAlerts:      (() => void) | undefined;
let stopConnectors:  (() => void) | undefined;
let stopTelemetry:   (() => void) | undefined;
if (pool) {
  stopRollups     = startRollupWorker(pool);
  stopCorrelate   = startCorrelateWorker(pool);
  stopAlerts      = startAlertWorker(pool);
  stopConnectors  = startConnectorWorker(pool);
  if (env.ORBIT_TELEMETRY === 'true') {
    stopTelemetry = startTelemetryWorker(pool);
  }
}

// Graceful shutdown.
function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  stopRollups?.();
  stopCorrelate?.();
  stopAlerts?.();
  stopConnectors?.();
  stopTelemetry?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
