/**
 * orbit-core — OTLP/HTTP JSON receiver
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Accepts OpenTelemetry data from instrumented apps (e.g. orbit-ui) via
 * the OTLP/HTTP JSON format and converts it to orbit_events / metric_points.
 *
 * Endpoints (match default OTel SDK exporter paths):
 *   POST /otlp/v1/traces   → spans → duration metrics + error events
 *   POST /otlp/v1/metrics  → gauge/sum data points → metric_points
 *   POST /otlp/v1/logs     → log records → orbit_events
 */

import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { ingestMapped, logRun } from '../connectors/ingest.js';
import { recordEvents } from '../eps-tracker.js';

// ── OTLP JSON type stubs ──────────────────────────────────────────────────────

interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: number | string;
  doubleValue?: number;
}
interface OtlpKV       { key: string; value: OtlpAnyValue }
interface OtlpResource { attributes?: OtlpKV[] }
interface OtlpScope    { name?: string }

interface OtlpSpan {
  traceId?: string;
  spanId?:  string;
  name:     string;
  kind?:    number;
  startTimeUnixNano: string;
  endTimeUnixNano:   string;
  attributes?:       OtlpKV[];
  status?:           { code?: number; message?: string };
  events?:           Array<{ name: string; timeUnixNano: string; attributes?: OtlpKV[] }>;
}

interface OtlpDataPoint {
  startTimeUnixNano?: string;
  timeUnixNano:       string;
  asDouble?:          number;
  asInt?:             number | string;
  attributes?:        OtlpKV[];
}

interface OtlpMetric {
  name: string;
  unit?: string;
  gauge?:     { dataPoints: OtlpDataPoint[] };
  sum?:       { dataPoints: OtlpDataPoint[] };
  histogram?: { dataPoints: Array<{ timeUnixNano: string; sum?: number; count?: number; attributes?: OtlpKV[] }> };
}

interface OtlpLogRecord {
  timeUnixNano?:        string;
  observedTimeUnixNano?: string;
  severityNumber?:      number;
  severityText?:        string;
  body?:                OtlpAnyValue;
  attributes?:          OtlpKV[];
  traceId?:             string;
  spanId?:              string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract string value from an OTLP AnyValue */
function anyStr(v?: OtlpAnyValue): string {
  if (!v) return '';
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue    !== undefined) return String(v.intValue);
  if (v.doubleValue !== undefined) return String(v.doubleValue);
  if (v.boolValue   !== undefined) return String(v.boolValue);
  return '';
}

/** Build a flat key→string map from OTLP attribute list */
function kvMap(attrs?: OtlpKV[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const a of attrs ?? []) m[a.key] = anyStr(a.value);
  return m;
}

/** Extract service.name from resource attributes (fallback to 'unknown') */
function serviceName(resource?: OtlpResource): string {
  return kvMap(resource?.attributes)['service.name'] ?? 'unknown';
}

/** Convert nanosecond uint64 string to ISO 8601 */
function nanoToIso(nanoStr: string): string {
  const ms = Number(BigInt(nanoStr) / 1_000_000n);
  return new Date(ms).toISOString();
}

/** Map OTLP severity number (1-24) to orbit severity */
function otlpSevToOrbit(n?: number): string {
  if (!n) return 'info';
  if (n >= 21) return 'critical';   // FATAL
  if (n >= 17) return 'high';       // ERROR
  if (n >= 13) return 'medium';     // WARN
  if (n >= 9)  return 'info';       // INFO
  return 'info';                     // DEBUG / TRACE
}

/** OTLP span status code: 0=UNSET, 1=OK, 2=ERROR */
const OTLP_STATUS_ERROR = 2;

// ── Router factory ────────────────────────────────────────────────────────────

