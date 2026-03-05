import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { sendWebhook, sendTelegram, sendEmail, type NotifyPayload, type SmtpConfig } from '../alerting/notify.js';

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ChannelSchema = z.object({
  id:   z.string().min(1).regex(/^[a-z0-9-]+$/, 'id must be lowercase alphanumeric with dashes'),
  name: z.string().min(1),
  kind: z.enum(['webhook', 'telegram', 'email']),
  config: z.union([
    z.object({ url: z.string().url(), headers: z.record(z.string()).optional() }),
    z.object({ bot_token: z.string().min(1), chat_id: z.string().min(1) }),
    z.object({ recipients: z.array(z.string().email()).min(1) }),
  ]),
});

const SmtpSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().min(1),
});

const ConditionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind:       z.literal('threshold'),
    op:         z.enum(['>', '>=', '<', '<=']),
    value:      z.number(),
    window_min: z.number().int().min(1).max(1440),
    agg:        z.enum(['avg', 'max']).default('avg'),
  }),
  z.object({
    kind:       z.literal('absence'),
    window_min: z.number().int().min(1).max(1440),
  }),
]);

const RuleSchema = z.object({
  name:      z.string().min(1),
  enabled:   z.boolean().default(true),
  asset_id:  z.string().optional(),
  namespace: z.string().optional(),
  metric:    z.string().optional(),
  condition: ConditionSchema,
  severity:  z.enum(['info', 'low', 'medium', 'high', 'critical']).default('medium'),
  channels:  z.array(z.string()).default([]),
});

const PatchRuleSchema = z.object({
  enabled:       z.boolean().optional(),
  silence_until: z.string().datetime().nullable().optional(),
  channels:      z.array(z.string()).optional(),
  name:          z.string().min(1).optional(),
});

// ── Router ────────────────────────────────────────────────────────────────────

