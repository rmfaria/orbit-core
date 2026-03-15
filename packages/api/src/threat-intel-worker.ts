/**
 * orbit-core — Threat intelligence correlation worker
 *
 * Runs every 2 minutes. Scans recent orbit_events for values that match
 * active threat indicators (IoCs). When a match is found:
 *   1. Records the match in threat_matches table
 *   2. Generates a high-severity orbit_event (kind: ioc.hit) for visibility
 *
 * Extraction strategy:
 *   - Pulls IP addresses, domains, hashes, and URLs from event attributes JSONB
 *   - Batch-checks extracted values against threat_indicators.value
 *   - Uses exact match for performance (indexed column)
 */

import type { Pool } from 'pg';
import pino from 'pino';
import { heartbeat, workerError } from './worker-registry.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'threat-intel' });

const INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

// How far back to scan events (minutes). Overlaps with previous run to catch late arrivals.
const LOOKBACK_MIN = 10;

// Max events to process per run (safety valve for large backlogs).
const MAX_EVENTS_PER_RUN = 5000;

// Attribute keys that commonly contain matchable IoC values.
// Supports nested keys via dot notation (flattened later).
const IOC_FIELDS = [
  // IPs
  'src_ip', 'dst_ip', 'srcip', 'dstip', 'source_ip', 'dest_ip',
  'ip', 'agent_ip', 'remote_ip', 'local_ip',
  // Wazuh nested
  'data.srcip', 'data.dstip', 'data.src_ip', 'data.dst_ip',
  // Suricata
  'src_ip', 'dest_ip', 'http.hostname', 'dns.rrname', 'tls.sni',
  // Domains
  'domain', 'hostname', 'fqdn', 'server_name',
  // Hashes
  'md5', 'sha1', 'sha256', 'hash', 'file_hash',
  'data.md5', 'data.sha1', 'data.sha256',
  // URLs
  'url', 'uri', 'http.url', 'data.url',
];

// IP regex (basic IPv4)
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
// Private/internal IPs to skip
const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|169\.254\.|::1|fe80:)/;

/**
 * Extract candidate IoC values from an event's attributes JSONB.
 * Returns a Map of field_name → value for dedup.
 */
function extractIocValues(attributes: Record<string, any>): Map<string, string> {
  const values = new Map<string, string>();

  for (const fieldPath of IOC_FIELDS) {
    const val = getNestedValue(attributes, fieldPath);
    if (typeof val === 'string' && val.length >= 3 && val.length <= 500) {
      // Skip private IPs — they'd match too broadly
      if (IPV4_RE.test(val) && PRIVATE_IP_RE.test(val)) continue;
      values.set(fieldPath, val.toLowerCase().trim());
    }
  }

  return values;
}

