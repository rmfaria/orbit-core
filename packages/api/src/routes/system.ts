/**
 * orbit-core — GET /api/v1/system
 *
 * Returns live infrastructure metrics for the orbit-core process and host:
 * environment type, CPU load, memory, network I/O, DB pool, worker states.
 *
 * All values are read at request time — no caching.
 * Network rx/tx deltas are calculated from the previous call's snapshot.
 */

import type { Request, Response } from 'express';
import os from 'os';
import fs from 'fs';
import { statfs } from 'fs/promises';
import type { Pool } from 'pg';
import { getWorkerRegistry, type WorkerName } from '../worker-registry.js';

// ── Environment detection ──────────────────────────────────────────────────────

function detectEnvironment(): 'container' | 'vps' {
  try {
    if (fs.existsSync('/.dockerenv')) return 'container';
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    if (/docker|containerd|kubepods|lxc|podman/i.test(cgroup)) return 'container';
  } catch { /* non-Linux or permission denied → assume VPS */ }
  return 'vps';
}

// ── Network I/O (/proc/net/dev) ───────────────────────────────────────────────

interface NetSnapshot { rx_bytes: number; tx_bytes: number }

function readNetDev(): Record<string, NetSnapshot> {
  const result: Record<string, NetSnapshot> = {};
  try {
    const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const name = parts[0].replace(':', '');
      if (name === 'lo') continue;
      result[name] = { rx_bytes: Number(parts[1]), tx_bytes: Number(parts[9]) };
    }
  } catch { /* /proc not available on macOS/Windows — return empty */ }
  return result;
}

// Module-level snapshot for delta calculation
let prevNet: Record<string, NetSnapshot> = {};
let prevNetTs = 0;

// ── PostgreSQL I/O snapshot ───────────────────────────────────────────────────
interface PgSnapshot { tup_fetched: number; tup_inserted: number; tup_updated: number; tup_deleted: number; blks_read: number; blks_hit: number; ts: number }
let prevPg: PgSnapshot | null = null;

// ── Stale thresholds per worker ───────────────────────────────────────────────

const STALE_MS: Record<WorkerName, number> = {
  rollup:         12 * 60 * 1000,  // 12 m (interval is 5 m)
  correlate:      12 * 60 * 1000,  // 12 m (interval is 5 m)
  alerts:          3 * 60 * 1000,  //  3 m (interval is 1 m)
  connectors:      2 * 60 * 1000,  //  2 m (interval is 30 s)
  'threat-intel':  5 * 60 * 1000,  //  5 m (interval is 2 m)
};

// ── Handler factory ───────────────────────────────────────────────────────────

