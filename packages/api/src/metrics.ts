import type { Request, Response, NextFunction } from 'express';

export type MetricsState = {
  startTimeMs: number;
  requestsTotal: number;
  requestsByRoute: Record<string, number>;
};

export const metricsState: MetricsState = {
  startTimeMs: Date.now(),
  requestsTotal: 0,
  requestsByRoute: {}
};

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  metricsState.requestsTotal += 1;
  const key = `${req.method} ${req.path}`;
  metricsState.requestsByRoute[key] = (metricsState.requestsByRoute[key] ?? 0) + 1;

  res.on('finish', async () => {
    try {
      const { recordHttp } = await import('./metrics_prom.js');
      recordHttp(req.method, req.path, res.statusCode, Date.now() - start);
    } catch {
      // ignore
    }
  });

  next();
}

export function metricsHandler(_req: Request, res: Response) {
  const uptimeSec = Math.floor((Date.now() - metricsState.startTimeMs) / 1000);
  const mem = process.memoryUsage();

  res.json({
    ok: true,
    service: 'orbit-api',
    time: new Date().toISOString(),
    node: process.version,
    pid: process.pid,
    uptime_sec: uptimeSec,
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external
    },
    requests: {
      total: metricsState.requestsTotal,
      byRoute: metricsState.requestsByRoute
    }
  });
}
