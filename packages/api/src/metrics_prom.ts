import type { Request, Response } from 'express';
import { metricsState } from './metrics.js';
import { pool } from './db.js';

// Minimal Prometheus exposition (text/plain).

const DURATION_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

type HttpKey = string;

function escLabelValue(s: string) {
  return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function labelsToStr(labels: Record<string, string>) {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escLabelValue(v)}"`);
  return `{${parts.join(',')}}`;
}

export type HttpMetrics = {
  total: Map<HttpKey, number>;
  durationCount: Map<HttpKey, number>;
  durationSumMs: Map<HttpKey, number>;
  durationBuckets: Map<HttpKey, number[]>; // cumulative counts per bucket
};

export const httpMetrics: HttpMetrics = {
  total: new Map(),
  durationCount: new Map(),
  durationSumMs: new Map(),
  durationBuckets: new Map()
};

// Prevent unbounded growth from unexpected route variations (e.g. un-parameterised URLs).
const MAX_HTTP_KEYS = 500;

export function recordHttp(method: string, route: string, status: number, durationMs: number) {
  const key = `${method} ${route} ${status}`;

  // Drop new keys once cap is reached to prevent memory leak.
  if (!httpMetrics.total.has(key) && httpMetrics.total.size >= MAX_HTTP_KEYS) return;

  httpMetrics.total.set(key, (httpMetrics.total.get(key) ?? 0) + 1);
  httpMetrics.durationCount.set(key, (httpMetrics.durationCount.get(key) ?? 0) + 1);
  httpMetrics.durationSumMs.set(key, (httpMetrics.durationSumMs.get(key) ?? 0) + durationMs);

  if (!httpMetrics.durationBuckets.has(key)) {
    httpMetrics.durationBuckets.set(key, Array(DURATION_BUCKETS_MS.length + 1).fill(0));
  }
  const buckets = httpMetrics.durationBuckets.get(key)!;

  let idx = DURATION_BUCKETS_MS.findIndex((b) => durationMs <= b);
  if (idx === -1) idx = DURATION_BUCKETS_MS.length; // +Inf
  // increment the matching bucket (non-cumulative), we will export cumulative
  buckets[idx] += 1;
}

export function metricsPromHandler(_req: Request, res: Response) {
  const uptimeSec = (Date.now() - metricsState.startTimeMs) / 1000;
  const mem = process.memoryUsage();

  const lines: string[] = [];

  // process
  lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${uptimeSec.toFixed(3)}`);

  lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.');
  lines.push('# TYPE process_resident_memory_bytes gauge');
  lines.push(`process_resident_memory_bytes ${mem.rss}`);

  // pg pool
  lines.push('# HELP pg_pool_total Total number of clients in the pool.');
  lines.push('# TYPE pg_pool_total gauge');
  lines.push(`pg_pool_total ${pool ? pool.totalCount : 0}`);

  lines.push('# HELP pg_pool_idle Idle clients in the pool.');
  lines.push('# TYPE pg_pool_idle gauge');
  lines.push(`pg_pool_idle ${pool ? pool.idleCount : 0}`);

  lines.push('# HELP pg_pool_waiting Clients waiting for a pool connection.');
  lines.push('# TYPE pg_pool_waiting gauge');
  lines.push(`pg_pool_waiting ${pool ? pool.waitingCount : 0}`);

  // http
  lines.push('# HELP http_requests_total Total HTTP requests.');
  lines.push('# TYPE http_requests_total counter');

  for (const [key, v] of httpMetrics.total.entries()) {
    const [method, ...rest] = key.split(' ');
    const status = rest.pop()!;
    const route = rest.join(' ');
    lines.push(`http_requests_total${labelsToStr({ method, route, status })} ${v}`);
  }

  lines.push('# HELP http_request_duration_ms HTTP request duration (ms).');
  lines.push('# TYPE http_request_duration_ms histogram');

  for (const [key, counts] of httpMetrics.durationBuckets.entries()) {
    const [method, ...rest] = key.split(' ');
    const status = rest.pop()!;
    const route = rest.join(' ');

    // cumulative
    let cum = 0;
    for (let i = 0; i < DURATION_BUCKETS_MS.length; i++) {
      cum += counts[i] ?? 0;
      lines.push(
        `http_request_duration_ms_bucket${labelsToStr({ method, route, status, le: String(DURATION_BUCKETS_MS[i]) })} ${cum}`
      );
    }
    // +Inf
    cum += counts[DURATION_BUCKETS_MS.length] ?? 0;
    lines.push(
      `http_request_duration_ms_bucket${labelsToStr({ method, route, status, le: '+Inf' })} ${cum}`
    );

    const sum = httpMetrics.durationSumMs.get(key) ?? 0;
    const cnt = httpMetrics.durationCount.get(key) ?? 0;
    lines.push(`http_request_duration_ms_sum${labelsToStr({ method, route, status })} ${sum.toFixed(3)}`);
    lines.push(`http_request_duration_ms_count${labelsToStr({ method, route, status })} ${cnt}`);
  }

  res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n') + '\n');
}
