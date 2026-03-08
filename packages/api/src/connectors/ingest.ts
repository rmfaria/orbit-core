/**
 * orbit-core — AI Connector shared ingest logic
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Validates mapped items and bulk-inserts into metric_points or orbit_events.
 * Shared between the HTTP raw-ingest endpoint and the pull worker.
 */

import type { Pool } from 'pg';

export const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export const VALID_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);

export interface IngestResult {
  ingested: number;
  skipped:  number;
  errors:   string[];
}

// ── Asset upsert ──────────────────────────────────────────────────────────────

export async function ensureAssets(pool: Pool, assetIds: string[]): Promise<void> {
  const uniq = Array.from(new Set(assetIds)).filter(Boolean);
  if (!uniq.length) return;
  const rowsSql = uniq.map((_, i) => `($${i + 1}, 'custom', $${i + 1})`).join(',');
  await pool.query(
    `INSERT INTO assets(asset_id, type, name) VALUES ${rowsSql}
     ON CONFLICT (asset_id) DO UPDATE SET last_seen = now()`,
    uniq
  );
}

// ── Bulk ingest ───────────────────────────────────────────────────────────────

export async function ingestMapped(
  pool: Pool,
  connType: 'metric' | 'event',
  items: Record<string, unknown>[],
): Promise<IngestResult> {
  const result: IngestResult = { ingested: 0, skipped: 0, errors: [] };

  if (connType === 'metric') {
    const valid = items.filter(item => {
      const ok =
        item.ts        && ISO8601_RE.test(String(item.ts)) &&
        item.asset_id  && item.namespace && item.metric &&
        item.value !== undefined && !isNaN(Number(item.value));
      if (!ok) {
        result.skipped++;
        result.errors.push(`invalid metric: ${JSON.stringify(item)}`);
      }
      return ok;
    });

    if (valid.length) {
      await ensureAssets(pool, valid.map(m => String(m.asset_id)));
      await pool.query(
        `INSERT INTO metric_points(ts, asset_id, namespace, metric, value, unit, dimensions)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::float8[], $6::text[], $7::jsonb[])
           AS t(ts, asset_id, namespace, metric, value, unit, dimensions)`,
        [
          valid.map(m => m.ts),
          valid.map(m => m.asset_id),
          valid.map(m => m.namespace),
          valid.map(m => m.metric),
          valid.map(m => Number(m.value)),
          valid.map(m => m.unit ?? null),
          valid.map(m => JSON.stringify(m.dimensions ?? {})),
        ]
      );
      result.ingested = valid.length;
    }

  } else {
    // type === 'event'
    const valid = items.filter(item => {
      const ok =
        item.ts        && ISO8601_RE.test(String(item.ts)) &&
        item.asset_id  && item.namespace && item.kind &&
        item.severity  && VALID_SEVERITIES.has(String(item.severity)) &&
        item.title;
      if (!ok) {
        result.skipped++;
        result.errors.push(`invalid event: ${JSON.stringify(item)}`);
      }
      return ok;
    });

    if (valid.length) {
      // Deduplicate by fingerprint (keep last = latest ts) before bulk INSERT.
      const fpSeen = new Set<string>();
      const deduped: typeof valid = [];
      for (let i = valid.length - 1; i >= 0; i--) {
        const ev = valid[i];
        const fp = ev.fingerprint ? String(ev.fingerprint) : null;
        if (fp) {
          if (!fpSeen.has(fp)) { fpSeen.add(fp); deduped.push(ev); }
        } else {
          deduped.push(ev);
        }
      }

      await ensureAssets(pool, deduped.map(e => String(e.asset_id)));
      await pool.query(
        `INSERT INTO orbit_events
           (ts, asset_id, namespace, kind, severity, title, message, fingerprint, attributes)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::jsonb[])
           AS t(ts, asset_id, namespace, kind, severity, title, message, fingerprint, attributes)
         ON CONFLICT (fingerprint, ts) WHERE fingerprint IS NOT NULL
         DO UPDATE SET
           severity = EXCLUDED.severity,
           title = EXCLUDED.title, message = EXCLUDED.message,
           attributes = EXCLUDED.attributes, ingested_at = now()`,
        [
          deduped.map(e => e.ts),
          deduped.map(e => e.asset_id),
          deduped.map(e => e.namespace),
          deduped.map(e => e.kind),
          deduped.map(e => e.severity),
          deduped.map(e => e.title),
          deduped.map(e => e.message ?? null),
          deduped.map(e => e.fingerprint ?? null),
          deduped.map(e => JSON.stringify(e.attributes ?? {})),
        ]
      );
      result.ingested = deduped.length;
    }
  }

  return result;
}

// ── Dry-run validation (no DB writes) ────────────────────────────────────────

export interface ValidateResult {
  valid:  number;
  skipped: number;
  errors: string[];
  mapped: Record<string, unknown>[];
}

export function validateMapped(
  connType: 'metric' | 'event',
  items: Record<string, unknown>[],
): ValidateResult {
  const result: ValidateResult = { valid: 0, skipped: 0, errors: [], mapped: [] };

  if (connType === 'metric') {
    for (const item of items) {
      const ok =
        item.ts        && ISO8601_RE.test(String(item.ts)) &&
        item.asset_id  && item.namespace && item.metric &&
        item.value !== undefined && !isNaN(Number(item.value));
      if (ok) { result.valid++; result.mapped.push(item); }
      else    { result.skipped++; result.errors.push(`invalid metric: ${JSON.stringify(item)}`); }
    }
  } else {
    for (const item of items) {
      const ok =
        item.ts        && ISO8601_RE.test(String(item.ts)) &&
        item.asset_id  && item.namespace && item.kind &&
        item.severity  && VALID_SEVERITIES.has(String(item.severity)) &&
        item.title;
      if (ok) { result.valid++; result.mapped.push(item); }
      else    { result.skipped++; result.errors.push(`invalid event: ${JSON.stringify(item)}`); }
    }
  }

  return result;
}

// ── Run log ───────────────────────────────────────────────────────────────────

export async function logRun(
  pool: Pool,
  source_id: string,
  startedAt: Date,
  ingested:  number,
  rawSize:   number,
  error:     string | null,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO connector_runs
         (source_id, started_at, finished_at, status, ingested, raw_size, error)
       VALUES ($1, $2, now(), $3, $4, $5, $6)`,
      [source_id, startedAt, error ? 'error' : 'ok', ingested, rawSize, error]
    );
  } catch {
    // best-effort — don't fail the caller because the run log failed
  }
}
