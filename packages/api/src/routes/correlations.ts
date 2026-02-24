import type { Request, Response } from 'express';
import { pool } from '../db.js';

export async function correlationsHandler(req: Request, res: Response): Promise<void> {
  if (!pool) {
    (res as Response).status(500).json({ ok: false, error: 'DATABASE_URL not configured' });
    return;
  }

  const limit = Math.min(Number(req.query.limit ?? 200), 1000);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (req.query.asset_id) {
    params.push(req.query.asset_id);
    conditions.push(`asset_id = $${params.length}`);
  }
  if (req.query.from) {
    params.push(req.query.from);
    conditions.push(`event_ts >= $${params.length}::timestamptz`);
  }
  if (req.query.to) {
    params.push(req.query.to);
    conditions.push(`event_ts <= $${params.length}::timestamptz`);
  }
  if (req.query.min_z) {
    params.push(Number(req.query.min_z));
    conditions.push(`z_score >= $${params.length}`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(limit);

  const sql = `
    SELECT
      event_key, event_ts, asset_id, metric_ns, metric,
      baseline_avg, baseline_std, peak_value, z_score, rel_change, detected_at
    FROM orbit_correlations
    ${where}
    ORDER BY detected_at DESC
    LIMIT $${params.length}
  `;

  const result = await pool.query(sql, params);
  res.json({ ok: true, correlations: result.rows });
}