export function alertsRouter(pool?: Pool | null): Router {
  const r = Router();

  // ── Channels ──────────────────────────────────────────────────────────────

  r.get('/alerts/channels', async (_req, res) => {
    if (!pool) return res.json({ ok: true, channels: [] });
    const { rows } = await pool.query(
      `SELECT id, name, kind, created_at FROM alert_channels ORDER BY created_at DESC`
    );
    return res.json({ ok: true, channels: rows });
  });

  r.post('/alerts/channels', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const parsed = ChannelSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.errors });
    const ch = parsed.data;
    await pool.query(
      `INSERT INTO alert_channels (id, name, kind, config)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = $2, kind = $3, config = $4`,
      [ch.id, ch.name, ch.kind, JSON.stringify(ch.config)]
    );
    return res.status(201).json({ ok: true, id: ch.id });
  });

  r.delete('/alerts/channels/:id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const { rowCount } = await pool.query(
      `DELETE FROM alert_channels WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: 'channel not found' });
    return res.json({ ok: true });
  });

  r.post('/alerts/channels/:id/test', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const { rows } = await pool.query(
      `SELECT * FROM alert_channels WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'channel not found' });
    const ch = rows[0];
    const payload: NotifyPayload = {
      event:     'firing',
      rule_name: 'Teste de canal — orbit-core',
      asset_id:  'host:exemplo',
      namespace: 'nagios',
      metric:    'cpu',
      condition: { kind: 'threshold', op: '>', value: 80, window_min: 5, agg: 'avg' },
      value:     95.5,
      severity:  'high',
      fired_at:  new Date().toISOString(),
    };
    try {
      if (ch.kind === 'webhook') {
        await sendWebhook(ch.config.url, ch.config.headers ?? {}, payload);
      } else if (ch.kind === 'telegram') {
        await sendTelegram(ch.config.bot_token, ch.config.chat_id, payload);
      } else if (ch.kind === 'email') {
        const sr = await pool.query(`SELECT value FROM orbit_settings WHERE key = 'smtp_config'`);
        if (!sr.rows.length) return res.status(400).json({ ok: false, error: 'SMTP not configured — go to Alerts → SMTP settings' });
        const smtp: SmtpConfig = JSON.parse(sr.rows[0].value);
        await sendEmail(smtp, ch.config.recipients ?? [], payload);
      }
      return res.json({ ok: true, message: 'notification sent successfully' });
    } catch (e: any) {
      return res.status(502).json({ ok: false, error: String(e?.message ?? e) });
    }
  });

  // ── SMTP Settings ───────────────────────────────────────────────────────

  r.get('/alerts/smtp', async (_req, res) => {
    if (!pool) return res.json({ ok: true, smtp: null });
    const { rows } = await pool.query(`SELECT value FROM orbit_settings WHERE key = 'smtp_config'`);
    if (!rows.length) return res.json({ ok: true, smtp: null });
    const cfg = JSON.parse(rows[0].value);
    return res.json({ ok: true, smtp: { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, from: cfg.from } });
  });

  r.post('/alerts/smtp', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const parsed = SmtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.errors });
    await pool.query(
      `INSERT INTO orbit_settings (key, value) VALUES ('smtp_config', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify(parsed.data)]
    );
    return res.json({ ok: true });
  });

  r.post('/alerts/smtp/test', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const { rows } = await pool.query(`SELECT value FROM orbit_settings WHERE key = 'smtp_config'`);
    if (!rows.length) return res.status(400).json({ ok: false, error: 'SMTP not configured' });
    const smtp: SmtpConfig = JSON.parse(rows[0].value);
    const to = req.body.to as string;
    if (!to) return res.status(400).json({ ok: false, error: 'missing "to" field' });
    const payload: NotifyPayload = {
      event: 'firing', rule_name: 'SMTP Test — orbit-core',
      asset_id: 'host:test', namespace: 'nagios', metric: 'cpu',
      condition: { kind: 'threshold', op: '>', value: 80, window_min: 5, agg: 'avg' },
      value: 95.5, severity: 'high', fired_at: new Date().toISOString(),
    };
    try {
      await sendEmail(smtp, [to], payload);
      return res.json({ ok: true, message: `Test email sent to ${to}` });
    } catch (e: any) {
      return res.status(502).json({ ok: false, error: String(e?.message ?? e) });
    }
  });

  // ── Rules ─────────────────────────────────────────────────────────────────

  r.get('/alerts/rules', async (_req, res) => {
    if (!pool) return res.json({ ok: true, rules: [] });
    const { rows } = await pool.query(
      `SELECT id, name, enabled, asset_id, namespace, metric, condition,
              severity, channels, state, fired_at, last_value, silence_until,
              created_at, updated_at
       FROM alert_rules ORDER BY created_at DESC`
    );
    return res.json({ ok: true, rules: rows });
  });

  r.post('/alerts/rules', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const parsed = RuleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.errors });
    const d = parsed.data;
    const { rows } = await pool.query(
      `INSERT INTO alert_rules
         (name, enabled, asset_id, namespace, metric, condition, severity, channels)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [d.name, d.enabled, d.asset_id ?? null, d.namespace ?? null, d.metric ?? null,
       JSON.stringify(d.condition), d.severity, d.channels]
    );
    return res.status(201).json({ ok: true, id: rows[0].id });
  });

  r.patch('/alerts/rules/:id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const parsed = PatchRuleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.errors });
    const d = parsed.data;

    const sets: string[] = ['updated_at = now()'];
    const vals: any[]    = [];
    let i = 1;

    if (d.enabled       !== undefined) { sets.push(`enabled = $${i++}`);       vals.push(d.enabled); }
    if (d.silence_until !== undefined) { sets.push(`silence_until = $${i++}`); vals.push(d.silence_until); }
    if (d.channels      !== undefined) { sets.push(`channels = $${i++}`);      vals.push(d.channels); }
    if (d.name          !== undefined) { sets.push(`name = $${i++}`);          vals.push(d.name); }

    vals.push(req.params.id);
    const { rowCount } = await pool.query(
      `UPDATE alert_rules SET ${sets.join(', ')} WHERE id = $${i}`,
      vals
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: 'rule not found' });
    return res.json({ ok: true });
  });

  r.delete('/alerts/rules/:id', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'no database' });
    const { rowCount } = await pool.query(
      `DELETE FROM alert_rules WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: 'rule not found' });
    return res.json({ ok: true });
  });

  // ── History ───────────────────────────────────────────────────────────────

  r.get('/alerts/history', async (req, res) => {
    if (!pool) return res.json({ ok: true, notifications: [] });
    const ruleId = req.query['rule_id'];
    const { rows } = await pool.query(
      `SELECT n.id, n.rule_id, r.name AS rule_name, n.channel_id,
              n.event, n.ok, n.error, n.sent_at
       FROM alert_notifications n
       LEFT JOIN alert_rules r ON r.id = n.rule_id
       WHERE ($1::bigint IS NULL OR n.rule_id = $1)
       ORDER BY n.sent_at DESC
       LIMIT 100`,
      [ruleId ? Number(ruleId) : null]
    );
    return res.json({ ok: true, notifications: rows });
  });

  return r;
}
