/**
 * orbit-core — AI Connector Pull Worker
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Periodically fetches data from all approved pull-mode connectors.
 *
 * - Checks every CHECK_INTERVAL_MS which connectors are due to run
 * - "Due" = no successful run in the last pull_interval_min minutes
 * - Prevents overlapping runs for the same source_id via a `running` Set
 * - On startup, loads last-run times from DB to avoid re-pulling everything
 *   immediately after a server restart
 */

import type { Pool } from 'pg';
import pino from 'pino';
import { applySpec, type ConnectorSpec } from './dsl.js';
import { ingestMapped, logRun } from './ingest.js';
import { heartbeat, workerError } from '../worker-registry.js';
import { getEngine } from './engines/index.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'connector-worker' });

const CHECK_INTERVAL_MS = 30_000;   // how often to check for due connectors
const INIT_DELAY_MS     = 15_000;   // wait after startup before first check
const FETCH_TIMEOUT_MS  = 30_000;   // max time to wait for a remote HTTP response

// ── Pull row type ─────────────────────────────────────────────────────────────

interface AuthConfig {
  kind:   'bearer' | 'basic' | 'header';
  token?: string;   // bearer
  user?:  string;   // basic
  pass?:  string;   // basic
  name?:  string;   // header
  value?: string;   // header
}

interface PullSpec {
  id:                string;
  source_id:         string;
  type:              'metric' | 'event';
  spec:              ConnectorSpec;
  pull_url:          string;
  pull_interval_min: number;
  auth:              AuthConfig | null;
  engine:            string | null;
  state:             Record<string, unknown> | null;
}

// ── Worker ────────────────────────────────────────────────────────────────────

export function startConnectorWorker(pool: Pool): () => void {
  // in-memory last-run tracking: source_id → last successful run time
  const lastRun = new Map<string, Date>();

  // prevents concurrent runs for the same connector
  const running = new Set<string>();

  // Initialize from DB — avoids re-pulling everything on restart
  pool.query<{ source_id: string; started_at: string }>(
    `SELECT DISTINCT ON (source_id) source_id, started_at
     FROM connector_runs
     WHERE status = 'ok'
     ORDER BY source_id, started_at DESC`
  ).then(({ rows }) => {
    for (const row of rows) lastRun.set(row.source_id, new Date(row.started_at));
    if (rows.length) logger.info({ sources: rows.length }, 'initialized last-run times from DB');
  }).catch(err => {
    logger.warn({ err }, 'failed to load last-run times from DB — will pull all on first tick');
  });

  async function tick(): Promise<void> {
    const { rows } = await pool.query<PullSpec>(
      `SELECT id, source_id, type, spec, pull_url, auth, engine, state,
              COALESCE(pull_interval_min, 5) AS pull_interval_min
       FROM connector_specs
       WHERE mode = 'pull'
         AND status = 'approved'
         AND (
           (engine IS NULL AND pull_url IS NOT NULL AND pull_url != '')
           OR engine IS NOT NULL
         )`
    );

    if (!rows.length) return;

    const now = new Date();

    for (const s of rows) {
      if (running.has(s.source_id)) {
        logger.debug({ source_id: s.source_id }, 'pull skipped — run already in progress');
        continue;
      }

      const intervalMs = Math.max(1, s.pull_interval_min) * 60_000;
      const last = lastRun.get(s.source_id);
      if (last && now.getTime() - last.getTime() < intervalMs) continue;

      // Mark as running and record the attempt time before dispatching
      running.add(s.source_id);
      lastRun.set(s.source_id, now);

      if (s.engine) {
        executeEnginePull(pool, s).finally(() => running.delete(s.source_id));
      } else {
        executePull(pool, s).finally(() => running.delete(s.source_id));
      }
    }
  }

  function tickSafe(): void {
    tick().then(() => heartbeat('connectors')).catch(err => { logger.error({ err }, 'connector worker tick failed'); workerError('connectors'); });
  }

  const tInit     = setTimeout(tickSafe, INIT_DELAY_MS);
  const tInterval = setInterval(tickSafe, CHECK_INTERVAL_MS);

  logger.info(
    { check_interval_ms: CHECK_INTERVAL_MS, init_delay_ms: INIT_DELAY_MS },
    'connector worker started'
  );

  return () => {
    clearTimeout(tInit);
    clearInterval(tInterval);
  };
}

// ── Single pull execution ─────────────────────────────────────────────────────

async function executePull(pool: Pool, s: PullSpec): Promise<void> {
  const startedAt = new Date();

  logger.debug({ source_id: s.source_id, url: s.pull_url }, 'pull connector starting');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const fetchHeaders: Record<string, string> = {
      'Accept':     'application/json',
      'User-Agent': 'orbit-core-connector/1.0',
    };
    if (s.auth) {
      if (s.auth.kind === 'bearer' && s.auth.token) {
        fetchHeaders['Authorization'] = `Bearer ${s.auth.token}`;
      } else if (s.auth.kind === 'basic' && s.auth.user) {
        fetchHeaders['Authorization'] =
          `Basic ${Buffer.from(`${s.auth.user}:${s.auth.pass ?? ''}`).toString('base64')}`;
      } else if (s.auth.kind === 'header' && s.auth.name) {
        fetchHeaders[s.auth.name] = s.auth.value ?? '';
      }
    }

    let response: Response;
    try {
      response = await fetch(s.pull_url, {
        signal:  controller.signal,
        headers: fetchHeaders,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const payload  = await response.json() as unknown;
    const rawSize  = JSON.stringify(payload).length;
    const items    = applySpec(payload, s.spec);

    const { ingested, skipped } = await ingestMapped(pool, s.type, items);

    await logRun(pool, s.source_id, startedAt, ingested, rawSize, null);

    logger.info(
      { source_id: s.source_id, ingested, skipped, raw_size: rawSize },
      'pull connector ok'
    );

  } catch (err: unknown) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    await logRun(pool, s.source_id, startedAt, 0, 0, msg);
    logger.error({ source_id: s.source_id, err: msg }, 'pull connector failed');
  }
}

// ── Engine-based pull execution ──────────────────────────────────────────────

async function executeEnginePull(pool: Pool, s: PullSpec): Promise<void> {
  const startedAt = new Date();
  logger.debug({ source_id: s.source_id, engine: s.engine }, 'engine pull starting');

  try {
    const engineFn = getEngine(s.engine!);
    if (!engineFn) throw new Error(`unknown engine: ${s.engine}`);

    const result = await engineFn(pool, {
      id:        s.id,
      source_id: s.source_id,
      spec:      s.spec as unknown as Record<string, unknown>,
      auth:      s.auth,
      state:     s.state,
    });

    let ingested = 0;
    if (result.events.length) {
      const r = await ingestMapped(pool, 'event', result.events);
      ingested = r.ingested;
    }

    // Persist engine state (cursor/checkpoint)
    await pool.query(
      `UPDATE connector_specs SET state = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(result.newState), s.id],
    );

    await logRun(pool, s.source_id, startedAt, ingested, 0, null);

    logger.info(
      { source_id: s.source_id, engine: s.engine, ingested },
      'engine pull ok',
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logRun(pool, s.source_id, startedAt, 0, 0, msg);
    logger.error({ source_id: s.source_id, engine: s.engine, err: msg }, 'engine pull failed');
  }
}
