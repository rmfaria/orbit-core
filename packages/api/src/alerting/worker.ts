import type { Pool } from 'pg';
import pino from 'pino';
import { evaluate } from './evaluate.js';
import { sendWebhook, sendTelegram, type NotifyPayload } from './notify.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'alerts' });

const INTERVAL_MS  = 60_000;
const INIT_DELAY   = 30_000;

async function dispatch(
  pool: Pool,
  rule: any,
  channels: any[],
  event: 'firing' | 'resolved',
  value: number | null
): Promise<void> {
  const payload: NotifyPayload = {
    event,
    rule_name: rule.name,
    asset_id:  rule.asset_id  ?? null,
    namespace: rule.namespace ?? null,
    metric:    rule.metric    ?? null,
    condition: rule.condition,
    value,
    severity:  rule.severity,
    fired_at:  new Date().toISOString(),
  };

  for (const ch of channels) {
    let ok = false;
    let error: string | null = null;
    try {
      if (ch.kind === 'webhook') {
        await sendWebhook(ch.config.url, ch.config.headers ?? {}, payload);
      } else if (ch.kind === 'telegram') {
        await sendTelegram(ch.config.bot_token, ch.config.chat_id, payload);
      }
      ok = true;
      logger.info({ rule: rule.name, channel: ch.id, event }, 'alert notification sent');
    } catch (e: any) {
      error = String(e?.message ?? e);
      logger.error({ err: e, rule: rule.name, channel: ch.id }, 'alert notification failed');
    }
    await pool.query(
      `INSERT INTO alert_notifications (rule_id, channel_id, event, payload, ok, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [rule.id, ch.id, event, JSON.stringify(payload), ok, error]
    );
  }
}

async function run(pool: Pool): Promise<void> {
  const { rows: rules } = await pool.query(
    `SELECT * FROM alert_rules
     WHERE enabled = true
       AND (silence_until IS NULL OR silence_until < now())
     ORDER BY id`
  );

  for (const rule of rules) {
    try {
      const { firing, value } = await evaluate(pool, rule);
      const wasOk = rule.state === 'ok';

      const event: 'firing' | 'resolved' | null =
        firing  && wasOk  ? 'firing'   :
        !firing && !wasOk ? 'resolved' : null;

      // Always update last_value for live display in UI
      if (event) {
        await pool.query(
          `UPDATE alert_rules
           SET state = $1, fired_at = $2, last_value = $3, updated_at = now()
           WHERE id = $4`,
          [firing ? 'firing' : 'ok', firing ? new Date().toISOString() : null, value, rule.id]
        );

        if (rule.channels?.length) {
          const { rows: channels } = await pool.query(
            `SELECT * FROM alert_channels WHERE id = ANY($1::text[])`,
            [rule.channels]
          );
          await dispatch(pool, rule, channels, event, value);
        }
      } else if (value !== null && value !== rule.last_value) {
        await pool.query(
          `UPDATE alert_rules SET last_value = $1 WHERE id = $2`,
          [value, rule.id]
        );
      }
    } catch (err) {
      logger.error({ err, rule_id: rule.id, rule_name: rule.name }, 'alert evaluation error');
    }
  }

  logger.debug({ rules: rules.length }, 'alert worker run complete');
}

async function runSafe(pool: Pool): Promise<void> {
  try { await run(pool); } catch (e) { logger.error({ err: e }, 'alert worker run failed'); }
}

export function startAlertWorker(pool: Pool): () => void {
  const tInit     = setTimeout(() => runSafe(pool), INIT_DELAY);
  const tInterval = setInterval(() => runSafe(pool), INTERVAL_MS);
  logger.info({ interval_ms: INTERVAL_MS, init_delay_ms: INIT_DELAY }, 'alert worker started');
  return () => { clearTimeout(tInit); clearInterval(tInterval); };
}
