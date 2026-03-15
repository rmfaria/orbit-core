/**
 * orbit-core — Canvas chart utilities
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Row, MultiRow } from './shared';

// ─── canvas chart ─────────────────────────────────────────────────────────────

export interface CanvasCtx {
  ctx: CanvasRenderingContext2D;
  w: number; h: number;
  padL: number; padR: number; padT: number; padB: number;
  x0: number; x1: number; y0: number; y1: number;
}

export function setupCanvas(canvas: HTMLCanvasElement): CanvasCtx | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, canvas.clientWidth || canvas.offsetWidth || 900);
  const h = Math.max(1, canvas.clientHeight || canvas.offsetHeight || 280);
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, w, h);
  const padL = 56, padR = 16, padT = 16, padB = 32;
  return { ctx, w, h, padL, padR, padT, padB, x0: padL, x1: w - padR, y0: padT, y1: h - padB };
}

export function drawGrid(cc: CanvasCtx) {
  const { ctx, w, h, padL, padR, padT, padB } = cc;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + ((h - padT - padB) * i) / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  }
}

export function drawAxisLabels(cc: CanvasCtx, vmin: number, vmax: number, timestamps: string[]) {
  const { ctx, h, x0, x1, y0, y1 } = cc;
  const fmtV = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(2);
  const fmt = (ts: string) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '11px system-ui';
  ctx.fillText(fmtV(vmax), 4, y0 + 12);
  ctx.fillText(fmtV((vmin + vmax) / 2), 4, (y0 + y1) / 2 + 4);
  ctx.fillText(fmtV(vmin), 4, y1);
  ctx.fillText(fmt(timestamps[0]), x0, h - 10);
  if (timestamps.length > 2) ctx.fillText(fmt(timestamps[Math.floor(timestamps.length / 2)]), (x0 + x1) / 2 - 16, h - 10);
  ctx.fillText(fmt(timestamps[timestamps.length - 1]), x1 - 36, h - 10);
}

export function drawChart(canvas: HTMLCanvasElement, rows: Row[]) {
  const cc = setupCanvas(canvas);
  if (!cc) return;
  const { ctx, x0, x1, y0, y1 } = cc;
  drawGrid(cc);

  if (!rows.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '14px system-ui';
    ctx.fillText('No data', cc.padL + 8, cc.padT + 28);
    return;
  }

  const vals = rows.map((r) => r.value);
  let vmin = Math.min(...vals), vmax = Math.max(...vals);
  if (vmin === vmax) { vmin -= 1; vmax += 1; }

  const toX = (i: number) => x0 + ((x1 - x0) * i) / Math.max(1, rows.length - 1);
  const toY = (v: number) => y1 - ((y1 - y0) * (v - vmin)) / (vmax - vmin);

  // Fill area under curve
  ctx.beginPath();
  rows.forEach((r, i) => {
    const x = toX(i), y = toY(r.value);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(toX(rows.length - 1), y1);
  ctx.lineTo(x0, y1);
  ctx.closePath();
  ctx.fillStyle = 'rgba(99,179,237,0.10)';
  ctx.fill();

  // Line
  ctx.beginPath();
  rows.forEach((r, i) => {
    const x = toX(i), y = toY(r.value);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = 'rgba(99,179,237,0.95)';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawAxisLabels(cc, vmin, vmax, rows.map(r => r.ts));
}

export function drawMultiChart(canvas: HTMLCanvasElement, rows: MultiRow[]) {
  const cc = setupCanvas(canvas);
  if (!cc) return;
  const { ctx, w, x0, x1, y0, y1, padR, padT } = cc;
  drawGrid(cc);

  if (!rows.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '14px system-ui';
    ctx.fillText('No data', cc.padL + 8, cc.padT + 28);
    return;
  }

  const bySeries = new Map<string, Array<{ ts: string; value: number }>>();
  for (const r of rows) {
    const arr = bySeries.get(r.series) ?? [];
    arr.push({ ts: r.ts, value: r.value });
    bySeries.set(r.series, arr);
  }
  for (const [k, arr] of bySeries) {
    arr.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    bySeries.set(k, arr);
  }

  const allVals: number[] = [];
  for (const arr of bySeries.values()) for (const p of arr) allVals.push(p.value);
  let vmin = Math.min(...allVals), vmax = Math.max(...allVals);
  if (vmin === vmax) { vmin -= 1; vmax += 1; }

  const tsSet = new Set<string>();
  for (const arr of bySeries.values()) for (const p of arr) tsSet.add(p.ts);
  const tsList = Array.from(tsSet).sort((a, b) => Date.parse(a) - Date.parse(b));

  const toX = (i: number) => x0 + ((x1 - x0) * i) / Math.max(1, tsList.length - 1);
  const toY = (v: number) => y1 - ((y1 - y0) * (v - vmin)) / (vmax - vmin);

  const palette = ['#55f3ff', '#9b7cff', '#60a5fa', '#fbbf24', '#a3e635', '#fb7185'];
  const keys = Array.from(bySeries.keys());

  keys.forEach((seriesKey, idx) => {
    const color = palette[idx % palette.length];
    const points = bySeries.get(seriesKey)!;
    const map = new Map(points.map(p => [p.ts, p.value] as const));
    ctx.beginPath();
    let started = false;
    tsList.forEach((ts, i) => {
      const v = map.get(ts);
      if (v === undefined || v === null) return;
      const x = toX(i), y = toY(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  drawAxisLabels(cc, vmin, vmax, tsList);

  // Legend (top-right)
  ctx.font = '11px system-ui';
  let lx = w - padR - 140;
  let ly = padT + 10;
  keys.slice(0, 6).forEach((seriesKey, idx) => {
    const color = palette[idx % palette.length];
    ctx.fillStyle = color;
    ctx.fillRect(lx, ly - 8, 10, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const label = seriesKey.length > 18 ? seriesKey.slice(0, 18) + '…' : seriesKey;
    ctx.fillText(label, lx + 14, ly - 4);
    ly += 14;
  });
}
