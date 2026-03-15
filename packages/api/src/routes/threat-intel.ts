/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { logRun } from '../connectors/ingest.js';

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const optIso = z.string().regex(ISO8601_RE).optional();

const IndicatorSchema = z.object({
  source: z.string().min(1),
  source_id: z.string().min(1),
  type: z.string().min(1),
  value: z.string().min(1),
  threat_level: z.enum(['high', 'medium', 'low', 'undefined', 'unknown']).default('unknown'),
  tags: z.array(z.string()).default([]),
  event_info: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  attributes: z.record(z.any()).default({}),
  first_seen: optIso,
  last_seen: optIso,
  expires_at: optIso,
  enabled: z.boolean().default(true),
});

const IngestIndicatorsSchema = z.object({
  indicators: z.array(IndicatorSchema).max(5000),
});

// Wrap async handlers
function a(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => fn(req, res).catch(next);
}

export function threatIntelRouter(pool: Pool | null): Router {
  const r = Router();

  // POST /threat-intel/indicators — batch upsert indicators
  r.post('/threat-intel/indicators', a(async (req, res) => {
    if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });
    const startedAt = new Date();

    const body = IngestIndicatorsSchema.parse(req.body);
    const { indicators } = body;

    if (!indicators.length) {
      return res.json({ ok: true, upserted: 0 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO threat_indicators
           (source, source_id, type, value, threat_level, tags, event_info, comment, attributes,
            first_seen, last_seen, expires_at, enabled)
         SELECT
           s.source, s.source_id, s.type, s.value, s.threat_level,
           ARRAY(SELECT jsonb_array_elements_text(s.tags_json)) AS tags,
           s.event_info, s.comment, s.attributes,
           s.first_seen, s.last_seen, s.expires_at, s.enabled
         FROM unnest(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::jsonb[],
           $7::text[], $8::text[], $9::jsonb[], $10::timestamptz[], $11::timestamptz[],
           $12::timestamptz[], $13::boolean[]
         ) AS s(source, source_id, type, value, threat_level, tags_json, event_info, comment,
                attributes, first_seen, last_seen, expires_at, enabled)
         ON CONFLICT (source, source_id) DO UPDATE SET
           type          = excluded.type,
           value         = excluded.value,
           threat_level  = excluded.threat_level,
           tags          = excluded.tags,
           event_info    = excluded.event_info,
           comment       = excluded.comment,
           attributes    = excluded.attributes,
           last_seen     = excluded.last_seen,
           expires_at    = excluded.expires_at,
           enabled       = excluded.enabled,
           updated_at    = now()`,
        [
          indicators.map(i => i.source),
          indicators.map(i => i.source_id),
          indicators.map(i => i.type),
          indicators.map(i => i.value),
          indicators.map(i => i.threat_level),
          indicators.map(i => JSON.stringify(i.tags)),
          indicators.map(i => i.event_info ?? null),
          indicators.map(i => i.comment ?? null),
          indicators.map(i => JSON.stringify(i.attributes)),
          indicators.map(i => i.first_seen ?? new Date().toISOString()),
          indicators.map(i => i.last_seen ?? new Date().toISOString()),
          indicators.map(i => i.expires_at ?? null),
          indicators.map(i => i.enabled),
        ],
      );

      await client.query('COMMIT');

      // Log connector run
      const sourceId = req.headers['x-source-id'] as string | undefined;
      if (sourceId) {
        const rawSize = req.headers['content-length'] ? parseInt(req.headers['content-length'] as string, 10) : 0;
        await logRun(pool, sourceId, startedAt, indicators.length, rawSize, null);
      }

      res.json({ ok: true, upserted: indicators.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  // GET /threat-intel/indicators — list/search indicators
  r.get('/threat-intel/indicators', a(async (req, res) => {
    if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

    const {
      type,
      value,
      threat_level,
      source,
      enabled,
      limit = '100',
      offset = '0',
    } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (type) {
      conditions.push(`type = $${idx++}`);
      params.push(type);
    }
    if (value) {
      conditions.push(`value ILIKE $${idx++}`);
      params.push(`%${value}%`);
    }
    if (threat_level) {
      conditions.push(`threat_level = $${idx++}`);
      params.push(threat_level);
    }
    if (source) {
      conditions.push(`source = $${idx++}`);
      params.push(source);
    }
    if (enabled !== undefined && enabled !== '') {
      conditions.push(`enabled = $${idx++}`);
      params.push(enabled === 'true');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim = Math.min(parseInt(limit) || 100, 1000);
    const off = parseInt(offset) || 0;

    const { rows } = await pool.query(
      `SELECT *, count(*) OVER() AS total_count
       FROM threat_indicators
       ${where}
       ORDER BY updated_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, lim, off],
    );

    const total = rows.length > 0 ? parseInt(rows[0].total_count) : 0;
    const items = rows.map(({ total_count, ...rest }) => rest);

    res.json({ ok: true, total, items });
  }));

  // GET /threat-intel/indicators/match — check if a value matches known IoCs
  r.get('/threat-intel/indicators/match', a(async (req, res) => {
    if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

    const { value } = req.query as Record<string, string>;
    if (!value) return res.status(400).json({ ok: false, error: 'value parameter is required' });

    const { rows } = await pool.query(
      `SELECT id, source, source_id, type, value, threat_level, tags, event_info, attributes
       FROM threat_indicators
       WHERE value = $1
         AND enabled = true
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY threat_level ASC
       LIMIT 50`,
      [value],
    );

    res.json({ ok: true, matches: rows });
  }));

  // GET /threat-intel/stats — summary statistics
  r.get('/threat-intel/stats', a(async (req, res) => {
    if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

    const { rows } = await pool.query(`
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE enabled = true AND (expires_at IS NULL OR expires_at > now())) AS active,
        count(*) FILTER (WHERE threat_level = 'high') AS high,
        count(*) FILTER (WHERE threat_level = 'medium') AS medium,
        count(*) FILTER (WHERE threat_level = 'low') AS low,
        count(DISTINCT type) AS types,
        count(DISTINCT source) AS sources,
        min(created_at) AS oldest,
        max(updated_at) AS newest
      FROM threat_indicators
    `);

    // Top types breakdown
    const { rows: typeRows } = await pool.query(`
      SELECT type, count(*) AS count
      FROM threat_indicators
      WHERE enabled = true
      GROUP BY type
      ORDER BY count DESC
      LIMIT 20
    `);

    res.json({
      ok: true,
      stats: {
        ...rows[0],
        by_type: typeRows,
      },
    });
  }));

  // DELETE /threat-intel/indicators/:id — delete a single indicator
  r.delete('/threat-intel/indicators/:id', a(async (req, res) => {
    if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

    const { id } = req.params;
    const { rowCount } = await pool.query(
      'DELETE FROM threat_indicators WHERE id = $1',
      [id],
    );

    if (!rowCount) return res.status(404).json({ ok: false, error: 'Indicator not found' });
    res.json({ ok: true, deleted: 1 });
  }));

  return r;
}