export function systemHandler(pool: Pool | null) {
  return async (_req: Request, res: Response): Promise<void> => {
    const now = Date.now();

    // ── CPU ──────────────────────────────────────────────────────────────────
    const cpus = os.cpus();
    const load = os.loadavg() as [number, number, number];

    // ── Memory ───────────────────────────────────────────────────────────────
    const totalMem = os.totalmem();
    const freeMem  = os.freemem();
    const mem      = process.memoryUsage();

    // ── Network ──────────────────────────────────────────────────────────────
    const curNet = readNetDev();
    const elapsed = prevNetTs ? (now - prevNetTs) / 1000 : 0;

    const network = Object.entries(curNet).map(([name, cur]) => {
      const prev = prevNet[name];
      return {
        name,
        rx_bytes:   cur.rx_bytes,
        tx_bytes:   cur.tx_bytes,
        rx_per_sec: elapsed > 0 && prev ? Math.max(0, (cur.rx_bytes - prev.rx_bytes) / elapsed) : 0,
        tx_per_sec: elapsed > 0 && prev ? Math.max(0, (cur.tx_bytes - prev.tx_bytes) / elapsed) : 0,
      };
    });

    prevNet   = curNet;
    prevNetTs = now;

    // ── Disk (root mount) ─────────────────────────────────────────────────────
    let disk = { total_gb: 0, used_gb: 0, free_gb: 0, percent: 0 };
    try {
      const st = await statfs('/');
      const totalBytes = st.blocks * st.bsize;
      const freeBytes  = st.bavail * st.bsize;
      const usedBytes  = totalBytes - freeBytes;
      disk = {
        total_gb: Math.round(totalBytes / 1073741824 * 10) / 10,
        used_gb:  Math.round(usedBytes  / 1073741824 * 10) / 10,
        free_gb:  Math.round(freeBytes  / 1073741824 * 10) / 10,
        percent:  Math.round((usedBytes / totalBytes) * 100),
      };
    } catch { /* statfs not available */ }

    // ── DB pool + PostgreSQL stats ────────────────────────────────────────────
    const db = pool
      ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, connected: pool.totalCount > 0 }
      : { total: 0, idle: 0, waiting: 0, connected: false };

    let pg_stats: {
      db_size_mb: number; cache_hit_pct: number; active_connections: number;
      tup_fetched_ps: number; tup_written_ps: number;
    } | null = null;

    if (pool) {
      try {
        const [r1, r2, r3] = await Promise.all([
          pool.query<{ db_size_mb: number; tup_fetched: string; tup_inserted: string; tup_updated: string; tup_deleted: string; blks_read: string; blks_hit: string }>(`
            SELECT
              pg_database_size(current_database()) / 1048576 AS db_size_mb,
              tup_fetched, tup_inserted, tup_updated, tup_deleted,
              blks_read, blks_hit
            FROM pg_stat_database WHERE datname = current_database()`),
          pool.query<{ count: string }>(`SELECT count(*) FROM pg_stat_activity WHERE state = 'active'`),
          pool.query<{ buffers_hit: string; buffers_miss: string }>(`
            SELECT buffers_backend AS buffers_miss,
                   buffers_checkpoint + buffers_clean AS buffers_hit
            FROM pg_stat_bgwriter`),
        ]);

        const row = r1.rows[0];
        if (row) {
          const tup_f = Number(row.tup_fetched);
          const tup_i = Number(row.tup_inserted);
          const tup_u = Number(row.tup_updated);
          const tup_d = Number(row.tup_deleted);
          const b_read = Number(row.blks_read);
          const b_hit  = Number(row.blks_hit);
          const b_total = b_read + b_hit;

          let tup_fetched_ps = 0, tup_written_ps = 0;
          if (prevPg) {
            const dt = (now - prevPg.ts) / 1000;
            if (dt > 0) {
              tup_fetched_ps = Math.max(0, Math.round((tup_f - prevPg.tup_fetched) / dt));
              tup_written_ps = Math.max(0, Math.round(((tup_i + tup_u + tup_d) - (prevPg.tup_inserted + prevPg.tup_updated + prevPg.tup_deleted)) / dt));
            }
          }
          prevPg = { tup_fetched: tup_f, tup_inserted: tup_i, tup_updated: tup_u, tup_deleted: tup_d, blks_read: b_read, blks_hit: b_hit, ts: now };

          pg_stats = {
            db_size_mb:         Number(row.db_size_mb),
            cache_hit_pct:      b_total > 0 ? Math.round((b_hit / b_total) * 1000) / 10 : 100,
            active_connections: Number(r2.rows[0]?.count ?? 0),
            tup_fetched_ps,
            tup_written_ps,
          };
        }
      } catch { /* pg_stat_* not accessible */ }
    }

    // ── Workers ───────────────────────────────────────────────────────────────
    const reg = getWorkerRegistry();
    const workers = Object.fromEntries(
      (Object.keys(reg) as WorkerName[]).map(name => {
        const w = reg[name];
        const alive = w.last_beat > 0 && (now - w.last_beat) < STALE_MS[name];
        return [name, {
          alive,
          last_beat: w.last_beat ? new Date(w.last_beat).toISOString() : null,
          beats:  w.beats,
          errors: w.errors,
        }];
      })
    );

    res.json({
      ok: true,
      environment: detectEnvironment(),
      cpu: {
        count: cpus.length,
        model: cpus[0]?.model?.replace(/\s+/g, ' ').trim() ?? 'unknown',
        load,
      },
      memory: {
        total_mb:              Math.round(totalMem / 1048576),
        free_mb:               Math.round(freeMem  / 1048576),
        used_mb:               Math.round((totalMem - freeMem) / 1048576),
        percent:               Math.round((1 - freeMem / totalMem) * 100),
        process_rss_mb:        Math.round(mem.rss      / 1048576),
        process_heap_used_mb:  Math.round(mem.heapUsed / 1048576),
        process_heap_total_mb: Math.round(mem.heapTotal / 1048576),
      },
      network,
      disk,
      db,
      pg_stats,
      workers,
      process: {
        pid:          process.pid,
        uptime_sec:   Math.round(process.uptime()),
        node_version: process.version,
        started_at:   new Date(now - process.uptime() * 1000).toISOString(),
      },
    });
  };
}
