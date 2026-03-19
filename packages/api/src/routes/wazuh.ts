/**
 * orbit-core — Wazuh dashboard API
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dedicated endpoints for the Wazuh dashboard. Returns pre-structured
 * data instead of relying on the generic query endpoint, which avoids
 * fragile JSON parsing in the frontend.
 *
 * GET /wazuh/summary?from=ISO&to=ISO
 *   Returns agents, SCA, MITRE, hardware, severity counts, and recent events
 *   in a single round-trip.
 */

import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'wazuh' });

// In-memory cache for wazuh/summary — keyed by rounded time-range span
const summaryCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60_000; // 5 minutes
let summaryInflight: Promise<unknown> | null = null;
let summaryInflightKey: string | null = null;

export function wazuhRouter(pool: Pool | null): Router {
  const r = Router();

  r.get('/wazuh/summary', async (req: Request, res: Response) => {
    if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });

    const from = (req.query.from as string) || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const to   = (req.query.to   as string) || new Date().toISOString();

    // Normalize cache key by rounding span to nearest hour
    const spanH = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 3_600_000);
    const cacheKey = `${spanH}h`;

    // Serve cached response if fresh
    const cached = summaryCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return res.json(cached.data);
    }

    // Coalesce concurrent requests
    if (summaryInflight && summaryInflightKey === cacheKey) {
      try {
        const data = await summaryInflight;
        return res.json(data);
      } catch (e: any) {
        return res.status(500).json({ ok: false, error: e.message ?? 'query failed' });
      }
    }

    const runQuery = async () => {
      // Run all queries in parallel for performance
      const [
        agentsRes,
        scaRes,
        hwRes,
        osRes,
        mitreRes,
        eventsRes,
        sevCountsRes,
        epsRes,
        vulnTopRes,
        vulnByAgentRes,
      ] = await Promise.all([
        // Agents — latest inventory snapshot per agent (deduplicated by fingerprint)
        pool.query(`
          SELECT DISTINCT ON (fingerprint)
            ts, asset_id, kind, severity, title, message, attributes
          FROM orbit_events
          WHERE namespace = 'wazuh' AND kind = 'agent.inventory'
            AND ts >= $1::timestamptz AND ts <= $2::timestamptz
          ORDER BY fingerprint, ts DESC
          LIMIT 500
        `, [from, to]),

        // SCA — latest per agent+policy
        pool.query(`
          SELECT DISTINCT ON (fingerprint)
            ts, asset_id, kind, severity, title, attributes
          FROM orbit_events
          WHERE namespace = 'wazuh' AND kind = 'sca.result'
            AND ts >= $1::timestamptz AND ts <= $2::timestamptz
          ORDER BY fingerprint, ts DESC
          LIMIT 500
        `, [from, to]),

        // Syscollector hardware
        pool.query(`
          SELECT DISTINCT ON (fingerprint)
            ts, asset_id, title, attributes
          FROM orbit_events
          WHERE namespace = 'wazuh' AND kind = 'syscollector.hardware'
            AND ts >= $1::timestamptz AND ts <= $2::timestamptz
          ORDER BY fingerprint, ts DESC
          LIMIT 500
        `, [from, to]),

        // Syscollector OS
        pool.query(`
          SELECT DISTINCT ON (fingerprint)
            ts, asset_id, title, attributes
          FROM orbit_events
          WHERE namespace = 'wazuh' AND kind = 'syscollector.os'
            AND ts >= $1::timestamptz AND ts <= $2::timestamptz
          ORDER BY fingerprint, ts DESC
          LIMIT 500
        `, [from, to]),

        // MITRE catalog (latest single entry)
        pool.query(`
          SELECT attributes
          FROM orbit_events
          WHERE namespace = 'wazuh' AND kind = 'mitre.catalog'
            AND ts >= $1::timestamptz AND ts <= $2::timestamptz
          ORDER BY ts DESC
          LIMIT 1
        `, [from, to]),

        // Recent security events (exclude inventory/catalog kinds)
        pool.query(`
          SELECT ts, asset_id, namespace, kind, severity, title, message
          FROM orbit_events
          WHERE namespace = 'wazuh'
            AND kind NOT IN ('agent.inventory', 'sca.result', 'mitre.catalog',
                             'syscollector.os', 'syscollector.hardware', 'vulnerability.summary')
            AND ts >= $1::timestamptz AND ts <= $2::timestamptz
          ORDER BY ts DESC
          LIMIT 100
        `, [from, to]),

        // Severity distribution
        pool.query(`
          SELECT severity, count(*)::int as count
          FROM orbit_events
          WHERE namespace = 'wazuh'
            AND ts >= $1::timestamptz AND ts <= $2::timestamptz
          GROUP BY severity
        `, [from, to]),

        // EPS data — broken down by category for stacked chart
        pool.query(`
          SELECT date_bin('60 seconds', ts, '1970-01-01'::timestamptz) as bucket,
                 CASE
                   WHEN kind = 'agent.inventory'         THEN 'agent'
                   WHEN kind = 'sca.result'              THEN 'sca'
                   WHEN kind LIKE 'syscollector.%'        THEN 'syscollector'
                   WHEN kind = 'vulnerability-detector'   THEN 'vulnerability'
                   WHEN kind = 'mitre.catalog'            THEN 'mitre'
                   WHEN kind LIKE 'fim%'                  THEN 'fim'
                   WHEN kind LIKE 'rootcheck%'            THEN 'rootcheck'
                   WHEN kind LIKE 'syscheck%'             THEN 'syscheck'
                   WHEN kind LIKE 'virustotal%'           THEN 'virustotal'
                   WHEN kind LIKE 'osquery%'              THEN 'osquery'
                   WHEN kind LIKE 'docker%'               THEN 'docker'
                   WHEN kind LIKE 'audit%'                THEN 'audit'
                   ELSE kind
                 END as category,
                 count(*)::float / 60 as eps
          FROM orbit_events
          WHERE namespace = 'wazuh'
            AND ts >= $1::timestamptz AND ts <= $2::timestamptz
          GROUP BY 1, 2
          ORDER BY 1 ASC
        `, [from, to]),

        // Vulnerabilities — top 50 most recent (critical/high first)
        // Use 30-day lookback regardless of dashboard time range (inventory data)
        pool.query(`
          SELECT ts, asset_id, severity, title, attributes
          FROM orbit_events
          WHERE namespace = 'wazuh' AND kind = 'vulnerability-detector'
            AND ts >= now() - interval '30 days'
          ORDER BY
            CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
            ts DESC
          LIMIT 50
        `),

        // Vulnerabilities — counts per agent + severity breakdown
        pool.query(`
          SELECT asset_id,
                 count(*)::int as total,
                 count(*) FILTER (WHERE severity = 'critical')::int as critical,
                 count(*) FILTER (WHERE severity = 'high')::int as high,
                 count(*) FILTER (WHERE severity = 'medium')::int as medium,
                 count(*) FILTER (WHERE severity = 'low')::int as low
          FROM orbit_events
          WHERE namespace = 'wazuh' AND kind = 'vulnerability-detector'
            AND ts >= now() - interval '30 days'
          GROUP BY asset_id
          ORDER BY count(*) DESC
        `),
      ]);

      // Build agents list
      const agents = agentsRes.rows.map(row => {
        const a = row.attributes ?? {};
        return {
          id:            a.agent_id ?? '',
          name:          a.agent_name ?? row.asset_id?.replace('host:', '') ?? '',
          ip:            a.agent_ip ?? '',
          status:        a.agent_status ?? (row.severity === 'info' ? 'active' : 'disconnected'),
          os_name:       a.os_name ?? '',
          os_version:    a.os_version ?? '',
          os_platform:   a.os_platform ?? '',
          wazuh_version: a.wazuh_version ?? '',
          groups:        a.groups ?? [],
          node_name:     a.node_name ?? '',
        };
      });

      // Build SCA list
      const sca = scaRes.rows.map(row => {
        const a = row.attributes ?? {};
        return {
          agent_id:    a.agent_id ?? row.asset_id?.replace('host:', '') ?? '',
          policy_id:   a.policy_id ?? '',
          policy_name: a.policy_name ?? '',
          score:       a.score ?? 0,
          passed:      a.passed ?? 0,
          failed:      a.failed ?? 0,
          invalid:     a.invalid ?? 0,
          total:       a.total_checks ?? 0,
        };
      });

      // Build hardware map (merge HW + OS by agent)
      const hwMap = new Map<string, Record<string, unknown>>();
      for (const row of hwRes.rows) {
        const a = row.attributes ?? {};
        const aid = a.agent_id ?? row.asset_id?.replace('host:', '') ?? '';
        hwMap.set(aid, {
          ...(hwMap.get(aid) ?? {}),
          agent_id: aid,
          cpu_name: a.cpu_name,
          cpu_cores: a.cpu_cores,
          ram_total_kb: a.ram_total_kb,
          ram_mb: a.ram_total_kb ? Math.round(a.ram_total_kb / 1024) : 0,
          hostname: a.hostname,
        });
      }
      for (const row of osRes.rows) {
        const a = row.attributes ?? {};
        const aid = a.agent_id ?? row.asset_id?.replace('host:', '') ?? '';
        const existing = hwMap.get(aid) ?? { agent_id: aid };
        hwMap.set(aid, {
          ...existing,
          os_name: a.os_name,
          os_version: a.os_version,
          os_platform: a.os_platform,
          os: `${a.os_name ?? ''} ${a.os_version ?? ''}`.trim(),
          hostname: a.hostname ?? (existing as any).hostname,
        });
      }
      const hardware = Array.from(hwMap.values());

      // MITRE
      const mitreAttrs = mitreRes.rows[0]?.attributes ?? null;
      const mitre = mitreAttrs ? {
        techniques: mitreAttrs.techniques_count ?? 0,
        tactics:    mitreAttrs.tactics_count ?? 0,
        groups:     mitreAttrs.groups_count ?? 0,
        software:   mitreAttrs.software_count ?? 0,
      } : null;

      // Severity counts
      const severity_counts: Record<string, number> = {};
      for (const row of sevCountsRes.rows) {
        severity_counts[row.severity] = row.count;
      }

      // Vulnerabilities
      const vulnTop = vulnTopRes.rows.map(row => {
        const a = row.attributes?.data?.vulnerability ?? row.attributes ?? {};
        return {
          ts: row.ts,
          agent: row.asset_id?.replace('host:', '') ?? '',
          severity: row.severity,
          cve: a.cve ?? row.title?.split(' ')[0] ?? '',
          title: row.title,
          cvss: a.cvss?.cvss3?.base_score ?? null,
          package_name: a.package?.name ?? a.package_name ?? null,
          package_version: a.package?.version ?? a.package_version ?? null,
        };
      });
      const vulnByAgent = vulnByAgentRes.rows.map(row => ({
        agent: row.asset_id?.replace('host:', '') ?? '',
        total: row.total,
        critical: row.critical,
        high: row.high,
        medium: row.medium,
        low: row.low,
      }));

      // Build EPS breakdown: pivot (bucket, category, eps) rows → {buckets, categories}
      const epsBucketMap = new Map<string, Record<string, number>>();
      const epsCategorySet = new Set<string>();
      for (const row of epsRes.rows) {
        const ts = row.bucket;
        const cat = row.category;
        epsCategorySet.add(cat);
        let entry = epsBucketMap.get(ts);
        if (!entry) { entry = {}; epsBucketMap.set(ts, entry); }
        entry[cat] = (entry[cat] ?? 0) + row.eps;
      }
      const epsCategories = Array.from(epsCategorySet).sort();
      const epsBuckets = Array.from(epsBucketMap.entries())
        .sort(([a], [b]) => a < b ? -1 : 1)
        .map(([ts, cats]) => ({
          ts,
          total: Object.values(cats).reduce((s, v) => s + v, 0),
          ...cats,
        }));

      const body = {
        ok: true,
        agents,
        sca,
        hardware,
        mitre,
        severity_counts,
        events: eventsRes.rows,
        eps: { buckets: epsBuckets, categories: epsCategories },
        vulnerabilities: { top: vulnTop, by_agent: vulnByAgent },
      };
      summaryCache.set(cacheKey, { data: body, ts: Date.now() });
      return body;
    };

    summaryInflight = runQuery();
    summaryInflightKey = cacheKey;

    try {
      const data = await summaryInflight;
      res.json(data);
    } catch (err) {
      logger.error({ err }, 'wazuh/summary error');
      res.status(500).json({ ok: false, error: 'Internal error' });
    } finally {
      summaryInflight = null;
      summaryInflightKey = null;
    }
  });

  return r;
}
