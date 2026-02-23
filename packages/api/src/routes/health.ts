import type { Request, Response } from 'express';
import type { HealthResponse } from '@orbit/core-contracts';
import { getBuildInfo } from '../buildinfo.js';
import { metricsState } from '../metrics.js';

export function healthHandler(_req: Request, res: Response<HealthResponse & any>) {
  const b = getBuildInfo();
  res.json({
    ok: true,
    service: 'orbit-api',
    version: b.version,
    time: new Date().toISOString(),
    build: {
      git: b.git,
      time: b.buildTime,
      start_time: new Date(metricsState.startTimeMs).toISOString()
    }
  });
}
