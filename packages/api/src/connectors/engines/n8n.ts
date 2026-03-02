/**
 * orbit-core — n8n Built-in Connector Engine
 *
 * TypeScript port of connectors/n8n/ship_events.py.
 * Polls the n8n REST API for:
 *   Phase 1: Failed executions (status=error) newer than cursor
 *   Phase 2: Stuck running executions older than threshold
 *
 * Returns orbit events in canonical format. The worker handles ingestion.
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Pool } from 'pg';
import type { EngineSpec, EngineResult } from './index.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })
  .child({ module: 'engine-n8n' });

// ── Defaults (overridable via spec JSONB) ────────────────────────────────────

const DEFAULT_STUCK_AFTER_MINUTES    = 30;
const DEFAULT_MAX_EXECUTIONS_PER_RUN = 500;
const DEFAULT_LOOKBACK_MINUTES       = 60;
const PAGE_LIMIT                     = 100;
const FETCH_TIMEOUT_MS               = 30_000;

// ── Config ───────────────────────────────────────────────────────────────────

interface N8nConfig {
  n8nUrl:              string;
  stuckAfterMinutes:   number;
  maxExecutionsPerRun: number;
  lookbackMinutes:     number;
}

function resolveConfig(spec: Record<string, unknown>): N8nConfig {
  return {
    n8nUrl:              String(spec.n8n_url ?? '').replace(/\/+$/, ''),
    stuckAfterMinutes:   Number(spec.stuck_after_minutes ?? DEFAULT_STUCK_AFTER_MINUTES),
    maxExecutionsPerRun: Number(spec.max_executions_per_run ?? DEFAULT_MAX_EXECUTIONS_PER_RUN),
    lookbackMinutes:     Number(spec.lookback_minutes ?? DEFAULT_LOOKBACK_MINUTES),
  };
}

// ── Auth header builder ──────────────────────────────────────────────────────

function buildHeaders(auth: EngineSpec['auth']): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept':     'application/json',
    'User-Agent': 'orbit-core-connector/1.0',
  };
  if (auth) {
    if (auth.kind === 'header' && auth.name) {
      headers[auth.name] = auth.value ?? '';
    } else if (auth.kind === 'bearer' && auth.token) {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else if (auth.kind === 'basic' && auth.user) {
      headers['Authorization'] =
        `Basic ${Buffer.from(`${auth.user}:${auth.pass ?? ''}`).toString('base64')}`;
    }
  }
  return headers;
}

// ── n8n API page fetch ───────────────────────────────────────────────────────

interface N8nPage {
  data:       Record<string, unknown>[];
  nextCursor: string | null;
}

async function fetchPage(
  n8nUrl:  string,
  headers: Record<string, string>,
  status:  string,
  cursor:  string | null,
): Promise<N8nPage> {
  const url = new URL(`${n8nUrl}/api/v1/executions`);
  url.searchParams.set('status', status);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  url.searchParams.set('includeData', 'false');
  if (cursor) url.searchParams.set('cursor', cursor);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`n8n API HTTP ${res.status} ${res.statusText}`);
    const json = await res.json() as Record<string, unknown>;
    return {
      data:       Array.isArray(json.data) ? json.data as Record<string, unknown>[] : [],
      nextCursor: (json.nextCursor as string) || null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Event builders ───────────────────────────────────────────────────────────

function toErrorEvent(ex: Record<string, unknown>, n8nUrl: string): Record<string, unknown> {
  const wfData  = (ex.workflowData as Record<string, unknown>) ?? {};
  const wfName  = String(wfData.name ?? ex.workflowId ?? 'unknown');
  const execId  = String(ex.id ?? '');
  const wfId    = String(ex.workflowId ?? '');
  const stopped = String(ex.stoppedAt ?? ex.startedAt ?? new Date().toISOString());

  let ts: string;
  try {
    ts = new Date(stopped).toISOString();
  } catch {
    ts = new Date().toISOString();
  }

  return {
    ts,
    asset_id:    `workflow:${wfName}`,
    namespace:   'n8n',
    kind:        'execution_error',
    severity:    'high',
    title:       `Workflow "${wfName}" failed (execution ${execId})`,
    message:     `Execution ${execId} for workflow "${wfName}" ended with status=error.`,
    fingerprint: `n8n:error:${execId}`,
    attributes: {
      execution_id:  execId,
      workflow_id:   wfId,
      workflow_name: wfName,
      status:        'error',
      started_at:    ex.startedAt ?? null,
      stopped_at:    ex.stoppedAt ?? null,
      n8n_url:       n8nUrl,
    },
  };
}

function toStuckEvent(
  ex: Record<string, unknown>,
  stuckMinutes: number,
  stuckThreshold: number,
  n8nUrl: string,
): Record<string, unknown> {
  const wfData = (ex.workflowData as Record<string, unknown>) ?? {};
  const wfName = String(wfData.name ?? ex.workflowId ?? 'unknown');
  const execId = String(ex.id ?? '');
  const wfId   = String(ex.workflowId ?? '');

  return {
    ts:          new Date().toISOString(),
    asset_id:    `workflow:${wfName}`,
    namespace:   'n8n',
    kind:        'execution_stuck',
    severity:    'medium',
    title:       `Workflow "${wfName}" stuck for ${Math.floor(stuckMinutes)}m (execution ${execId})`,
    message:     `Execution ${execId} for workflow "${wfName}" has been running for ${Math.floor(stuckMinutes)} minutes (threshold: ${stuckThreshold}m).`,
    fingerprint: `n8n:stuck:${execId}`,
    attributes: {
      execution_id:      execId,
      workflow_id:       wfId,
      workflow_name:     wfName,
      status:            'running',
      started_at:        ex.startedAt ?? null,
      stuck_minutes:     Math.round(stuckMinutes * 10) / 10,
      stuck_threshold_m: stuckThreshold,
      n8n_url:           n8nUrl,
    },
  };
}

// ── Phase 1: Error executions ────────────────────────────────────────────────

async function fetchErrorEvents(
  n8nUrl:  string,
  headers: Record<string, string>,
  since:   string,
  maxExec: number,
): Promise<{ events: Record<string, unknown>[]; newSince: string }> {
  const events: Record<string, unknown>[] = [];
  let newSince = since;
  let cursor: string | null = null;

  while (events.length < maxExec) {
    const page = await fetchPage(n8nUrl, headers, 'error', cursor);
    if (!page.data.length) break;

    let pageHadNew = false;
    for (const ex of page.data) {
      const stopped = String(ex.stoppedAt ?? ex.startedAt ?? '');
      if (stopped && stopped > since) {
        events.push(toErrorEvent(ex, n8nUrl));
        pageHadNew = true;
        if (stopped > newSince) newSince = stopped;
      }
    }

    if (!pageHadNew) break;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return { events, newSince };
}

// ── Phase 2: Stuck executions ────────────────────────────────────────────────

async function fetchStuckEvents(
  n8nUrl:    string,
  headers:   Record<string, string>,
  threshold: number,
): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  const now = Date.now();
  const thresholdMs = threshold * 60_000;
  let cursor: string | null = null;

  while (true) {
    const page = await fetchPage(n8nUrl, headers, 'running', cursor);
    if (!page.data.length) break;

    for (const ex of page.data) {
      const raw = ex.startedAt as string | undefined;
      if (!raw) continue;
      const started = new Date(raw).getTime();
      if (isNaN(started)) continue;
      const ageMs = now - started;
      if (ageMs > thresholdMs) {
        events.push(toStuckEvent(ex, ageMs / 60_000, threshold, n8nUrl));
      }
    }

    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return events;
}

// ── Main engine entry point ──────────────────────────────────────────────────

export async function executeN8n(_pool: Pool, spec: EngineSpec): Promise<EngineResult> {
  const config  = resolveConfig(spec.spec);
  const headers = buildHeaders(spec.auth);

  if (!config.n8nUrl) throw new Error('n8n engine: n8n_url is required in spec');

  // Resolve "since" cursor from persisted state or lookback window
  const state = spec.state ?? {};
  let since = state.since as string | undefined;
  if (!since) {
    since = new Date(Date.now() - config.lookbackMinutes * 60_000).toISOString();
  }

  logger.info({ source_id: spec.source_id, since }, 'n8n engine starting');

  // Phase 1: error executions
  const { events: errorEvents, newSince } = await fetchErrorEvents(
    config.n8nUrl, headers, since, config.maxExecutionsPerRun,
  );

  // Phase 2: stuck executions
  const stuckEvents = await fetchStuckEvents(
    config.n8nUrl, headers, config.stuckAfterMinutes,
  );

  const allEvents = [...errorEvents, ...stuckEvents];

  // Advance cursor
  let advancedSince = since;
  if (newSince > since) {
    advancedSince = newSince;
  } else {
    try {
      advancedSince = new Date(new Date(since).getTime() + 1000).toISOString();
    } catch { /* keep current */ }
  }

  logger.info(
    { source_id: spec.source_id, errors: errorEvents.length, stuck: stuckEvents.length, newSince: advancedSince },
    'n8n engine complete',
  );

  return {
    events:   allEvents,
    newState: { since: advancedSince },
  };
}
