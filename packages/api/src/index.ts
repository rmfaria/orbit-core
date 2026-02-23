import express from 'express';
import cors from 'cors';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

import { loadEnv } from './env.js';
import { healthHandler } from './routes/health.js';
import { queryHandler } from './routes/query.js';
import { ingestEventsHandler, ingestMetricsHandler } from './routes/ingest.js';
import { catalogAssetsHandler, catalogMetricsHandler, catalogDimensionsHandler } from './routes/catalog.js';
import { metricsHandler, metricsMiddleware } from './metrics.js';
import { metricsPromHandler } from './metrics_prom.js';

const env = loadEnv();
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));
app.use(metricsMiddleware);

app.get('/api/v1/health', healthHandler);
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

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'orbit-api listening');
});