/** Traverse nested object by dot-separated path. */
function getNestedValue(obj: Record<string, any>, path: string): unknown {
  const parts = path.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/** Main correlation run. */
async function runThreatIntelCorrelation(pool: Pool): Promise<number> {
  // 1. Check if we have any active indicators at all (skip work if empty)
  const { rows: [{ count: indicatorCount }] } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM threat_indicators
     WHERE enabled = true AND (expires_at IS NULL OR expires_at > now())`
  );

  if (parseInt(indicatorCount) === 0) {
    logger.debug('No active threat indicators — skipping');
    return 0;
  }

  // 2. Fetch recent events that haven't been matched yet
  const { rows: events } = await pool.query<{
    id: number;
    ts: Date;
    asset_id: string;
    namespace: string;
    kind: string;
    severity: string;
    title: string;
    attributes: Record<string, any>;
  }>(`
    SELECT e.id, e.ts, e.asset_id, e.namespace, e.kind, e.severity, e.title, e.attributes
    FROM orbit_events e
    WHERE e.ts >= now() - make_interval(mins => $1)
      AND e.namespace != 'misp'
      AND NOT EXISTS (
        SELECT 1 FROM threat_matches tm WHERE tm.event_id = e.id
      )
    ORDER BY e.ts DESC
    LIMIT $2
  `, [LOOKBACK_MIN, MAX_EVENTS_PER_RUN]);

  if (events.length === 0) {
    logger.debug('No unmatched events in lookback window');
    return 0;
  }

  // 3. Extract all candidate values from all events
  const allValues = new Set<string>();
  const eventCandidates: Array<{
    eventId: number;
    fields: Map<string, string>;
  }> = [];

  for (const ev of events) {
    if (!ev.attributes || typeof ev.attributes !== 'object') continue;
    const fields = extractIocValues(ev.attributes);
    if (fields.size > 0) {
      eventCandidates.push({ eventId: ev.id, fields });
      for (const val of fields.values()) allValues.add(val);
    }
  }

  if (allValues.size === 0) {
    logger.debug('No candidate IoC values extracted from %d events', events.length);
    return 0;
  }

  // 4. Batch lookup: which of these values are known IoCs?
  const valueArray = Array.from(allValues);
  const { rows: matchedIndicators } = await pool.query<{
    id: number;
    type: string;
    value: string;
    threat_level: string;
    tags: string[];
    event_info: string | null;
    source_id: string;
  }>(`
    SELECT id, type, lower(value) AS value, threat_level, tags, event_info, source_id
    FROM threat_indicators
    WHERE lower(value) = ANY($1::text[])
      AND enabled = true
      AND (expires_at IS NULL OR expires_at > now())
  `, [valueArray]);

  if (matchedIndicators.length === 0) {
    logger.debug('No IoC matches found (%d values checked against %s indicators)',
      valueArray.length, indicatorCount);
    return 0;
  }

  // Build lookup: value → indicator(s)
  const iocLookup = new Map<string, typeof matchedIndicators>();
  for (const ind of matchedIndicators) {
    const existing = iocLookup.get(ind.value) ?? [];
    existing.push(ind);
    iocLookup.set(ind.value, existing);
  }

  // 5. Record matches + generate alert events
  let matchCount = 0;
  const alertEvents: Array<Record<string, any>> = [];

  for (const { eventId, fields } of eventCandidates) {
    const ev = events.find(e => e.id === eventId)!;

    for (const [fieldName, fieldValue] of fields) {
      const indicators = iocLookup.get(fieldValue);
      if (!indicators) continue;

      for (const ind of indicators) {
        // Insert match (ignore if already exists)
        try {
          await pool.query(
            `INSERT INTO threat_matches (event_id, indicator_id, matched_field, matched_value, indicator_type, threat_level)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (event_id, indicator_id) DO NOTHING`,
            [eventId, ind.id, fieldName, fieldValue, ind.type, ind.threat_level],
          );
          matchCount++;
        } catch (err) {
          logger.warn({ err, eventId, indicatorId: ind.id }, 'Failed to insert threat match');
          continue;
        }

        // Generate alert event
        alertEvents.push({
          ts: new Date().toISOString(),
          asset_id: ev.asset_id,
          namespace: 'misp',
          kind: 'ioc.hit',
          severity: ind.threat_level === 'high' ? 'critical' : (ind.threat_level === 'medium' ? 'high' : 'medium'),
          title: `[IoC HIT] ${ind.type}: ${fieldValue} matched in ${ev.namespace}/${ev.kind}`,
          message: ind.event_info || `Indicator ${ind.source_id} matched field ${fieldName}`,
          fingerprint: `ioc:hit:${eventId}:${ind.id}`,
          attributes: {
            matched_field: fieldName,
            matched_value: fieldValue,
            indicator_type: ind.type,
            indicator_id: ind.id,
            indicator_source_id: ind.source_id,
            threat_level: ind.threat_level,
            tags: ind.tags,
            original_event_id: eventId,
            original_namespace: ev.namespace,
            original_kind: ev.kind,
            original_severity: ev.severity,
            original_title: ev.title,
          },
        });

        logger.info(
          { asset: ev.asset_id, field: fieldName, value: fieldValue,
            indicator_type: ind.type, threat_level: ind.threat_level },
          'threat-intel: IoC match detected'
        );
      }
    }
  }

  // 6. Batch insert alert events
  if (alertEvents.length > 0) {
    try {
      await pool.query(
        `INSERT INTO orbit_events (ts, asset_id, namespace, kind, severity, title, message, fingerprint, attributes)
         SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::jsonb[])
           AS t(ts, asset_id, namespace, kind, severity, title, message, fingerprint, attributes)
         ON CONFLICT (fingerprint, ts) WHERE fingerprint IS NOT NULL
         DO UPDATE SET severity = excluded.severity, title = excluded.title, attributes = excluded.attributes, ingested_at = now()`,
        [
          alertEvents.map(e => e.ts),
          alertEvents.map(e => e.asset_id),
          alertEvents.map(e => e.namespace),
          alertEvents.map(e => e.kind),
          alertEvents.map(e => e.severity),
          alertEvents.map(e => e.title),
          alertEvents.map(e => e.message),
          alertEvents.map(e => e.fingerprint),
          alertEvents.map(e => JSON.stringify(e.attributes)),
        ],
      );
    } catch (err) {
      logger.error({ err }, 'Failed to insert IoC hit alert events');
    }
  }

  return matchCount;
}

async function runSafe(pool: Pool): Promise<void> {
  const t0 = Date.now();
  try {
    const matches = await runThreatIntelCorrelation(pool);
    if (matches > 0) {
      logger.info({ matches, ms: Date.now() - t0 }, 'threat-intel: correlation run complete');
    }
    heartbeat('threat-intel');
  } catch (err) {
    logger.error({ err }, 'threat-intel: correlation run failed');
    workerError('threat-intel');
  }
}

export function startThreatIntelWorker(pool: Pool): () => void {
  // Offset 120s from startup so migrations and other workers stabilize first
  const tInit = setTimeout(() => runSafe(pool), 120_000);
  const tInterval = setInterval(() => runSafe(pool), INTERVAL_MS);

  logger.info(
    { interval_ms: INTERVAL_MS, lookback_min: LOOKBACK_MIN, max_events: MAX_EVENTS_PER_RUN },
    'threat-intel correlation worker started'
  );

  return () => {
    clearTimeout(tInit);
    clearInterval(tInterval);
  };
}