export function otlpRouter(pool?: Pool | null): Router {
  const r = Router();

  // ── Traces ────────────────────────────────────────────────────────────────

  r.post('/otlp/v1/traces', async (req: Request, res: Response) => {
    res.json({});                // respond fast; ingest is best-effort
    if (!pool) return;

    const startedAt = new Date();
    let ingested = 0;
    let runError: string | null = null;
    try {
      const body = req.body as {
        resourceSpans?: Array<{
          resource?: OtlpResource;
          scopeSpans?: Array<{ scope?: OtlpScope; spans?: OtlpSpan[] }>;
        }>;
      };

      const metrics: Record<string, unknown>[] = [];
      const events:  Record<string, unknown>[] = [];

      for (const rs of body.resourceSpans ?? []) {
        const svc = serviceName(rs.resource);
        const assetId = `otel:${svc}`;

        for (const ss of rs.scopeSpans ?? []) {
          for (const span of ss.spans ?? []) {
            const startMs  = Number(BigInt(span.startTimeUnixNano) / 1_000_000n);
            const endMs    = Number(BigInt(span.endTimeUnixNano)   / 1_000_000n);
            const durationMs = endMs - startMs;
            const ts = nanoToIso(span.endTimeUnixNano);
            const attrs = kvMap(span.attributes);

            // Every span → duration metric
            metrics.push({
              ts,
              asset_id:  assetId,
              namespace: 'otel',
              metric:    `${svc}.span.duration_ms`,
              value:     durationMs,
              unit:      'ms',
              dimensions: {
                span_name: span.name,
                span_kind: String(span.kind ?? 0),
                ...(attrs['http.method']      ? { http_method: attrs['http.method'] }           : {}),
                ...(attrs['http.status_code'] ? { http_status: attrs['http.status_code'] }      : {}),
                ...(attrs['http.url']         ? { http_url: attrs['http.url'].slice(0, 200) }   : {}),
              },
            });

            // Determine if this span is an error
            const httpStatus = Number(attrs['http.status_code'] ?? 0);
            const isSpanError  = span.status?.code === OTLP_STATUS_ERROR;
            const isHttpError  = httpStatus >= 400;

            if (isSpanError || isHttpError) {
              const severity = httpStatus >= 500 || isSpanError ? 'high' : 'low';
              const kind = httpStatus ? 'http.error' : 'trace.error';
              const title = httpStatus
                ? `HTTP ${httpStatus} — ${attrs['http.method'] ?? ''} ${(attrs['http.url'] ?? '').slice(0, 120)}`
                : `Span error: ${span.name}`;
              const fingerprint = `otel:${svc}:${span.name}:${httpStatus || 'error'}`;

              events.push({
                ts,
                asset_id:    assetId,
                namespace:   'otel',
                kind,
                severity,
                title:       title.trim() || span.name,
                message:     span.status?.message ?? attrs['exception.message'] ?? null,
                fingerprint,
                attributes: { ...attrs, trace_id: span.traceId, span_id: span.spanId },
              });
            }
          }
        }
      }

      if (metrics.length) { const r = await ingestMapped(pool, 'metric', metrics); ingested += r.ingested; }
      if (events.length)  { const r = await ingestMapped(pool, 'event',  events);  ingested += r.ingested; }
    } catch (e) { runError = String(e); }
    recordEvents('otlp', ingested);
    await logRun(pool, 'otlp', startedAt, ingested, req.headers['content-length'] ? Number(req.headers['content-length']) : 0, runError);
  });

  // ── Metrics ───────────────────────────────────────────────────────────────

  r.post('/otlp/v1/metrics', async (req: Request, res: Response) => {
    res.json({});
    if (!pool) return;

    const startedAt = new Date();
    let ingested = 0;
    let runError: string | null = null;
    try {
      const body = req.body as {
        resourceMetrics?: Array<{
          resource?: OtlpResource;
          scopeMetrics?: Array<{ metrics?: OtlpMetric[] }>;
        }>;
      };

      const points: Record<string, unknown>[] = [];

      for (const rm of body.resourceMetrics ?? []) {
        const svc     = serviceName(rm.resource);
        const assetId = `otel:${svc}`;

        for (const sm of rm.scopeMetrics ?? []) {
          for (const metric of sm.metrics ?? []) {
            const dataPoints: Array<{ ts: string; value: number; dimensions: Record<string,string> }> = [];

            for (const dp of metric.gauge?.dataPoints ?? metric.sum?.dataPoints ?? []) {
              const value = dp.asDouble ?? Number(dp.asInt ?? 0);
              dataPoints.push({
                ts:         nanoToIso(dp.timeUnixNano),
                value,
                dimensions: kvMap(dp.attributes),
              });
            }

            for (const dp of metric.histogram?.dataPoints ?? []) {
              if (dp.sum !== undefined && dp.count) {
                dataPoints.push({
                  ts:         nanoToIso(dp.timeUnixNano),
                  value:      dp.sum / dp.count,
                  dimensions: kvMap(dp.attributes),
                });
              }
            }

            for (const { ts, value, dimensions } of dataPoints) {
              points.push({
                ts,
                asset_id:   assetId,
                namespace:  'otel',
                metric:     metric.name,
                value,
                unit:       metric.unit ?? null,
                dimensions,
              });
            }
          }
        }
      }

      if (points.length) { const r = await ingestMapped(pool, 'metric', points); ingested += r.ingested; }
    } catch (e) { runError = String(e); }
    recordEvents('otlp', ingested);
    await logRun(pool, 'otlp', startedAt, ingested, req.headers['content-length'] ? Number(req.headers['content-length']) : 0, runError);
  });

  // ── Logs ──────────────────────────────────────────────────────────────────

  r.post('/otlp/v1/logs', async (req: Request, res: Response) => {
    res.json({});
    if (!pool) return;

    const startedAt = new Date();
    let ingested = 0;
    let runError: string | null = null;
    try {
      const body = req.body as {
        resourceLogs?: Array<{
          resource?: OtlpResource;
          scopeLogs?: Array<{ scope?: OtlpScope; logRecords?: OtlpLogRecord[] }>;
        }>;
      };

      const events: Record<string, unknown>[] = [];

      for (const rl of body.resourceLogs ?? []) {
        const svc     = serviceName(rl.resource);
        const assetId = `otel:${svc}`;

        for (const sl of rl.scopeLogs ?? []) {
          for (const log of sl.logRecords ?? []) {
            const tsNano = log.timeUnixNano ?? log.observedTimeUnixNano;
            if (!tsNano) continue;

            const severity  = otlpSevToOrbit(log.severityNumber);
            const bodyStr   = anyStr(log.body);
            const attrs     = kvMap(log.attributes);
            const loggerName = sl.scope?.name ?? 'app';
            const title      = (bodyStr || attrs['exception.type'] || 'log entry').slice(0, 200);

            events.push({
              ts:          nanoToIso(tsNano),
              asset_id:    assetId,
              namespace:   'otel',
              kind:        `log.${loggerName.slice(0, 60)}`,
              severity,
              title,
              message:     bodyStr || null,
              fingerprint: null,
              attributes:  { ...attrs, trace_id: log.traceId, span_id: log.spanId },
            });
          }
        }
      }

      if (events.length) { const r = await ingestMapped(pool, 'event', events); ingested += r.ingested; }
    } catch (e) { runError = String(e); }
    recordEvents('otlp', ingested);
    await logRun(pool, 'otlp', startedAt, ingested, req.headers['content-length'] ? Number(req.headers['content-length']) : 0, runError);
  });

  return r;
}
