import { Router } from 'express';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';

export function smartDashboardsRouter(pool?: Pool | null): Router {
  const r = Router();

  // List smart dashboards (summary — no html field)
  r.get('/smart-dashboards', async (req, res) => {
    if (!pool) return res.json({ ok: true, dashboards: [] });
    const result = await pool.query(
      `SELECT id, name, description, prompt, metadata, created_at, updated_at
       FROM smart_dashboards
       ORDER BY updated_at DESC`
    );
    return res.json({ ok: true, dashboards: result.rows });
  });

  // Get one smart dashboard (full — includes html)
  r.get('/smart-dashboards/:id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'No database' });
    const result = await pool.query(
      'SELECT * FROM smart_dashboards WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, dashboard: result.rows[0] });
  });

  // Create smart dashboard
  r.post('/smart-dashboards', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'No database' });
    const { name, description, prompt, html, metadata } = req.body ?? {};
    if (!name || !prompt || !html) {
      return res.status(400).json({ ok: false, error: 'name, prompt, and html are required' });
    }
    const id = `sd-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await pool.query(
      `INSERT INTO smart_dashboards (id, name, description, prompt, html, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, name, description ?? null, prompt, html, JSON.stringify(metadata ?? {})]
    );
    return res.status(201).json({ ok: true, id });
  });

  // Update smart dashboard
  r.put('/smart-dashboards/:id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'No database' });
    const { name, description, prompt, html, metadata } = req.body ?? {};
    if (!name || !prompt || !html) {
      return res.status(400).json({ ok: false, error: 'name, prompt, and html are required' });
    }
    const result = await pool.query(
      `UPDATE smart_dashboards
       SET name = $1, description = $2, prompt = $3, html = $4, metadata = $5, updated_at = now()
       WHERE id = $6 RETURNING id`,
      [name, description ?? null, prompt, html, JSON.stringify(metadata ?? {}), req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, id: req.params.id });
  });

  // Delete smart dashboard
  r.delete('/smart-dashboards/:id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'No database' });
    const result = await pool.query(
      'DELETE FROM smart_dashboards WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true });
  });

  return r;
}
