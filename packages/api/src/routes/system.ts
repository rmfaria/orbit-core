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

// ── Stale thresholds per worker ───────────────────────────────────────────────

const STALE_MS: Record<WorkerName, number> = {
  rollup:     12 * 60 * 1000,  // 12 m (interval is 5 m)
  correlate:  12 * 60 * 1000,  // 12 m (interval is 5 m)
  alerts:      3 * 60 * 1000,  //  3 m (interval is 1 m)
  connectors:  2 * 60 * 1000,  //  2 m (interval is 30 s)
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

    // ── DB pool ───────────────────────────────────────────────────────────────
    const db = pool
      ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, connected: pool.totalCount > 0 }
      : { total: 0, idle: 0, waiting: 0, connected: false };

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
      db,
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
