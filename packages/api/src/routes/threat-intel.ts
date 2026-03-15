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

  // GET /threat-intel/matches — list IoC matches (events that hit indicators)
  r.get('/threat-intel/matches', a(async (req, res) => {
    if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

    const {
      from, to, asset_id, threat_level, indicator_type,
      limit = '100', offset = '0',
    } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (from) {
      conditions.push(`tm.detected_at >= $${idx++}::timestamptz`);
      params.push(from);
    }
    if (to) {
      conditions.push(`tm.detected_at <= $${idx++}::timestamptz`);
      params.push(to);
    }
    if (asset_id) {
      conditions.push(`e.asset_id = $${idx++}`);
      params.push(asset_id);
    }
    if (threat_level) {
      conditions.push(`tm.threat_level = $${idx++}`);
      params.push(threat_level);
    }
    if (indicator_type) {
      conditions.push(`tm.indicator_type = $${idx++}`);
      params.push(indicator_type);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim = Math.min(parseInt(limit) || 100, 1000);
    const off = parseInt(offset) || 0;

    const { rows } = await pool.query(
      `SELECT
         tm.id, tm.event_id, tm.indicator_id, tm.matched_field, tm.matched_value,
         tm.indicator_type, tm.threat_level, tm.detected_at,
         e.asset_id, e.namespace, e.kind, e.severity AS event_severity, e.title AS event_title, e.ts AS event_ts,
         ti.value AS indicator_value, ti.tags, ti.event_info AS indicator_event_info,
         count(*) OVER() AS total_count
       FROM threat_matches tm
       JOIN orbit_events e ON e.id = tm.event_id
       JOIN threat_indicators ti ON ti.id = tm.indicator_id
       ${where}
       ORDER BY tm.detected_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, lim, off],
    );

    const total = rows.length > 0 ? parseInt(rows[0].total_count) : 0;
    const items = rows.map(({ total_count, ...rest }) => rest);

    res.json({ ok: true, total, items });
  }));

  // GET /threat-intel/matches/summary — aggregated match statistics
  r.get('/threat-intel/matches/summary', a(async (req, res) => {
    if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

    const { from, to } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (from) { conditions.push(`tm.detected_at >= $${idx++}::timestamptz`); params.push(from); }
    if (to)   { conditions.push(`tm.detected_at <= $${idx++}::timestamptz`); params.push(to); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [totals, byType, byAsset, timeline] = await Promise.all([
      pool.query(`
        SELECT
          count(*)::int AS total_matches,
          count(DISTINCT tm.event_id)::int AS events_matched,
          count(DISTINCT tm.indicator_id)::int AS indicators_triggered,
          count(DISTINCT e.asset_id)::int AS assets_affected,
          count(*) FILTER (WHERE tm.threat_level = 'high')::int AS high_matches,
          count(*) FILTER (WHERE tm.threat_level = 'medium')::int AS medium_matches
        FROM threat_matches tm
        JOIN orbit_events e ON e.id = tm.event_id
        ${where}
      `, params),

      pool.query(`
        SELECT tm.indicator_type, tm.threat_level, count(*)::int AS count
        FROM threat_matches tm ${where}
        GROUP BY tm.indicator_type, tm.threat_level
        ORDER BY count DESC
      `, params),

      pool.query(`
        SELECT e.asset_id, count(*)::int AS match_count,
               count(DISTINCT tm.indicator_id)::int AS unique_indicators,
               max(tm.detected_at) AS last_match
        FROM threat_matches tm
        JOIN orbit_events e ON e.id = tm.event_id
        ${where}
        GROUP BY e.asset_id
        ORDER BY match_count DESC
        LIMIT 20
      `, params),

      pool.query(`
        SELECT date_trunc('hour', tm.detected_at)::text AS bucket,
               count(*)::int AS match_count,
               count(*) FILTER (WHERE tm.threat_level = 'high')::int AS high_count
        FROM threat_matches tm ${where}
        GROUP BY 1
        ORDER BY 1
      `, params),
    ]);

    res.json({
      ok: true,
      summary: totals.rows[0] ?? {},
      by_type: byType.rows,
      by_asset: byAsset.rows,
      timeline: timeline.rows,
    });
  }));

  // GET /threat-intel/feed — last N hours of MISP activity (indicators + events + hits)
  r.get('/threat-intel/feed', a(async (req, res) => {
    if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

    const hours = Math.min(parseInt(req.query.hours as string) || 4, 72);

    const [indicators, iocEvents, iocHits] = await Promise.all([
      // Recent indicators ingested from MISP
      pool.query(`
        SELECT id, source, source_id, type, value, threat_level, tags, event_info, comment,
               attributes, first_seen, last_seen, created_at, updated_at
        FROM threat_indicators
        WHERE source = 'misp'
          AND updated_at >= now() - make_interval(hours => $1)
        ORDER BY updated_at DESC
        LIMIT 200
      `, [hours]),

      // Recent ioc.new events (IoCs shipped as events for visibility)
      pool.query(`
        SELECT id, ts, asset_id, namespace, kind, severity, title, message, fingerprint, attributes
        FROM orbit_events
        WHERE namespace = 'misp' AND kind = 'ioc.new'
          AND ts >= now() - make_interval(hours => $1)
        ORDER BY ts DESC
        LIMIT 100
      `, [hours]),

      // Recent ioc.hit events (correlation matches)
      pool.query(`
        SELECT id, ts, asset_id, namespace, kind, severity, title, message, fingerprint, attributes
        FROM orbit_events
        WHERE namespace = 'misp' AND kind = 'ioc.hit'
          AND ts >= now() - make_interval(hours => $1)
        ORDER BY ts DESC
        LIMIT 100
      `, [hours]),
    ]);

    res.json({
      ok: true,
      hours,
      indicators: { count: indicators.rows.length, items: indicators.rows },
      ioc_events: { count: iocEvents.rows.length, items: iocEvents.rows },
      ioc_hits:   { count: iocHits.rows.length, items: iocHits.rows },
    });
  }));

  return r;
}
