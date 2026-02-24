import { Router } from 'express';
import type { Pool } from 'pg';
import { DashboardSpecSchema } from '@orbit/core-contracts';

const MAX_WIDGETS = 60;

export function dashboardsRouter(pool?: Pool | null): Router {
  const r = Router();

  // Validate a dashboard spec (no persistence)
  r.post('/dashboards/validate', (req, res) => {
    const parsed = DashboardSpecSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid DashboardSpec', details: parsed.error.issues },
      });
    }
    if (parsed.data.widgets.length > MAX_WIDGETS) {
      return res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: `Too many widgets (max ${MAX_WIDGETS})` },
      });
    }
    return res.json({ ok: true, spec: parsed.data });
  });

  // List dashboards (summary)
  r.get('/dashboards', async (req, res) => {
    if (!pool) return res.json({ ok: true, dashboards: [] });
    const result = await pool.query(
      `SELECT id,
              spec->>'name'        AS name,
              spec->>'description' AS description,
              spec->'time'         AS time,
              jsonb_array_length(spec->'widgets') AS widget_count,
              updated_at
       FROM dashboards
       ORDER BY updated_at DESC`
    );
    return res.json({ ok: true, dashboards: result.rows });
  });

  // Get one dashboard (full spec)
  r.get('/dashboards/:id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'No database' });
    const result = await pool.query(
      'SELECT spec, created_at, updated_at FROM dashboards WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({
      ok: true,
      spec: result.rows[0].spec,
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at,
    });
  });

  // Create dashboard
  r.post('/dashboards', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'No database' });
    const parsed = DashboardSpecSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid DashboardSpec', details: parsed.error.issues },
      });
    }
    const spec = parsed.data;
    if (spec.widgets.length > MAX_WIDGETS) {
      return res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: `Too many widgets (max ${MAX_WIDGETS})` },
      });
    }
    await pool.query(
      `INSERT INTO dashboards (id, spec)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET spec = $2, updated_at = now()`,
      [spec.id, JSON.stringify(spec)]
    );
    return res.status(201).json({ ok: true, id: spec.id });
  });

  // Update dashboard
  r.put('/dashboards/:id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'No database' });
    const parsed = DashboardSpecSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid DashboardSpec', details: parsed.error.issues },
      });
    }
    const spec = parsed.data;
    if (spec.id !== req.params.id) {
      return res.status(400).json({ ok: false, error: 'spec.id must match URL :id' });
    }
    const result = await pool.query(
      'UPDATE dashboards SET spec = $1, updated_at = now() WHERE id = $2 RETURNING id',
      [JSON.stringify(spec), req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, id: req.params.id });
  });

  // Delete dashboard
  r.delete('/dashboards/:id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'No database' });
    const result = await pool.query(
      'DELETE FROM dashboards WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true });
  });

  return r;
}
