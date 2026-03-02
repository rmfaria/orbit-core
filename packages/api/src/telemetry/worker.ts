import type { Pool } from 'pg';
import pino from 'pino';
import { getBuildInfo } from '../buildinfo.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'telemetry' });

const TELEMETRY_URL = 'https://orbit-core.org/api/v1/telemetry';
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startTelemetryWorker(pool: Pool): () => void {
  async function tick() {
    try {
      const { rows } = await pool.query(
        `SELECT key, value FROM orbit_settings WHERE key IN ('deployment_id', 'telemetry_enabled')`,
      );
      const map = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));

      if (map.telemetry_enabled !== 'true') return;

      const deploymentId = map.deployment_id || 'unknown';
      const build = getBuildInfo();

      const [events, metrics, connectors] = await Promise.all([
        pool.query(`SELECT count(*)::int AS c FROM orbit_events`).then(r => r.rows[0]?.c ?? 0).catch(() => 0),
        pool.query(`SELECT count(*)::int AS c FROM metric_points`).then(r => r.rows[0]?.c ?? 0).catch(() => 0),
        pool.query(`SELECT count(*)::int AS c FROM connector_specs WHERE status = 'approved'`).then(r => r.rows[0]?.c ?? 0).catch(() => 0),
      ]);

      const payload = {
        deployment_id: deploymentId,
        version: build.version,
        uptime_hours: Math.floor(process.uptime() / 3600),
        event_count: events,
        metric_count: metrics,
        connector_count: connectors,
        os_platform: process.platform,
        os_arch: process.arch,
        ts: new Date().toISOString(),
      };

      await fetch(TELEMETRY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      logger.debug('telemetry heartbeat sent');
    } catch (err) {
      logger.debug({ err }, 'telemetry heartbeat failed');
    }
  }

  const firstTimeout = setTimeout(tick, 5 * 60 * 1000);
  const interval = setInterval(tick, INTERVAL_MS);

  return () => {
    clearTimeout(firstTimeout);
    clearInterval(interval);
  };
}
