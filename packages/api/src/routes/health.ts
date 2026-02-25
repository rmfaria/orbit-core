/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response } from 'express';
import type { HealthResponse } from '@orbit/core-contracts';
import { getBuildInfo } from '../buildinfo.js';
import { metricsState } from '../metrics.js';
import { pool } from '../db.js';

export async function healthHandler(_req: Request, res: Response<HealthResponse & any>) {
  const b = getBuildInfo();

  let db: 'ok' | 'error' | 'unconfigured' = 'unconfigured';
  if (pool) {
    try {
      await pool.query('select 1');
      db = 'ok';
    } catch {
      db = 'error';
    }
  }

  const status = db === 'error' ? 503 : 200;
  res.status(status).json({
    ok: db !== 'error',
    service: 'orbit-api',
    version: b.version,
    time: new Date().toISOString(),
    db,
    workers: pool ? ['rollup', 'correlate'] : [],
    build: {
      git: b.git,
      time: b.buildTime,
      start_time: new Date(metricsState.startTimeMs).toISOString()
    }
  });
}
