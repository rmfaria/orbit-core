/**
 * orbit-core — Connector Engine Registry
 *
 * Maps engine names to their executor functions.
 * When a connector_spec has engine='n8n', the worker dispatches here
 * instead of using the generic DSL flow.
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Pool } from 'pg';

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface AuthConfig {
  kind:   'bearer' | 'basic' | 'header';
  token?: string;
  user?:  string;
  pass?:  string;
  name?:  string;
  value?: string;
}

export interface EngineSpec {
  id:        string;
  source_id: string;
  spec:      Record<string, unknown>;
  auth:      AuthConfig | null;
  state:     Record<string, unknown> | null;
}

export interface EngineResult {
  events:   Record<string, unknown>[];
  newState: Record<string, unknown>;
}

export type EngineFn = (pool: Pool, spec: EngineSpec) => Promise<EngineResult>;

// ── Registry ─────────────────────────────────────────────────────────────────

import { executeN8n } from './n8n.js';

const engines: Record<string, EngineFn> = {
  n8n: executeN8n,
};

export function getEngine(name: string): EngineFn | undefined {
  return engines[name];
}
