/**
 * orbit-core — EPS (Events Per Second) tracker
 *
 * In-memory sliding-window ring buffer that tracks ingested item counts
 * per source_id. Provides EPS over 10s, 1m, and 5m windows with zero
 * database overhead.
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

const WINDOW_SIZE = 300; // 5 minutes in seconds
const TICK_MS = 1000;

interface EpsValues {
  eps_10s: number;
  eps_1m:  number;
  eps_5m:  number;
  total:   number; // total events since tracker start
}

class RingBuffer {
  private slots = new Float64Array(WINDOW_SIZE);
  private cursor = 0;
  total = 0;

  record(count: number): void {
    this.slots[this.cursor] += count;
    this.total += count;
  }

  advance(): void {
    this.cursor = (this.cursor + 1) % WINDOW_SIZE;
    this.slots[this.cursor] = 0;
  }

  private sum(seconds: number): number {
    let s = 0;
    for (let i = 0; i < seconds; i++) {
      const idx = (this.cursor - i + WINDOW_SIZE) % WINDOW_SIZE;
      s += this.slots[idx];
    }
    return s;
  }

  eps(): EpsValues {
    return {
      eps_10s: Math.round((this.sum(10) / 10) * 100) / 100,
      eps_1m:  Math.round((this.sum(60) / 60) * 100) / 100,
      eps_5m:  Math.round((this.sum(WINDOW_SIZE) / WINDOW_SIZE) * 100) / 100,
      total:   this.total,
    };
  }
}

// ── Singleton tracker ────────────────────────────────────────────────────────

const sources = new Map<string, RingBuffer>();
let globalBuf: RingBuffer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function getOrCreate(sourceId: string): RingBuffer {
  let buf = sources.get(sourceId);
  if (!buf) {
    buf = new RingBuffer();
    sources.set(sourceId, buf);
  }
  return buf;
}

function ensureStarted(): void {
  if (globalBuf) return;
  globalBuf = new RingBuffer();
  timer = setInterval(() => {
    globalBuf!.advance();
    for (const buf of sources.values()) buf.advance();
  }, TICK_MS);
  if (timer.unref) timer.unref(); // don't block process exit
}

/** Record ingested items for a source. Call from every ingest path. */
export function recordEvents(sourceId: string, count: number): void {
  if (count <= 0) return;
  ensureStarted();
  getOrCreate(sourceId).record(count);
  globalBuf!.record(count);
}

/** Get EPS snapshot for all sources + global. */
export function getEpsSnapshot(): {
  global: EpsValues;
  sources: Record<string, EpsValues>;
} {
  ensureStarted();
  const perSource: Record<string, EpsValues> = {};
  for (const [id, buf] of sources) {
    perSource[id] = buf.eps();
  }
  return {
    global:  globalBuf!.eps(),
    sources: perSource,
  };
}

/** Get EPS for a single source (or null if unknown). */
export function getSourceEps(sourceId: string): EpsValues | null {
  const buf = sources.get(sourceId);
  return buf ? buf.eps() : null;
}
