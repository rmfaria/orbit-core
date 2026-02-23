import fs from 'node:fs';
import pino from 'pino';
import type { MetricPoint, Event, Severity } from '@orbit/core-contracts';
import { loadConfig, type Config } from './config.js';
import { parsePerfline } from './parsePerfdata.js';
import { parseLogLine } from './parseLog.js';
import { readPosition, writePosition } from './state.js';
import { sendMetrics, sendEvents } from './send.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

function stateToSeverity(state: string): Severity {
  switch (state) {
    case 'CRITICAL':
    case 'DOWN': return 'critical';
    case 'WARNING': return 'medium';
    case 'UNKNOWN': return 'low';
    default: return 'info';
  }
}

/**
 * Read new bytes from a file since the last known position.
 * If the file shrank (rotation), reset to 0.
 */
function readNewLines(file: string, pos: number): { lines: string[]; newPos: number } {
  const stat = fs.statSync(file);

  // File was rotated — restart from beginning
  if (stat.size < pos) pos = 0;

  const available = stat.size - pos;
  if (available <= 0) return { lines: [], newPos: pos };

  // Read at most 10 MB per run to avoid memory spikes
  const readSize = Math.min(available, 10 * 1024 * 1024);
  const buf = Buffer.alloc(readSize);
  const fd = fs.openSync(file, 'r');
  const bytesRead = fs.readSync(fd, buf, 0, readSize, pos);
  fs.closeSync(fd);

  const text = buf.slice(0, bytesRead).toString('utf8');
  const lines = text.split('\n').filter(l => l.trim().length > 0);

  return { lines, newPos: pos + bytesRead };
}

async function flushMetrics(apiUrl: string, metrics: MetricPoint[]): Promise<void> {
  if (!metrics.length) return;
  await sendMetrics(apiUrl, metrics);
  logger.info({ count: metrics.length }, 'sent metrics batch');
}

async function flushEvents(apiUrl: string, events: Event[]): Promise<void> {
  if (!events.length) return;
  await sendEvents(apiUrl, events);
  logger.info({ count: events.length }, 'sent events batch');
}

async function processPerfdata(config: Config): Promise<void> {
  const file = config.NAGIOS_PERFDATA_FILE!;
  const pos = readPosition(config.SHIPPER_STATE_DIR, file);
  const { lines, newPos } = readNewLines(file, pos);

  if (!lines.length) {
    logger.debug({ file }, 'no new perfdata lines');
    return;
  }

  logger.info({ file, lines: lines.length }, 'processing perfdata');

  const metrics: MetricPoint[] = [];

  for (const line of lines) {
    const parsed = parsePerfline(line);
    if (!parsed || !parsed.metrics.length) continue;

    const servicePrefix = parsed.service ? `${parsed.service}.` : '';

    for (const m of parsed.metrics) {
      metrics.push({
        ts: parsed.ts.toISOString(),
        asset_id: parsed.hostname,
        namespace: config.NAGIOS_DEFAULT_NAMESPACE,
        metric: `${servicePrefix}${m.label}`,
        value: m.value,
        unit: m.unit || undefined,
        dimensions: parsed.service ? { service: parsed.service } : undefined,
      });
    }

    if (metrics.length >= config.SHIPPER_BATCH_SIZE) {
      await flushMetrics(config.ORBIT_API_URL, metrics.splice(0));
    }
  }

  await flushMetrics(config.ORBIT_API_URL, metrics);
  writePosition(config.SHIPPER_STATE_DIR, file, newPos);
}

async function processLog(config: Config): Promise<void> {
  const file = config.NAGIOS_LOG_FILE!;
  const pos = readPosition(config.SHIPPER_STATE_DIR, file);
  const { lines, newPos } = readNewLines(file, pos);

  if (!lines.length) {
    logger.debug({ file }, 'no new log lines');
    return;
  }

  logger.info({ file, lines: lines.length }, 'processing log');

  const events: Event[] = [];

  for (const line of lines) {
    const alert = parseLogLine(line);
    if (!alert) continue;

    // Only ship HARD state changes — SOFT are transient
    if (alert.stateType !== 'HARD') continue;

    const title = alert.type === 'SERVICE'
      ? `${alert.service}: ${alert.state}`
      : `${alert.hostname}: ${alert.state}`;

    events.push({
      ts: alert.ts.toISOString(),
      asset_id: alert.hostname,
      namespace: config.NAGIOS_DEFAULT_NAMESPACE,
      kind: alert.type === 'SERVICE' ? 'service_alert' : 'host_alert',
      severity: stateToSeverity(alert.state),
      title,
      message: alert.output || undefined,
      fingerprint: `${alert.hostname}:${alert.service ?? ''}:${alert.state}`,
      attributes: {
        state: alert.state,
        state_type: alert.stateType,
        attempt: alert.attempt,
        ...(alert.service ? { service: alert.service } : {}),
      },
    });

    if (events.length >= config.SHIPPER_BATCH_SIZE) {
      await flushEvents(config.ORBIT_API_URL, events.splice(0));
    }
  }

  await flushEvents(config.ORBIT_API_URL, events);
  writePosition(config.SHIPPER_STATE_DIR, file, newPos);
}

async function run(config: Config): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (config.NAGIOS_PERFDATA_FILE) {
    if (!fs.existsSync(config.NAGIOS_PERFDATA_FILE)) {
      logger.warn({ file: config.NAGIOS_PERFDATA_FILE }, 'perfdata file not found, skipping');
    } else {
      tasks.push(processPerfdata(config));
    }
  }

  if (config.NAGIOS_LOG_FILE) {
    if (!fs.existsSync(config.NAGIOS_LOG_FILE)) {
      logger.warn({ file: config.NAGIOS_LOG_FILE }, 'log file not found, skipping');
    } else {
      tasks.push(processLog(config));
    }
  }

  if (!tasks.length) {
    logger.warn('Nothing to process. Set NAGIOS_PERFDATA_FILE and/or NAGIOS_LOG_FILE.');
    return;
  }

  await Promise.all(tasks);
}

async function main() {
  const config = loadConfig();

  logger.info({
    api: config.ORBIT_API_URL,
    mode: config.SHIPPER_MODE,
    perfdata: config.NAGIOS_PERFDATA_FILE ?? '(not set)',
    log: config.NAGIOS_LOG_FILE ?? '(not set)',
  }, 'orbit-nagios-shipper starting');

  if (config.SHIPPER_MODE === 'watch') {
    logger.info({ interval_sec: config.SHIPPER_INTERVAL_SEC }, 'running in watch mode');
    await run(config);
    setInterval(async () => {
      try {
        await run(config);
      } catch (e) {
        logger.error(e, 'shipper run error');
      }
    }, config.SHIPPER_INTERVAL_SEC * 1000);
  } else {
    await run(config);
    logger.info('done');
  }
}

main().catch(e => {
  logger.error(e, 'fatal');
  process.exit(1);
});
