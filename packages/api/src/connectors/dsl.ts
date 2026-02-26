/**
 * orbit-core — AI Connector DSL Engine
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared between the HTTP ingest endpoint (routes/connectors.ts)
 * and the background pull worker (connectors/worker.ts).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FieldMapping {
  path?:      string;
  value?:     unknown;
  transform?: string;
  default?:   unknown;
}

export interface ConnectorSpec {
  type:        'metric' | 'event';
  items_path?: string;
  mappings:    Record<string, FieldMapping>;
}

// ── Path resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve a dot/bracket path within a JSON value.
 * Supports: "data.items", "$.host.name", "results[0].value"
 */
export function getPath(obj: unknown, path: string): unknown {
  const clean = path.replace(/^\$\.?/, '');
  if (!clean) return obj;

  const tokens: string[] = [];
  for (const segment of clean.split('.')) {
    const m = segment.match(/^([^\[]+)(\[(\d+)\])?$/);
    if (m) {
      tokens.push(m[1]);
      if (m[3] !== undefined) tokens.push(m[3]);
    } else {
      tokens.push(segment);
    }
  }

  let cur: unknown = obj;
  for (const token of tokens) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      const idx = parseInt(token, 10);
      if (isNaN(idx)) return undefined;
      cur = cur[idx];
    } else {
      cur = (cur as Record<string, unknown>)[token];
    }
  }
  return cur;
}

// ── Transforms ────────────────────────────────────────────────────────────────

const SEVERITY_MAP: Record<string, string> = {
  '0': 'info', '1': 'low', '2': 'medium', '3': 'high', '4': 'critical',
  low: 'low', medium: 'medium', high: 'high', critical: 'critical',
  info: 'info', warning: 'medium', warn: 'medium', error: 'high',
  alert: 'high', emergency: 'critical',
};

export function applyTransform(value: unknown, transform: string): unknown {
  if (value == null) return value;
  switch (transform) {
    case 'number':   return Number(value);
    case 'string':   return String(value);
    case 'boolean':  return Boolean(value);
    case 'round':    return Math.round(Number(value));
    case 'abs':      return Math.abs(Number(value));
    case 'iso8601': {
      if (typeof value === 'number') {
        return new Date(value < 1e12 ? value * 1000 : value).toISOString();
      }
      return new Date(String(value)).toISOString();
    }
    case 'severity_map': {
      const key = String(value).toLowerCase();
      return SEVERITY_MAP[key] ?? 'medium';
    }
    default: return value;
  }
}

// ── Field resolution ──────────────────────────────────────────────────────────

export function resolveField(item: unknown, mapping: FieldMapping): unknown {
  if (mapping.value !== undefined) return mapping.value;
  const raw = mapping.path !== undefined ? getPath(item, mapping.path) : undefined;
  const val = raw !== undefined ? raw : mapping.default;
  return (val !== undefined && mapping.transform) ? applyTransform(val, mapping.transform) : val;
}

// ── Apply spec ────────────────────────────────────────────────────────────────

export function applySpec(payload: unknown, spec: ConnectorSpec): Record<string, unknown>[] {
  let items: unknown[];
  if (spec.items_path) {
    const found = getPath(payload, spec.items_path);
    items = Array.isArray(found) ? found : (found != null ? [found] : []);
  } else if (Array.isArray(payload)) {
    items = payload;
  } else {
    items = [payload];
  }

  return items.map(item => {
    const result: Record<string, unknown> = {};
    for (const [field, mapping] of Object.entries(spec.mappings)) {
      const v = resolveField(item, mapping);
      if (v !== undefined) result[field] = v;
    }
    return result;
  });
}
