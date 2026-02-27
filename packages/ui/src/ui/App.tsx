/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Chart, registerables } from 'chart.js';
import './home.css';
import { t, setLocale, getLocale, Locale } from './i18n';

// Register Chart.js components once.
Chart.register(...registerables);


// ─── types ────────────────────────────────────────────────────────────────────

type Row        = { ts: string; value: number };
type MultiRow   = { ts: string; series: string; value: number };
type EventRow   = { ts: string; asset_id: string; namespace: string; kind: string; severity: string; title: string; message: string };
type AssetOpt   = { asset_id: string; name: string };
type MetricOpt  = { namespace: string; metric: string; last_ts?: string };
type Tab        = 'home' | 'system' | 'dashboards' | 'src-nagios' | 'src-wazuh' | 'src-fortigate' | 'src-n8n' | 'src-otel' | 'events' | 'metrics' | 'correlations' | 'alerts' | 'connectors' | 'admin';

type CorrelationRow = {
  event_key:    string;
  event_ts:     string;
  asset_id:     string;
  metric_ns:    string;
  metric:       string;
  baseline_avg: number | null;
  baseline_std: number | null;
  peak_value:   number | null;
  z_score:      number | null;
  rel_change:   number | null;
  detected_at:  string;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: '#f87171',
  high:     '#fb923c',
  medium:   '#fbbf24',
  low:      '#a3e635',
  info:     '#60a5fa',
};

const SEV_BG: Record<string, string> = {
  critical: '#450a0a',
  high:     '#431407',
  medium:   '#451a03',
  low:      '#1a2e05',
  info:     '#172554',
};

const NS_COLOR: Record<string, string> = {
  nagios:    '#38bdf8',
  wazuh:     '#a78bfa',
  fortigate: '#fb923c',
  n8n:       '#4ade80',
  otel:      '#f59e0b',
};
const NS_BG: Record<string, string> = {
  nagios:    '#0c1a3a',
  wazuh:     '#1e1040',
  fortigate: '#431407',
  n8n:       '#052e16',
  otel:      '#1c1408',
};

/** Maps a raw event to its display/filter source.
 *  Fortigate syslogs arrive with namespace='wazuh', kind='fortigate' —
 *  we surface them as a distinct 'fortigate' source. */
function eventSource(e: { namespace: string; kind: string }): string {
  if (e.namespace === 'wazuh' && e.kind === 'fortigate') return 'fortigate';
  return e.namespace;
}

const NAGIOS_STATE_COLOR: Record<string, string> = {
  OK:           '#4ade80',
  UP:           '#4ade80',
  WARNING:      '#fbbf24',
  CRITICAL:     '#f87171',
  DOWN:         '#f87171',
  UNKNOWN:      '#94a3b8',
  UNREACHABLE:  '#c084fc',
};

function fmtTs(ts: string) {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function relativeFrom(hours: number) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

// If built with VITE_ORBIT_API_KEY, seed localStorage on first load.
const _builtInKey = import.meta.env.VITE_ORBIT_API_KEY as string | undefined;
if (_builtInKey && !localStorage.getItem('orbit_api_key')) {
  localStorage.setItem('orbit_api_key', _builtInKey);
}

// Build fetch headers — reads API key from localStorage if present.
function apiHeaders(): HeadersInit {
  const key = localStorage.getItem('orbit_api_key') ?? '';
  const h: HeadersInit = { 'content-type': 'application/json' };
  if (key) (h as Record<string, string>)['x-api-key'] = key;
  return h;
}

// GET helper (no body, still needs key header via ?).
function apiGetHeaders(): HeadersInit {
  const key = localStorage.getItem('orbit_api_key') ?? '';
  if (!key) return {};
  return { 'x-api-key': key };
}

// Returns true when viewport width is below 768 px (phone).
function useIsMobile(): boolean {
  const [mobile, setMobile] = React.useState(() => window.innerWidth < 768);
  React.useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', fn, { passive: true });
    return () => window.removeEventListener('resize', fn);
  }, []);
  return mobile;
}

// ─── canvas chart ─────────────────────────────────────────────────────────────

interface CanvasCtx {
  ctx: CanvasRenderingContext2D;
  w: number; h: number;
  padL: number; padR: number; padT: number; padB: number;
  x0: number; x1: number; y0: number; y1: number;
}

function setupCanvas(canvas: HTMLCanvasElement): CanvasCtx | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(canvas.width / dpr));
  const h = Math.max(1, Math.floor(canvas.height / dpr));
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, w, h);
  const padL = 56, padR = 16, padT = 16, padB = 32;
  return { ctx, w, h, padL, padR, padT, padB, x0: padL, x1: w - padR, y0: padT, y1: h - padB };
}

function drawGrid(cc: CanvasCtx) {
  const { ctx, w, h, padL, padR, padT, padB } = cc;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + ((h - padT - padB) * i) / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  }
}

function drawAxisLabels(cc: CanvasCtx, vmin: number, vmax: number, timestamps: string[]) {
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

function drawChart(canvas: HTMLCanvasElement, rows: Row[]) {
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

function drawMultiChart(canvas: HTMLCanvasElement, rows: MultiRow[]) {
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


// ─── styles (inline, no deps) ─────────────────────────────────────────────────

const S = {
  root: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    minHeight: '100vh',
    color: '#e9eeff',
    display: 'flex',
    flexDirection: 'column' as const,
    background:
      'radial-gradient(1000px 640px at 18% 10%, rgba(85,243,255,0.10), transparent 55%),' +
      'radial-gradient(900px 560px at 82% 78%, rgba(155,124,255,0.11), transparent 58%),' +
      'linear-gradient(180deg, #040713, #0b1220)',
  } as React.CSSProperties,
  topbar: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
    background: 'rgba(4,7,19,0.92)',
    borderBottom: '1px solid rgba(140,160,255,0.14)',
    backdropFilter: 'blur(12px)',
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    padding: '0 20px',
    height: 50,
    flexShrink: 0,
  } as React.CSSProperties,
  card: {
    background: 'rgba(12,18,40,0.62)',
    border: '1px solid rgba(140,160,255,0.18)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    boxShadow: '0 18px 55px rgba(0,0,0,0.35)',
  } as React.CSSProperties,
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'rgba(233,238,255,0.70)' } as React.CSSProperties,
  select: {
    background: 'rgba(4,7,19,0.55)',
    border: '1px solid rgba(140,160,255,0.22)',
    borderRadius: 12,
    color: '#e9eeff',
    padding: '7px 10px',
    fontSize: 13,
    outline: 'none',
  } as React.CSSProperties,
  input: {
    background: 'rgba(4,7,19,0.55)',
    border: '1px solid rgba(140,160,255,0.22)',
    borderRadius: 12,
    color: '#e9eeff',
    padding: '7px 10px',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
  } as React.CSSProperties,
  btn: {
    background: 'linear-gradient(135deg, rgba(85,243,255,0.22), rgba(155,124,255,0.22))',
    color: '#e9eeff',
    border: '1px solid rgba(85,243,255,0.30)',
    borderRadius: 12,
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 800,
  } as React.CSSProperties,
  btnSm: {
    background: 'rgba(4,7,19,0.35)',
    color: '#e9eeff',
    border: '1px solid rgba(140,160,255,0.20)',
    borderRadius: 12,
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
  } as React.CSSProperties,
  grid4: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(4, 1fr)' } as React.CSSProperties,
  grid3: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, 1fr)' } as React.CSSProperties,
  grid2: { display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' } as React.CSSProperties,
  row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const } as React.CSSProperties,
  err: { color: '#fca5a5', fontSize: 13, marginTop: 6 } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 } as React.CSSProperties,
  th: {
    textAlign: 'left' as const,
    padding: '10px 10px',
    borderBottom: '1px solid rgba(140,160,255,0.18)',
    color: 'rgba(233,238,255,0.65)',
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  } as React.CSSProperties,
  td: { padding: '10px 10px', borderBottom: '1px solid rgba(140,160,255,0.10)' } as React.CSSProperties,
};

// ─── SYSTEM TAB ───────────────────────────────────────────────────────────────

interface SysData {
  ok: boolean;
  environment: 'container' | 'vps' | 'unknown';
  cpu:     { count: number; model: string; load: [number, number, number] };
  memory:  { total_mb: number; free_mb: number; used_mb: number; percent: number; process_rss_mb: number; process_heap_used_mb: number; process_heap_total_mb: number };
  network: Array<{ name: string; rx_bytes: number; tx_bytes: number; rx_per_sec: number; tx_per_sec: number }>;
  db:      { total: number; idle: number; waiting: number; connected: boolean };
  workers: Record<string, { alive: boolean; last_beat: string | null; beats: number; errors: number }>;
  process: { pid: number; uptime_sec: number; node_version: string; started_at: string };
}

function fmtBytes(b: number): string {
  if (b < 1024)       return `${b} B/s`;
  if (b < 1048576)    return `${(b / 1024).toFixed(1)} KB/s`;
  return `${(b / 1048576).toFixed(2)} MB/s`;
}
function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(s % 60)}s`;
}

function SysCard({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div style={{ background: 'rgba(8,12,28,0.65)', border: `1px solid ${accent ?? 'rgba(140,160,255,0.16)'}`, borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', color: accent ?? 'rgba(233,238,255,0.45)', textTransform: 'uppercase' }}>{title}</div>
      {children}
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, borderRadius: 999, transition: 'width 0.5s ease' }} />
    </div>
  );
}

function WorkerPill({ name, w }: { name: string; w: SysData['workers'][string] }) {
  const c = w.alive ? '#4ade80' : '#ff5dd6';
  const ago = w.last_beat ? Math.round((Date.now() - new Date(w.last_beat).getTime()) / 1000) : null;
  return (
    <div style={{ background: 'rgba(3,6,18,0.5)', border: `1px solid ${w.alive ? 'rgba(74,222,128,0.22)' : 'rgba(255,93,214,0.22)'}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0, boxShadow: `0 0 6px ${c}` }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: '#e9eeff' }}>{name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: c, fontWeight: 600 }}>{w.alive ? t('sys_alive') : t('sys_stale')}</span>
      </div>
      <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.5)', lineHeight: 1.6 }}>
        <div>beats: <span style={{ color: '#94a3b8' }}>{w.beats}</span></div>
        <div>errors: <span style={{ color: w.errors > 0 ? '#ff5dd6' : '#94a3b8' }}>{w.errors}</span></div>
        {ago !== null && <div>last: <span style={{ color: '#94a3b8' }}>{ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`}</span></div>}
      </div>
    </div>
  );
}

function SystemTab() {
  const [data, setData] = React.useState<SysData | null>(null);
  const [err,  setErr]  = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch('api/v1/system', { headers: apiGetHeaders() });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!cancelled) { setData(d); setErr(null); }
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (err)   return <div style={{ padding: 32, color: '#ff5dd6' }}>Error: {err}</div>;
  if (!data) return <div style={{ padding: 32, color: 'rgba(233,238,255,0.4)' }}>Carregando sistema…</div>;

  const { cpu, memory, network, db, workers, process: proc } = data;
  const loadColor = cpu.load[0] > cpu.count * 0.8 ? '#ff5dd6' : cpu.load[0] > cpu.count * 0.5 ? '#fbbf24' : '#4ade80';
  const memColor  = memory.percent > 85 ? '#ff5dd6' : memory.percent > 65 ? '#fbbf24' : '#55f3ff';

  return (
    <div style={{ padding: '20px 24px 40px', maxWidth: 1400 }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#e9eeff' }}>Infraestrutura</div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: data.environment === 'container' ? 'rgba(155,124,255,0.15)' : 'rgba(85,243,255,0.12)', border: `1px solid ${data.environment === 'container' ? 'rgba(155,124,255,0.4)' : 'rgba(85,243,255,0.35)'}`, color: data.environment === 'container' ? '#c4b5fd' : '#55f3ff', letterSpacing: '0.5px' }}>
          {data.environment.toUpperCase()}
        </span>
        <span style={{ fontSize: 11, color: 'rgba(233,238,255,0.35)', marginLeft: 'auto' }}>atualiza a cada 5s</span>
      </div>

      {/* Top row: CPU + Memory + Process */}
      <div className="orbit-grid-3" style={{ gap: 14, marginBottom: 14 }}>

        {/* CPU */}
        <SysCard title={t('sys_cpu')} accent="rgba(85,243,255,0.35)">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 28, fontWeight: 900, color: loadColor }}>{cpu.load[0].toFixed(2)}</span>
            <span style={{ fontSize: 11, color: 'rgba(233,238,255,0.45)' }}>load avg 1m</span>
          </div>
          <Bar pct={(cpu.load[0] / cpu.count) * 100} color={loadColor} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, fontSize: 11 }}>
            <div style={{ color: 'rgba(233,238,255,0.45)' }}>5m <span style={{ color: '#94a3b8' }}>{cpu.load[1].toFixed(2)}</span></div>
            <div style={{ color: 'rgba(233,238,255,0.45)' }}>15m <span style={{ color: '#94a3b8' }}>{cpu.load[2].toFixed(2)}</span></div>
            <div style={{ color: 'rgba(233,238,255,0.45)' }}>{cpu.count} vCPU</div>
          </div>
          <div style={{ fontSize: 10, color: 'rgba(233,238,255,0.3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cpu.model}</div>
        </SysCard>

        {/* Memory */}
        <SysCard title={t('sys_memory')} accent="rgba(155,124,255,0.35)">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 28, fontWeight: 900, color: memColor }}>{memory.percent}%</span>
            <span style={{ fontSize: 11, color: 'rgba(233,238,255,0.45)' }}>{memory.used_mb} / {memory.total_mb} MB</span>
          </div>
          <Bar pct={memory.percent} color={memColor} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11 }}>
            <div style={{ color: 'rgba(233,238,255,0.45)' }}>livre <span style={{ color: '#94a3b8' }}>{memory.free_mb} MB</span></div>
            <div style={{ color: 'rgba(233,238,255,0.45)' }}>RSS <span style={{ color: '#94a3b8' }}>{memory.process_rss_mb} MB</span></div>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.45)' }}>
            heap <span style={{ color: '#94a3b8' }}>{memory.process_heap_used_mb}</span> / <span style={{ color: '#94a3b8' }}>{memory.process_heap_total_mb} MB</span>
          </div>
        </SysCard>

        {/* Process */}
        <SysCard title={t('sys_process')} accent="rgba(74,222,128,0.30)">
          <div style={{ fontSize: 28, fontWeight: 900, color: '#4ade80' }}>{fmtUptime(proc.uptime_sec)}</div>
          <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.5)', lineHeight: 2 }}>
            <div>PID <span style={{ color: '#94a3b8' }}>{proc.pid}</span></div>
            <div>Node <span style={{ color: '#94a3b8' }}>{proc.node_version}</span></div>
            <div>{t('sys_started')} <span style={{ color: '#94a3b8' }}>{new Date(proc.started_at).toLocaleString('en')}</span></div>
          </div>
        </SysCard>
      </div>

      {/* Middle row: Network + DB pool */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>

        {/* Network */}
        <SysCard title={t('sys_network')} accent="rgba(251,191,36,0.30)">
          {network.length === 0 ? (
            <div style={{ fontSize: 12, color: 'rgba(233,238,255,0.35)' }}>/proc/net/dev not available in this environment</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {network.map(iface => (
                <div key={iface.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: '#e9eeff' }}>{iface.name}</span>
                    <span style={{ color: 'rgba(233,238,255,0.4)', fontSize: 10 }}>
                      ↓ {fmtBytes(iface.rx_per_sec)} &nbsp; ↑ {fmtBytes(iface.tx_per_sec)}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    <div>
                      <div style={{ fontSize: 10, color: '#4ade80', marginBottom: 2 }}>↓ RX {fmtBytes(iface.rx_per_sec)}</div>
                      <Bar pct={Math.min(100, (iface.rx_per_sec / 125000) * 100)} color="#4ade80" />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#55f3ff', marginBottom: 2 }}>↑ TX {fmtBytes(iface.tx_per_sec)}</div>
                      <Bar pct={Math.min(100, (iface.tx_per_sec / 125000) * 100)} color="#55f3ff" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SysCard>

        {/* DB pool */}
        <SysCard title="PostgreSQL Pool" accent={db.connected ? 'rgba(74,222,128,0.30)' : 'rgba(255,93,214,0.35)'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: db.connected ? '#4ade80' : '#ff5dd6', boxShadow: `0 0 8px ${db.connected ? '#4ade80' : '#ff5dd6'}` }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: db.connected ? '#4ade80' : '#ff5dd6' }}>{db.connected ? t('sys_connected') : t('sys_disconnected')}</span>
          </div>
          <Bar pct={db.total > 0 ? ((db.total - db.idle) / db.total) * 100 : 0} color="#4ade80" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 11, marginTop: 4 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#e9eeff' }}>{db.total}</div>
              <div style={{ color: 'rgba(233,238,255,0.45)' }}>total</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#4ade80' }}>{db.idle}</div>
              <div style={{ color: 'rgba(233,238,255,0.45)' }}>idle</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: db.waiting > 0 ? '#fbbf24' : '#e9eeff' }}>{db.waiting}</div>
              <div style={{ color: 'rgba(233,238,255,0.45)' }}>waiting</div>
            </div>
          </div>
        </SysCard>
      </div>

      {/* Workers */}
      <SysCard title={t('sys_workers')} accent="rgba(251,191,36,0.30)">
        <div className="orbit-grid-4" style={{ gap: 12 }}>
          {Object.entries(workers).map(([name, w]) => (
            <WorkerPill key={name} name={name} w={w} />
          ))}
        </div>
      </SysCard>
    </div>
  );
}

// ─── TOP BAR ──────────────────────────────────────────────────────────────────

function TopBar({ tab, setTab, onLocaleChange }: { tab: Tab; setTab: (t: Tab) => void; onLocaleChange: () => void }) {
  const isMobile = useIsMobile();
  const [fontesDdOpen,  setFontesDdOpen]  = React.useState(false);
  const [gearDdOpen,    setGearDdOpen]    = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [apiKey, setApiKey] = React.useState(() => localStorage.getItem('orbit_api_key') ?? '');
  const [locale, setLoc] = React.useState<Locale>(getLocale);

  function changeLocale(l: Locale) {
    setLocale(l);
    setLoc(l);
    onLocaleChange();
  }

  // Close dropdowns on outside click
  React.useEffect(() => {
    function handle(e: MouseEvent) {
      const tgt = e.target as HTMLElement;
      if (!tgt.closest('[data-dd="fontes"]')) setFontesDdOpen(false);
      if (!tgt.closest('[data-dd="gear"]'))   setGearDdOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Close mobile nav on resize to desktop
  React.useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile]);

  function navTabBtn(tid: Tab, label: string) {
    const active = tab === tid;
    return (
      <button
        key={tid}
        onClick={() => setTab(tid)}
        style={{
          background: active ? 'rgba(85,243,255,0.12)' : 'transparent',
          border: active ? '1px solid rgba(85,243,255,0.28)' : '1px solid transparent',
          borderRadius: 8,
          color: active ? '#55f3ff' : 'rgba(233,238,255,0.60)',
          padding: '5px 12px',
          margin: '0 2px',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: active ? 700 : 500,
          transition: 'all 0.15s',
          whiteSpace: 'nowrap' as const,
          height: 34,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {label}
      </button>
    );
  }

  // Drawer nav item (mobile)
  function navDrawerBtn(tid: Tab, label: string) {
    const active = tab === tid;
    return (
      <button
        key={tid}
        onClick={() => { setTab(tid); setMobileNavOpen(false); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          background: active ? 'rgba(85,243,255,0.08)' : 'transparent',
          border: 'none',
          borderLeft: active ? '3px solid #55f3ff' : '3px solid transparent',
          color: active ? '#55f3ff' : 'rgba(233,238,255,0.80)',
          padding: '14px 20px',
          cursor: 'pointer',
          fontSize: 15,
          fontWeight: active ? 700 : 400,
          textAlign: 'left' as const,
          transition: 'background 0.12s',
        }}
      >
        {label}
      </button>
    );
  }

  const isFontesActive = tab.startsWith('src-');

  function logoff() {
    localStorage.removeItem('orbit_api_key');
    setApiKey('');
    setTab('home');
  }

  const ddBase: React.CSSProperties = {
    position: 'absolute' as const,
    top: '100%',
    right: 0,
    marginTop: 4,
    background: 'rgba(8,12,28,0.97)',
    border: '1px solid rgba(140,160,255,0.20)',
    borderRadius: 12,
    boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
    backdropFilter: 'blur(12px)',
    minWidth: 160,
    zIndex: 100,
    overflow: 'hidden' as const,
  };

  const ddBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    background: 'transparent',
    border: 'none',
    color: 'rgba(233,238,255,0.80)',
    padding: '10px 16px',
    cursor: 'pointer',
    fontSize: 13,
    textAlign: 'left' as const,
  };

  const sourceLabels = ['Nagios', 'Wazuh', 'Fortigate', 'n8n', 'OTel'];
  const sourceColors = [NS_COLOR.nagios, NS_COLOR.wazuh, NS_COLOR.fortigate, NS_COLOR.n8n, NS_COLOR.otel];
  const sourceTabs: Tab[] = ['src-nagios', 'src-wazuh', 'src-fortigate', 'src-n8n', 'src-otel'];

  return (
    <>
      <div style={S.topbar}>
        {/* Logo */}
        <span style={{ fontSize: 15, fontWeight: 800, color: '#55f3ff', letterSpacing: '0.2px', marginRight: 8, whiteSpace: 'nowrap' }}>
          ◎ Orbit
        </span>

        {/* Divider */}
        <div style={{ width: 1, height: 22, background: 'rgba(140,160,255,0.18)', marginRight: 8 }} />

        {/* Nav tabs — desktop only */}
        {!isMobile && (
          <nav style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            {navTabBtn('home', t('nav_home'))}
            {navTabBtn('system', t('nav_system'))}

            {/* Sources dropdown */}
            <div data-dd="fontes" style={{ position: 'relative' }}>
              <button
                onClick={() => setFontesDdOpen(x => !x)}
                style={{
                  background: isFontesActive ? 'rgba(85,243,255,0.12)' : 'transparent',
                  border: isFontesActive ? '1px solid rgba(85,243,255,0.28)' : '1px solid transparent',
                  borderRadius: 8,
                  color: isFontesActive ? '#55f3ff' : 'rgba(233,238,255,0.60)',
                  padding: '5px 12px',
                  margin: '0 2px',
                  height: 34,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: isFontesActive ? 700 : 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap' as const,
                }}
              >
                {t('nav_sources')}
                <span style={{ fontSize: 10, opacity: 0.7 }}>{fontesDdOpen ? '▲' : '▼'}</span>
              </button>
              {fontesDdOpen && (
                <div style={ddBase}>
                  {sourceTabs.map((tid, i) => {
                    const active = tab === tid;
                    return (
                      <button
                        key={tid}
                        onClick={() => { setTab(tid); setFontesDdOpen(false); }}
                        style={{
                          ...ddBtn,
                          background: active ? 'rgba(85,243,255,0.07)' : 'transparent',
                          color: active ? '#e9eeff' : 'rgba(233,238,255,0.75)',
                          fontWeight: active ? 700 : 400,
                        }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: sourceColors[i], flexShrink: 0 }} />
                        {sourceLabels[i]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {navTabBtn('events',       t('nav_events'))}
            {navTabBtn('metrics',      t('nav_metrics'))}
            {navTabBtn('correlations', t('nav_correlations'))}
            {navTabBtn('alerts',       t('nav_alerts'))}
            {navTabBtn('connectors',   t('nav_connectors'))}
            {navTabBtn('dashboards',   t('nav_dashboards'))}
          </nav>
        )}

        {/* Mobile spacer */}
        {isMobile && <div style={{ flex: 1 }} />}

        {/* Right side — desktop */}
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 8 }}>

            {/* Language switcher */}
            <div style={{ display: 'flex', gap: 2 }}>
              {(['en', 'pt-BR', 'es'] as Locale[]).map(l => (
                <button
                  key={l}
                  onClick={() => changeLocale(l)}
                  style={{
                    background: locale === l ? 'rgba(85,243,255,0.15)' : 'transparent',
                    border: '1px solid ' + (locale === l ? 'rgba(85,243,255,0.40)' : 'rgba(140,160,255,0.18)'),
                    borderRadius: 6,
                    color: locale === l ? '#55f3ff' : 'rgba(233,238,255,0.50)',
                    padding: '3px 7px',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: locale === l ? 700 : 500,
                    letterSpacing: '0.03em',
                    transition: 'all 0.12s',
                    height: 26,
                  }}
                >
                  {l === 'en' ? 'EN' : l === 'pt-BR' ? 'PT' : 'ES'}
                </button>
              ))}
            </div>

            <HealthBadge />

            {/* User indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: apiKey ? '#4ade80' : '#fbbf24',
                display: 'inline-block',
              }} />
              <span style={{ color: apiKey ? '#4ade80' : '#fbbf24', fontWeight: 600 }}>
                {apiKey ? t('auth_admin') : t('auth_no_auth')}
              </span>
            </div>

            {/* Gear dropdown */}
            <div data-dd="gear" style={{ position: 'relative' }}>
              <button
                onClick={() => setGearDdOpen(x => !x)}
                title={t('auth_settings')}
                style={{
                  background: gearDdOpen ? 'rgba(85,243,255,0.10)' : 'transparent',
                  border: '1px solid ' + (gearDdOpen ? 'rgba(85,243,255,0.30)' : 'rgba(140,160,255,0.20)'),
                  borderRadius: 8,
                  color: 'rgba(233,238,255,0.70)',
                  cursor: 'pointer',
                  fontSize: 16,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
              >
                ⚙
              </button>
              {gearDdOpen && (
                <div style={ddBase}>
                  <button
                    onClick={() => { setTab('admin'); setGearDdOpen(false); }}
                    style={ddBtn}
                  >
                    ⚙ Administration
                  </button>
                </div>
              )}
            </div>

            {/* Logoff */}
            <button
              onClick={logoff}
              title="Logoff"
              style={{
                background: 'transparent',
                border: '1px solid rgba(140,160,255,0.20)',
                borderRadius: 8,
                color: 'rgba(233,238,255,0.55)',
                cursor: 'pointer',
                fontSize: 15,
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
              }}
            >
              ⏻
            </button>
          </div>
        )}

        {/* Hamburger button — mobile only */}
        {isMobile && (
          <button
            onClick={() => setMobileNavOpen(x => !x)}
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            style={{
              background: mobileNavOpen ? 'rgba(85,243,255,0.12)' : 'transparent',
              border: '1px solid ' + (mobileNavOpen ? 'rgba(85,243,255,0.30)' : 'rgba(140,160,255,0.20)'),
              borderRadius: 8,
              color: '#e9eeff',
              cursor: 'pointer',
              fontSize: 20,
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
              marginLeft: 8,
              flexShrink: 0,
            }}
          >
            {mobileNavOpen ? '✕' : '☰'}
          </button>
        )}
      </div>

      {/* Mobile navigation drawer */}
      {isMobile && mobileNavOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            top: 50,
            zIndex: 40,
            background: 'rgba(4,7,19,0.98)',
            backdropFilter: 'blur(16px)',
            borderTop: '1px solid rgba(140,160,255,0.14)',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch' as const,
          }}
          onClick={() => setMobileNavOpen(false)}
        >
          {/* Inner: stop propagation so clicks on items don't close via the outer div */}
          <div onClick={e => e.stopPropagation()}>

            {/* Status row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: '1px solid rgba(140,160,255,0.10)' }}>
              <HealthBadge />
              <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: apiKey ? '#4ade80' : '#fbbf24', display: 'inline-block' }} />
              <span style={{ color: apiKey ? '#4ade80' : '#fbbf24', fontWeight: 600, fontSize: 13 }}>
                {apiKey ? t('auth_admin') : t('auth_no_auth')}
              </span>
            </div>

            {/* Nav items */}
            <div>
              {navDrawerBtn('home',   t('nav_home'))}
              {navDrawerBtn('system', t('nav_system'))}

              {/* Sources section */}
              <div style={{ padding: '10px 20px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(233,238,255,0.35)', textTransform: 'uppercase' as const }}>
                {t('nav_sources')}
              </div>
              {sourceTabs.map((tid, i) => {
                const active = tab === tid;
                return (
                  <button
                    key={tid}
                    onClick={() => { setTab(tid); setMobileNavOpen(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      background: active ? 'rgba(85,243,255,0.08)' : 'transparent',
                      border: 'none',
                      borderLeft: active ? '3px solid #55f3ff' : '3px solid transparent',
                      color: active ? '#55f3ff' : 'rgba(233,238,255,0.75)',
                      padding: '13px 20px 13px 28px',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: active ? 700 : 400,
                      textAlign: 'left' as const,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: sourceColors[i], flexShrink: 0 }} />
                    {sourceLabels[i]}
                  </button>
                );
              })}

              {navDrawerBtn('events',       t('nav_events'))}
              {navDrawerBtn('metrics',      t('nav_metrics'))}
              {navDrawerBtn('correlations', t('nav_correlations'))}
              {navDrawerBtn('alerts',       t('nav_alerts'))}
              {navDrawerBtn('connectors',   t('nav_connectors'))}
              {navDrawerBtn('dashboards',   t('nav_dashboards'))}
            </div>

            {/* Language switcher — mobile */}
            <div style={{ padding: '10px 20px', display: 'flex', gap: 6 }}>
              {(['en', 'pt-BR', 'es'] as Locale[]).map(l => (
                <button
                  key={l}
                  onClick={() => { changeLocale(l); setMobileNavOpen(false); }}
                  style={{
                    background: locale === l ? 'rgba(85,243,255,0.15)' : 'transparent',
                    border: '1px solid ' + (locale === l ? 'rgba(85,243,255,0.40)' : 'rgba(140,160,255,0.20)'),
                    borderRadius: 8,
                    color: locale === l ? '#55f3ff' : 'rgba(233,238,255,0.55)',
                    padding: '8px 18px',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: locale === l ? 700 : 500,
                    flex: 1,
                  }}
                >
                  {l === 'en' ? 'EN' : l === 'pt-BR' ? 'PT' : 'ES'}
                </button>
              ))}
            </div>

            {/* Bottom actions */}
            <div style={{ borderTop: '1px solid rgba(140,160,255,0.10)', padding: '14px 20px', display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setTab('admin'); setMobileNavOpen(false); }}
                style={{ ...ddBtn, flex: 1, padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(140,160,255,0.20)', justifyContent: 'center', fontSize: 14 }}
              >
                ⚙ Admin
              </button>
              <button
                onClick={() => { logoff(); setMobileNavOpen(false); }}
                style={{ ...ddBtn, flex: 1, padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(255,93,93,0.25)', color: '#fca5a5', justifyContent: 'center', fontSize: 14 }}
              >
                ⏻ Logoff
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SevBadge({ sev }: { sev: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 99,
      fontSize: 11,
      fontWeight: 700,
      background: SEV_BG[sev] ?? '#1e293b',
      color: SEV_COLOR[sev] ?? '#e2e8f0',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    }}>
      {sev}
    </span>
  );
}

function NsBadge({ ns }: { ns: string }) {
  const color = NS_COLOR[ns] ?? 'rgba(233,238,255,.55)';
  const bg    = NS_BG[ns]    ?? 'rgba(30,40,80,.5)';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 7px',
      borderRadius: 99,
      fontSize: 10,
      fontWeight: 700,
      background: bg,
      color,
      border: `1px solid ${color}40`,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      alignSelf: 'flex-start',
      marginTop: 1,
      whiteSpace: 'nowrap',
    }}>{ns}</span>
  );
}

function FeedRow({ e }: { e: EventRow }) {
  const [open, setOpen] = React.useState(false);
  const src = eventSource(e);
  const expandable = (src === 'wazuh' || src === 'fortigate') && !!e.message;
  const devname = e.message?.match(/devname="([^"]+)"/)?.[1] ?? null;
  return (
    <div
      className="orbit-feed-row"
      onClick={() => expandable && setOpen(x => !x)}
      style={{ cursor: expandable ? 'pointer' : 'default' }}
    >
      <SevBadge sev={e.severity} />
      <NsBadge ns={src} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: 'block' }}>{e.title}</strong>
        {devname && !open && (
          <div style={{ fontSize: 12, color: 'rgba(160,180,255,.55)', marginTop: 3 }}>{devname}</div>
        )}
        {(!expandable || open) && e.message && (
          <div style={{
            fontSize: 12,
            color: 'rgba(233,238,255,.65)',
            marginTop: 4,
            lineHeight: 1.4,
            wordBreak: 'break-word',
            whiteSpace: expandable ? 'pre-wrap' : undefined,
          }}>{e.message}</div>
        )}
        <div style={{ fontSize: 11, color: 'rgba(233,238,255,.38)', marginTop: 5, display: 'flex', gap: 10 }}>
          <span>{fmtTs(e.ts)}</span>
          {expandable && (
            <span style={{ color: 'rgba(140,160,255,.5)' }}>{open ? t('events_close') : t('events_see_log')}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const color = NAGIOS_STATE_COLOR[state] ?? '#94a3b8';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 10px',
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 700,
      background: `${color}22`,
      color,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {state}
    </span>
  );
}

// ─── API Key Banner ───────────────────────────────────────────────────────────

function ApiKeyBanner() {
  const [key, setKey] = React.useState(() => localStorage.getItem('orbit_api_key') ?? '');
  const [saved, setSaved] = React.useState(false);

  function save() {
    localStorage.setItem('orbit_api_key', key);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'center', padding: '10px 16px' }}>
      <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>API Key</span>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder="ORBIT_API_KEY (deixe vazio se sem auth)"
        style={{ ...S.input, flex: 1, fontSize: 12 }}
      />
      <button onClick={save} style={{ ...S.btnSm }}>
        {saved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  );
}

// ─── Date range shortcuts ─────────────────────────────────────────────────────

function RangeShortcuts({ setFrom, setTo }: { setFrom: (s: string) => void; setTo: (s: string) => void }) {
  const opts = [
    { label: '1h',  h: 1   },
    { label: '6h',  h: 6   },
    { label: '24h', h: 24  },
    { label: '7d',  h: 168 },
  ];
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {opts.map(({ label, h }) => (
        <button key={label} style={S.btnSm} onClick={() => { setFrom(relativeFrom(h)); setTo(new Date().toISOString()); }}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── METRICS TAB ──────────────────────────────────────────────────────────────

function MetricsTab({ assets }: { assets: AssetOpt[] }) {
  const [assetId, setAssetId]       = React.useState(assets[0]?.asset_id ?? '');
  const [namespace, setNamespace]   = React.useState('');
  const [metric, setMetric]         = React.useState('');
  const [service, setService]       = React.useState('');
  const [metricOpts, setMetricOpts] = React.useState<MetricOpt[]>([]);
  const [serviceOpts, setServiceOpts] = React.useState<string[]>([]);
  const [bucketSec, setBucketSec]   = React.useState(60);
  const [from, setFrom]             = React.useState(() => relativeFrom(6));
  const [to, setTo]                 = React.useState(() => new Date().toISOString());
  const [rows, setRows]             = React.useState<Row[]>([]);
  const [loading, setLoading]       = React.useState(false);
  const [err, setErr]               = React.useState<string | null>(null);
  const canvasRef                   = React.useRef<HTMLCanvasElement | null>(null);

  // Auto-select first asset when assets load
  React.useEffect(() => {
    if (!assetId && assets.length) setAssetId(assets[0].asset_id);
  }, [assets]);

  // Load metrics when asset changes
  React.useEffect(() => {
    if (!assetId) return;
    fetch(`api/v1/catalog/metrics?asset_id=${encodeURIComponent(assetId)}&limit=500`, { headers: apiGetHeaders() })
      .then((r) => r.json())
      .then((j) => {
        const ms = (j?.metrics ?? []) as MetricOpt[];
        setMetricOpts(ms);
        if (ms.length) {
          setNamespace(ms[0].namespace);
          setMetric(ms[0].metric);
        }
      })
      .catch(() => setMetricOpts([]));
  }, [assetId]);

  // Load service dimension values when asset/namespace/metric change
  React.useEffect(() => {
    if (!assetId || !namespace || !metric) return;
    setService('');
    fetch(
      `api/v1/catalog/dimensions?asset_id=${encodeURIComponent(assetId)}&namespace=${encodeURIComponent(namespace)}&metric=${encodeURIComponent(metric)}&key=service&lookback_days=30`,
      { headers: apiGetHeaders() }
    )
      .then((r) => r.json())
      .then((j) => {
        const vals = (j?.values ?? []) as Array<{ value: string }>;
        setServiceOpts(vals.map((v) => v.value).filter(Boolean));
      })
      .catch(() => setServiceOpts([]));
  }, [assetId, namespace, metric]);

  // Resize canvas
  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    c.style.width = '100%';
    const cssW = c.offsetWidth || 900;
    const cssH = 280;
    c.style.height = `${cssH}px`;
    c.width = cssW * dpr;
    c.height = cssH * dpr;
    const ctx = c.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawChart(c, rows);
  }, [rows]);

  async function run() {
    if (!assetId || !namespace || !metric) { setErr(t('metrics_no_asset')); return; }
    setLoading(true); setErr(null);
    try {
      const body: any = {
        query: {
          kind: 'timeseries',
          asset_id: assetId,
          namespace,
          metric,
          from,
          to,
          bucket_sec: bucketSec,
          ...(service ? { dimensions: { service } } : {})
        }
      };
      const r = await fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setRows((j?.result?.rows ?? []).map((x: any) => ({ ts: x.ts, value: Number(x.value) })));
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  const namespaces = Array.from(new Set(metricOpts.map((m) => m.namespace)));
  const filteredMetrics = metricOpts.filter((m) => !namespace || m.namespace === namespace);

  return (
    <div>
      <div style={S.card}>
        <div className="orbit-grid-4" style={{ marginBottom: 10 }}>
          <label style={S.label}>
            Asset
            <select style={S.select} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              {assets.map((a) => (
                <option key={a.asset_id} value={a.asset_id}>{a.asset_id}</option>
              ))}
            </select>
          </label>
          <label style={S.label}>
            Namespace
            <select style={S.select} value={namespace} onChange={(e) => { setNamespace(e.target.value); setMetric(''); }}>
              {namespaces.map((ns) => <option key={ns} value={ns}>{ns}</option>)}
            </select>
          </label>
          <label style={S.label}>
            Metric
            <select style={S.select} value={metric} onChange={(e) => setMetric(e.target.value)}>
              {filteredMetrics.map((m) => (
                <option key={`${m.namespace}:${m.metric}`} value={m.metric}>{m.metric}</option>
              ))}
            </select>
          </label>
          <label style={S.label}>
            Service (Nagios)
            <select style={S.select} value={service} onChange={(e) => setService(e.target.value)}>
              <option value="">— Todos —</option>
              {serviceOpts.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <div className="orbit-grid-2" style={{ marginBottom: 10 }}>
          <label style={S.label}>
            From (ISO)
            <input style={S.input} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={S.label}>
            To (ISO)
            <input style={S.input} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div style={S.row}>
          <RangeShortcuts setFrom={setFrom} setTo={setTo} />
          <label style={{ ...S.label, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <span>Bucket (s)</span>
            <input style={{ ...S.input, width: 70 }} type="number" value={bucketSec} onChange={(e) => setBucketSec(Number(e.target.value))} />
          </label>
          <button style={S.btn} onClick={run} disabled={loading}>{loading ? 'Running…' : 'Run query'}</button>
          <span style={{ color: '#64748b', fontSize: 12 }}>{rows.length} pontos</span>
        </div>
        {err && <div style={S.err}>{err}</div>}
      </div>

      <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
      </div>

      {rows.length > 0 && (
        <details style={{ marginTop: 0 }}>
          <summary style={{ cursor: 'pointer', color: '#64748b', fontSize: 12, padding: '6px 0' }}>Raw rows ({rows.length})</summary>
          <pre style={{ background: '#0f172a', padding: 12, borderRadius: 8, fontSize: 11, color: '#94a3b8', overflow: 'auto', maxHeight: 200 }}>
            {JSON.stringify(rows.slice(0, 100), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ─── EPS CHART ────────────────────────────────────────────────────────────────

function EpsChart({ namespace, from, to, variant = 'card', onClose }: { namespace: string; from: string; to: string; variant?: 'card' | 'chart-box'; onClose?: () => void }) {
  const canvasRef  = React.useRef<HTMLCanvasElement | null>(null);
  const chartRef   = React.useRef<Chart | null>(null);
  const [rows, setRows]           = React.useState<Row[]>([]);
  const [bucketSec, setBucketSec] = React.useState<number>(60);
  const [loading, setLoading]     = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const q: any = { kind: 'event_count', from, to };
      if (namespace) q.namespace = namespace;
      const r = await fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ query: q }) });
      const j = await r.json();
      if (j.ok) {
        setRows(j.result.rows ?? []);
        setBucketSec(j.meta?.effective_bucket_sec ?? 60);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); }, [namespace, from, to]);

  // Create Chart.js instance once canvas is mounted (canvas is always in DOM)
  React.useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current = makeNeLineChart(canvasRef.current, 1);
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, []);

  // Update chart data whenever rows change
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const isoToHHMM = (ts: string) => {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };
    chart.data.labels = rows.map(r => isoToHHMM(r.ts));
    chart.data.datasets[0].label = 'EPS';
    chart.data.datasets[0].data  = rows.map(r => r.value);
    chart.update('none');
  }, [rows]);

  const bucketLabel = bucketSec >= 3600 ? `${bucketSec / 3600}h` : bucketSec >= 60 ? `${bucketSec / 60}min` : `${bucketSec}s`;
  const isEmpty = !loading && rows.length === 0;

  if (variant === 'chart-box') {
    return (
      <div className="orbit-chart-box">
        <div className="orbit-chart-tag">
          EPS — Wazuh{loading ? ' · …' : ''} · bucket: {bucketLabel}
        </div>
        {onClose && (
          <button className="orbit-chart-close" onClick={onClose} title={t('chart_remove')}>×</button>
        )}
        <div className="orbit-chart-canvas-wrap">
          {/* canvas always in DOM so Chart.js can attach on mount */}
          <canvas ref={canvasRef} style={{ display: isEmpty ? 'none' : 'block' }} />
          {isEmpty && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12 }}>
              {t('events_no_data')}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...S.card, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>EPS — Events per second</span>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>bucket: {bucketLabel}{loading ? t('events_loading') : ''}</span>
      </div>
      <div style={{ position: 'relative', height: 160 }}>
        <canvas ref={canvasRef} style={{ display: isEmpty ? 'none' : 'block', width: '100%', height: '100%' }} />
        {isEmpty && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', color: '#64748b', fontSize: 12 }}>
            {t('events_no_data')}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── EVENTS TAB ───────────────────────────────────────────────────────────────

const SEVERITY_OPTS = ['', 'critical', 'high', 'medium', 'low', 'info'];

function EventsTab({ assets, defaultNs }: { assets: AssetOpt[]; defaultNs?: string }) {
  const [assetId, setAssetId]     = React.useState('');
  const [namespace, setNamespace] = React.useState(defaultNs ?? '');
  const [severity, setSeverity]   = React.useState('');
  const [from, setFrom]           = React.useState(() => relativeFrom(24));
  const [to, setTo]               = React.useState(() => new Date().toISOString());
  const [events, setEvents]       = React.useState<EventRow[]>([]);
  const [loading, setLoading]     = React.useState(false);
  const [err, setErr]             = React.useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = React.useState<number | null>(null);

  async function run() {
    setLoading(true); setErr(null); setExpandedIdx(null);
    try {
      const q: any = { kind: 'events', from, to, limit: 500 };
      if (assetId)   q.asset_id   = assetId;
      if (namespace) q.namespace  = namespace;
      if (severity)  q.severities = [severity];
      const r = await fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ query: q }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setEvents(j?.result?.rows ?? []);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Short timestamp: HH:MM:SS if today, MM/DD HH:MM otherwise
  function tsShort(ts: string) {
    const d = new Date(ts);
    const now = new Date();
    const hm  = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const sec = String(d.getSeconds()).padStart(2,'0');
    if (d.toDateString() === now.toDateString()) return `${hm}:${sec}`;
    return `${d.getMonth()+1}/${d.getDate()} ${hm}`;
  }

  // Auto-run on mount
  React.useEffect(() => { run(); }, []);

  return (
    <div>
      {defaultNs === 'wazuh' && (
        <EpsChart namespace="wazuh" from={from} to={to} />
      )}
      <div style={S.card}>
        <div className="orbit-grid-4" style={{ marginBottom: 10 }}>
          <label style={S.label}>
            Asset
            <select style={S.select} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">{t('all')}</option>
              {assets.map((a) => <option key={a.asset_id} value={a.asset_id}>{a.asset_id}</option>)}
            </select>
          </label>
          <label style={S.label}>
            Namespace
            <select style={S.select} value={namespace} onChange={(e) => setNamespace(e.target.value)}>
              <option value="">{t('all')}</option>
              <option value="nagios">nagios</option>
              <option value="wazuh">wazuh</option>
              <option value="n8n">n8n</option>
              <option value="otel">otel</option>
            </select>
          </label>
          <label style={S.label}>
            Severity
            <select style={S.select} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {SEVERITY_OPTS.map((s) => <option key={s} value={s}>{s || t('all')}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{t('actions')}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 2 }}>
              <button style={S.btn} onClick={run} disabled={loading}>{loading ? '…' : t('search')}</button>
              <span style={{ color: '#64748b', fontSize: 12 }}>{events.length} events</span>
            </div>
          </div>
        </div>
        <div className="orbit-grid-2">
          <label style={S.label}>
            From (ISO)
            <input style={S.input} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={S.label}>
            To (ISO)
            <input style={S.input} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div style={{ ...S.row, marginTop: 8 }}>
          <RangeShortcuts setFrom={setFrom} setTo={setTo} />
        </div>
        {err && <div style={S.err}>{err}</div>}
      </div>

      {/* Table — sticky header, expandable rows, fills remaining viewport height */}
      <div style={{ ...S.card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 370px)', minHeight: 240 }}>
        <table style={{ ...S.table, tableLayout: 'fixed', minWidth: 580 }}>
          <colgroup>
            <col style={{ width: 88 }} />  {/* timestamp */}
            <col style={{ width: 76 }} />  {/* severity  */}
            <col style={{ width: '16%' }} />{/* asset     */}
            <col style={{ width: '18%' }} />{/* ns · kind */}
            <col />                          {/* title     */}
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#0d1224' }}>
            <tr>
              {['Timestamp', t('severity'), t('asset'), `${t('namespace')} · Kind`, t('title')].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...S.td, color: '#64748b', textAlign: 'center', padding: 24 }}>
                  {loading ? t('loading') : t('events_no_data')}
                </td>
              </tr>
            )}
            {events.map((ev, i) => {
              const isExp = expandedIdx === i;
              const hasMsg = !!(ev.message);
              return (
                <React.Fragment key={i}>
                  <tr
                    onClick={() => setExpandedIdx(isExp ? null : i)}
                    style={{
                      cursor: 'pointer',
                      background: isExp
                        ? 'rgba(85,243,255,0.06)'
                        : i % 2 ? 'rgba(255,255,255,0.015)' : 'transparent',
                    }}
                  >
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap', color: '#64748b', paddingRight: 4 }}>
                      {tsShort(ev.ts)}
                    </td>
                    <td style={S.td}><SevBadge sev={ev.severity} /></td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ev.asset_id}>
                      {ev.asset_id}
                    </td>
                    <td style={{ ...S.td, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#94a3b8' }}>{ev.namespace}</span>
                      {ev.kind && <span style={{ color: '#475569' }}> · {ev.kind}</span>}
                    </td>
                    <td style={{ ...S.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ev.title}>
                      <span style={{ fontSize: 13 }}>{ev.title}</span>
                      {hasMsg && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: '#475569', verticalAlign: 'middle', userSelect: 'none' }}>
                          {isExp ? '▲' : '▶'}
                        </span>
                      )}
                    </td>
                  </tr>
                  {isExp && (
                    <tr style={{ background: 'rgba(85,243,255,0.025)' }}>
                      <td colSpan={5} style={{ ...S.td, padding: '10px 14px 12px', borderTop: '1px solid rgba(85,243,255,0.08)' }}>
                        {/* Metadata pills */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11, marginBottom: hasMsg ? 8 : 0 }}>
                          {[
                            ['ts',    ev.ts],
                            ['asset', ev.asset_id],
                            ['ns',    ev.namespace],
                            ev.kind ? ['kind', ev.kind] : null,
                            ['sev',   ev.severity],
                          ].filter((x): x is string[] => x !== null).map(([k, v]) => (
                            <span key={k as string}>
                              <span style={{ color: '#475569' }}>{k}</span>{' '}
                              <code style={{ color: '#cbd5e1', fontSize: 11 }}>{v}</code>
                            </span>
                          ))}
                        </div>
                        {hasMsg && (
                          <pre style={{
                            margin: 0,
                            fontSize: 12,
                            color: 'rgba(233,238,255,0.80)',
                            lineHeight: 1.55,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            maxHeight: 220,
                            overflowY: 'auto',
                            background: 'rgba(4,7,19,0.5)',
                            border: '1px solid rgba(140,160,255,0.10)',
                            borderRadius: 6,
                            padding: '8px 10px',
                          }}>
                            {ev.message}
                          </pre>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── NAGIOS SERVICES TAB ──────────────────────────────────────────────────────
//
// Shows the *latest* state per host:service pair from orbit_events (nagios namespace).
// Allows filtering by host, state, and time window.

type NagiosSvc = {
  ts: string;
  asset_id: string;
  service: string;
  state: string;
  severity: string;
  output: string;
};

function NagiosTab({ assets }: { assets: AssetOpt[] }) {
  const [assetId, setAssetId]         = React.useState('');
  const [stateFilter, setStateFilter] = React.useState('');
  const [from, setFrom]               = React.useState(() => relativeFrom(24));
  const [to, setTo]                   = React.useState(() => new Date().toISOString());
  const [services, setServices]       = React.useState<NagiosSvc[]>([]);
  const [loading, setLoading]         = React.useState(false);
  const [err, setErr]                 = React.useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = React.useState<number | null>(null);

  async function run() {
    setLoading(true); setErr(null); setExpandedIdx(null);
    try {
      const q: any = { kind: 'events', from, to, namespace: 'nagios', limit: 2000 };
      if (assetId) q.asset_id = assetId;

      const r = await fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ query: q }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));

      const raw: EventRow[] = j?.result?.rows ?? [];

      const latestMap = new Map<string, NagiosSvc>();
      for (const ev of raw) {
        const isHost = ev.kind === 'host';
        const parts = ev.title.split(' ');
        const state = parts[parts.length - 1] ?? ev.severity.toUpperCase();
        const service = isHost
          ? '(host)'
          : parts.slice(0, parts.length - 1).join(' ') || ev.kind;

        const key = `${ev.asset_id}::${service}`;
        const existing = latestMap.get(key);
        if (!existing || new Date(ev.ts) > new Date(existing.ts)) {
          latestMap.set(key, {
            ts:       ev.ts,
            asset_id: ev.asset_id,
            service,
            state:    state.toUpperCase(),
            severity: ev.severity,
            output:   ev.message ?? '',
          });
        }
      }

      let all = Array.from(latestMap.values());
      const sevOrder = ['critical', 'high', 'medium', 'low', 'info'];
      all.sort((a, b) => {
        const sa = sevOrder.indexOf(a.severity);
        const sb = sevOrder.indexOf(b.severity);
        if (sa !== sb) return sa - sb;
        return a.asset_id.localeCompare(b.asset_id);
      });

      if (stateFilter) all = all.filter((s) => s.state === stateFilter || s.severity === stateFilter.toLowerCase());
      setServices(all);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { run(); }, []);

  const states = ['', 'OK', 'UP', 'WARNING', 'CRITICAL', 'DOWN', 'UNREACHABLE', 'UNKNOWN'];
  const counts = {
    ok:       services.filter((s) => s.state === 'OK' || s.state === 'UP').length,
    warning:  services.filter((s) => s.state === 'WARNING').length,
    critical: services.filter((s) => s.state === 'CRITICAL' || s.state === 'DOWN').length,
    unknown:  services.filter((s) => s.state === 'UNKNOWN' || s.state === 'UNREACHABLE').length,
  };

  return (
    <div>
      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { label: 'OK / UP',         count: counts.ok,       color: '#4ade80' },
          { label: 'WARNING',         count: counts.warning,  color: '#fbbf24' },
          { label: 'CRITICAL / DOWN', count: counts.critical, color: '#f87171' },
          { label: 'UNKNOWN',         count: counts.unknown,  color: '#94a3b8' },
        ].map(({ label, count, color }) => (
          <div key={label} style={{
            background: '#1e293b', border: `1px solid ${color}44`, borderRadius: 8,
            padding: '8px 16px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', minWidth: 100,
          }}>
            <span style={{ fontSize: 22, fontWeight: 700, color }}>{count}</span>
            <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={S.card}>
        <div className="orbit-grid-4" style={{ marginBottom: 10 }}>
          <label style={S.label}>
            Host
            <select style={S.select} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">{t('all')}</option>
              {assets.map((a) => <option key={a.asset_id} value={a.asset_id}>{a.asset_id}</option>)}
            </select>
          </label>
          <label style={S.label}>
            {t('nagios_col_state')}
            <select style={S.select} value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
              {states.map((s) => <option key={s} value={s}>{s || t('all')}</option>)}
            </select>
          </label>
          <label style={S.label}>
            From (ISO)
            <input style={S.input} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={S.label}>
            To (ISO)
            <input style={S.input} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div style={S.row}>
          <RangeShortcuts setFrom={setFrom} setTo={setTo} />
          <button style={S.btn} onClick={run} disabled={loading}>{loading ? '…' : t('search')}</button>
          <span style={{ color: '#64748b', fontSize: 12 }}>{services.length} services</span>
        </div>
        {err && <div style={S.err}>{err}</div>}
      </div>

      {/* Table — sticky header, expandable rows, fills remaining viewport height */}
      <div style={{ ...S.card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 390px)', minHeight: 240 }}>
        <table style={{ ...S.table, tableLayout: 'fixed', minWidth: 520 }}>
          <colgroup>
            <col style={{ width: 96 }} />  {/* state      */}
            <col style={{ width: 68 }} />  {/* severity   */}
            <col style={{ width: '18%' }} />{/* host       */}
            <col style={{ width: '22%' }} />{/* service    */}
            <col />                          {/* output     */}
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#0d1224' }}>
            <tr>
              {[t('nagios_col_state'), t('nagios_col_severity'), 'Host', t('nagios_col_service'), t('nagios_col_output')].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {services.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...S.td, color: '#64748b', textAlign: 'center', padding: 24 }}>
                  {loading ? t('loading') : t('nagios_no_services')}
                </td>
              </tr>
            )}
            {services.map((svc, i) => {
              const isExp = expandedIdx === i;
              const hasOutput = !!svc.output;
              return (
                <React.Fragment key={i}>
                  <tr
                    onClick={() => setExpandedIdx(isExp ? null : i)}
                    style={{
                      cursor: 'pointer',
                      background: isExp
                        ? 'rgba(85,243,255,0.06)'
                        : i % 2 ? 'rgba(255,255,255,0.015)' : 'transparent',
                    }}
                  >
                    <td style={S.td}><StateBadge state={svc.state} /></td>
                    <td style={S.td}><SevBadge sev={svc.severity} /></td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={svc.asset_id}>
                      {svc.asset_id}
                    </td>
                    <td style={{ ...S.td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={svc.service}>
                      {svc.service}
                    </td>
                    <td style={{ ...S.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={svc.output}>
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>{svc.output}</span>
                      {hasOutput && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: '#475569', verticalAlign: 'middle', userSelect: 'none' }}>
                          {isExp ? '▲' : '▶'}
                        </span>
                      )}
                    </td>
                  </tr>
                  {isExp && (
                    <tr style={{ background: 'rgba(85,243,255,0.025)' }}>
                      <td colSpan={5} style={{ ...S.td, padding: '10px 14px 12px', borderTop: '1px solid rgba(85,243,255,0.08)' }}>
                        {/* Metadata pills */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11, marginBottom: hasOutput ? 8 : 0 }}>
                          {[
                            ['last change', fmtTs(svc.ts)],
                            ['host',        svc.asset_id],
                            ['service',     svc.service],
                            ['state',       svc.state],
                            ['severity',    svc.severity],
                          ].map(([k, v]) => (
                            <span key={k}>
                              <span style={{ color: '#475569' }}>{k}</span>{' '}
                              <code style={{ color: '#cbd5e1', fontSize: 11 }}>{v}</code>
                            </span>
                          ))}
                        </div>
                        {hasOutput && (
                          <pre style={{
                            margin: 0, fontSize: 12, color: 'rgba(233,238,255,0.80)',
                            lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            maxHeight: 220, overflowY: 'auto',
                            background: 'rgba(4,7,19,0.5)',
                            border: '1px solid rgba(140,160,255,0.10)',
                            borderRadius: 6, padding: '8px 10px',
                          }}>
                            {svc.output}
                          </pre>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── HEALTH BADGE ─────────────────────────────────────────────────────────────

function HealthBadge() {
  const [health, setHealth] = React.useState<any>(null);

  React.useEffect(() => {
    function poll() {
      fetch('api/v1/health', { headers: apiGetHeaders() })
        .then((r) => r.json())
        .then(setHealth)
        .catch(() => setHealth(null));
    }
    poll();
    const t = setInterval(poll, 30_000);
    return () => clearInterval(t);
  }, []);

  const dbOk = health?.db === 'ok';
  const color = health ? (dbOk ? '#4ade80' : '#f87171') : '#94a3b8';
  const label = health ? (dbOk ? 'ok' : `db: ${health.db}`) : '…';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color, marginLeft: 'auto' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
      API {label}
      {health?.version && <span style={{ color: '#475569', marginLeft: 4 }}>v{health.version}</span>}
    </div>
  );
}

// ─── SHARED CHART HELPERS ────────────────────────────────────────────────────

function glowGradient(ctx: CanvasRenderingContext2D, colorA: string, colorB: string) {
  const g = ctx.createLinearGradient(0, 0, 0, 320);
  g.addColorStop(0, colorA);
  g.addColorStop(1, colorB);
  return g;
}

function makeNeLineChart(canvas: HTMLCanvasElement, datasetCount: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const colors = ['rgba(85,243,255,.95)','rgba(155,124,255,.95)','rgba(255,93,214,.85)','rgba(255,211,106,.90)'];

  const datasets = Array.from({ length: datasetCount }).map((_, i) => ({
    label: `s${i+1}`,
    data: [] as number[],
    borderColor: colors[i % colors.length],
    backgroundColor: i === 0 ? glowGradient(ctx,'rgba(85,243,255,.22)','rgba(85,243,255,0)') : 'rgba(0,0,0,0)',
    tension: 0.38,
    fill: i === 0,
    pointRadius: 0,
    borderWidth: 2,
  }));

  const chart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 450 },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          border: { display: false },
          grid: { color: 'rgba(140,160,255,.05)', drawTicks: false },
          ticks: {
            color: 'rgba(233,238,255,.50)',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 7,
            padding: 6,
            font: { size: 10, weight: 600 },
          },
        },
        y: {
          border: { display: false },
          grid: { color: 'rgba(140,160,255,.07)', drawTicks: false },
          ticks: {
            color: 'rgba(233,238,255,.50)',
            autoSkip: true,
            maxTicksLimit: 5,
            padding: 6,
            font: { size: 10, weight: 600 },
          },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: 'rgba(233,238,255,.72)',
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: 'rectRounded',
            padding: 14,
            font: { size: 10, weight: 700 },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(3,6,18,.92)',
          borderColor: 'rgba(140,160,255,.25)',
          borderWidth: 1,
          titleColor: 'rgba(233,238,255,.9)',
          bodyColor: 'rgba(233,238,255,.75)',
        },
      },
    },
    plugins: [{
      id: 'neGlow',
      beforeDatasetsDraw(c) {
        const { ctx } = c;
        ctx.save();
        ctx.shadowColor = 'rgba(85,243,255,.28)';
        ctx.shadowBlur = 18;
      },
      afterDatasetsDraw(c) {
        c.ctx.restore();
      },
    }]
  });

  return chart;
}

// ─── HOME + SOURCES ──────────────────────────────────────────────────────────

function HomeTab({ assets, setTab }: { assets: AssetOpt[]; setTab: (t: Tab) => void }) {
  const [health, setHealth] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [assetId, setAssetId] = React.useState('');
  const [from, setFrom] = React.useState(() => relativeFrom(1));
  const [to, setTo] = React.useState(() => new Date().toISOString());

  const [cpuRows, setCpuRows] = React.useState<MultiRow[]>([]);
  const [diskRows, setDiskRows] = React.useState<MultiRow[]>([]);
  const [netRows, setNetRows] = React.useState<MultiRow[]>([]);
  const [suriRows, setSuriRows] = React.useState<Row[]>([]);
  const [feed, setFeed] = React.useState<EventRow[]>([]);
  // selected namespaces for the consolidated feed
  const [feedNs, setFeedNs] = React.useState<string[]>(['nagios', 'wazuh', 'fortigate', 'n8n', 'otel']);

  // Layout: 'side' = charts left + feed right; 'cols1/2/3' = stacked with N charts per row
  const [chartLayout, setChartLayout] = React.useState<'side' | 'cols1' | 'cols2' | 'cols3'>('side');

  // Extra charts (up to 2, for a max total of 6)
  type ExtraChartCfg = { id: string; ns: string; metric: string; label: string };
  const [extraCharts, setExtraCharts] = React.useState<ExtraChartCfg[]>([]);
  const [extraRows, setExtraRows] = React.useState<Record<string, Row[]>>({});

  // Add-chart picker state
  const [showAddChart, setShowAddChart] = React.useState(false);
  const [addNs, setAddNs] = React.useState('');
  const [addMetric, setAddMetric] = React.useState('');
  const [addLabel, setAddLabel] = React.useState('');
  const [metricOpts, setMetricOpts] = React.useState<MetricOpt[]>([]);

  // hidden fixed charts ('cpu' | 'disk' | 'net' | 'suri')
  const [hiddenFixed, setHiddenFixed] = React.useState<string[]>([]);
  const [hiddenEps, setHiddenEps]     = React.useState(false);

  const cpuRef = React.useRef<HTMLCanvasElement | null>(null);
  const diskRef = React.useRef<HTMLCanvasElement | null>(null);
  const netRef = React.useRef<HTMLCanvasElement | null>(null);
  const suriRef = React.useRef<HTMLCanvasElement | null>(null);
  const extra1Ref = React.useRef<HTMLCanvasElement | null>(null);
  const extra2Ref = React.useRef<HTMLCanvasElement | null>(null);

  const cpuChart = React.useRef<Chart | null>(null);
  const diskChart = React.useRef<Chart | null>(null);
  const netChart = React.useRef<Chart | null>(null);
  const suriChart = React.useRef<Chart | null>(null);
  const extra1Chart = React.useRef<Chart | null>(null);
  const extra2Chart = React.useRef<Chart | null>(null);
  const pulseAbortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    fetch('api/v1/health', { headers: apiGetHeaders() })
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setErr(String(e)));
  }, []);

  // pick a default asset
  React.useEffect(() => {
    if (assetId) return;
    if (!assets.length) return;
    const prefer = assets.find(a => a.asset_id === 'host:portn8n') ?? assets[0];
    setAssetId(prefer.asset_id);
  }, [assets, assetId]);

  // load available metrics for the add-chart picker
  React.useEffect(() => {
    if (!assetId) return;
    fetch(`api/v1/catalog/metrics?asset_id=${encodeURIComponent(assetId)}`, { headers: apiGetHeaders() })
      .then(r => r.json())
      .then(j => {
        const opts: MetricOpt[] = j.metrics ?? [];
        setMetricOpts(opts);
        if (!addNs && opts.length) setAddNs(opts[0].namespace);
        if (!addMetric && opts.length) setAddMetric(opts[0].metric);
      })
      .catch(e => console.error("[orbit]", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  async function runPulse() {
    if (!assetId) return;

    // Cancel any in-flight request from a previous pulse.
    pulseAbortRef.current?.abort();
    const ctrl = new AbortController();
    pulseAbortRef.current = ctrl;
    const signal = ctrl.signal;

    setErr(null);
    try {
      const q = (query: object) => ({
        method: 'POST' as const,
        headers: apiHeaders(),
        body: JSON.stringify({ language: 'orbitql', query }),
        signal,
      });

      // LIMIT reasoning: backend auto-selects rollup table.
      // Widest range is 24h → hourly rollup → 24 pts/series × 3 series = 72 rows max.
      // 2000 is ample headroom for any zoom level.
      const LIMIT = 2000;

      const evNsList = ['nagios', 'wazuh', 'otel', 'n8n'];

      // Fire ALL queries in a single round-trip (metrics + events together).
      const [rCpu, rDisk, rNet, rSuri, ...evResults] = await Promise.all([
        fetch('api/v1/query', q({ kind: 'timeseries_multi', from, to, agg: 'avg', limit: LIMIT,
          series: [
            { asset_id: assetId, namespace: 'nagios', metric: 'load1',  dimensions: { service: 'CPU Load' }, label: 'load1'  },
            { asset_id: assetId, namespace: 'nagios', metric: 'load5',  dimensions: { service: 'CPU Load' }, label: 'load5'  },
            { asset_id: assetId, namespace: 'nagios', metric: 'load15', dimensions: { service: 'CPU Load' }, label: 'load15' },
          ],
        })).then(r => r.json()),
        fetch('api/v1/query', q({ kind: 'timeseries_multi', from, to, agg: 'avg', limit: LIMIT,
          series: [
            { asset_id: assetId, namespace: 'nagios', metric: 'aqu',  dimensions: { service: 'Disk_Queue_sda' }, label: 'aqu-sz' },
            { asset_id: assetId, namespace: 'nagios', metric: 'util', dimensions: { service: 'Disk_Queue_sda' }, label: '%util'  },
          ],
        })).then(r => r.json()),
        fetch('api/v1/query', q({ kind: 'timeseries_multi', from, to, agg: 'avg', limit: LIMIT,
          series: [
            { asset_id: assetId, namespace: 'nagios', metric: 'rx_mbps', dimensions: { service: 'Network_Traffic_eth0' }, label: 'RX Mbps' },
            { asset_id: assetId, namespace: 'nagios', metric: 'tx_mbps', dimensions: { service: 'Network_Traffic_eth0' }, label: 'TX Mbps' },
          ],
        })).then(r => r.json()),
        fetch('api/v1/query', q({ kind: 'timeseries', asset_id: assetId, namespace: 'nagios',
          metric: 'alerts', from, to, agg: 'sum',
          dimensions: { service: 'Suricata_Alerts_5m' }, limit: LIMIT,
        })).then(r => r.json()),
        // Events: 40 per namespace so low-volume sources (otel, n8n) always appear.
        ...evNsList.map(ns =>
          fetch('api/v1/query', q({ kind: 'events', namespace: ns, from, to, limit: 40 }))
            .then(r => r.json()).then(j => (j.result?.rows ?? []) as EventRow[])
        ),
        // Extra user-added charts.
        ...extraCharts.map(cfg =>
          fetch('api/v1/query', q({ kind: 'timeseries', asset_id: assetId,
            namespace: cfg.ns, metric: cfg.metric, from, to, agg: 'avg', limit: LIMIT,
          })).then(r => r.json()).then(j => ({ id: cfg.id, rows: (j.result?.rows ?? []).map((x: any) => ({ ts: x.ts, value: Number(x.value) })) }))
        ),
      ]);

      // Bail if a newer pulse has already started.
      if (signal.aborted) return;

      if (!rCpu.ok)  throw new Error(rCpu.error  ?? JSON.stringify(rCpu));
      if (!rDisk.ok) throw new Error(rDisk.error ?? JSON.stringify(rDisk));
      if (!rNet.ok)  throw new Error(rNet.error  ?? JSON.stringify(rNet));
      if (!rSuri.ok) throw new Error(rSuri.error ?? JSON.stringify(rSuri));

      // Separate the mixed evResults + extraCharts results back out.
      const evRows    = evResults.slice(0, evNsList.length) as EventRow[][];
      const extraData = evResults.slice(evNsList.length) as Array<{ id: string; rows: Row[] }>;

      const mergedEvents = (evRows as EventRow[][]).flat().sort((a, b) =>
        new Date(b.ts).getTime() - new Date(a.ts).getTime()
      );

      setCpuRows( (rCpu.result?.rows  ?? []).map((x: any) => ({ ts: x.ts, series: x.series, value: Number(x.value) })));
      setDiskRows((rDisk.result?.rows ?? []).map((x: any) => ({ ts: x.ts, series: x.series, value: Number(x.value) })));
      setNetRows( (rNet.result?.rows  ?? []).map((x: any) => ({ ts: x.ts, series: x.series, value: Number(x.value) })));
      setSuriRows((rSuri.result?.rows ?? []).map((x: any) => ({ ts: x.ts, value: Number(x.value) })));
      setFeed(mergedEvents.slice(0, 200));

      if (extraData.length) {
        const newExtra: Record<string, Row[]> = {};
        for (const e of extraData) if (e?.id) newExtra[e.id] = e.rows;
        setExtraRows(newExtra);
      }

    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setErr(String(e));
    }
  }

  React.useEffect(() => {
    if (!assetId) return;
    runPulse();
    const t = setInterval(() => {
      setTo(new Date().toISOString());
    }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  React.useEffect(() => {
    if (!assetId) return;
    runPulse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  // re-fetch when extra charts are added/removed
  React.useEffect(() => {
    if (!assetId || !extraCharts.length) return;
    runPulse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraCharts]);

  // destroy chart instances when fixed charts are hidden
  React.useEffect(() => {
    if (hiddenFixed.includes('cpu'))  { cpuChart.current?.destroy();  cpuChart.current  = null; }
    if (hiddenFixed.includes('disk')) { diskChart.current?.destroy(); diskChart.current = null; }
    if (hiddenFixed.includes('net'))  { netChart.current?.destroy();  netChart.current  = null; }
    if (hiddenFixed.includes('suri')) { suriChart.current?.destroy(); suriChart.current = null; }
  }, [hiddenFixed]);

  function ensureCharts() {
    if (cpuRef.current && !cpuChart.current) cpuChart.current = makeNeLineChart(cpuRef.current, 3);
    if (diskRef.current && !diskChart.current) diskChart.current = makeNeLineChart(diskRef.current, 2);
    if (netRef.current && !netChart.current) netChart.current = makeNeLineChart(netRef.current, 2);
    if (suriRef.current && !suriChart.current) suriChart.current = makeNeLineChart(suriRef.current, 1);
    if (extra1Ref.current && !extra1Chart.current && extraCharts[0]) extra1Chart.current = makeNeLineChart(extra1Ref.current, 1);
    if (extra2Ref.current && !extra2Chart.current && extraCharts[1]) extra2Chart.current = makeNeLineChart(extra2Ref.current, 1);
  }

  React.useEffect(() => {
    ensureCharts();
    return () => {
      cpuChart.current?.destroy(); cpuChart.current = null;
      diskChart.current?.destroy(); diskChart.current = null;
      netChart.current?.destroy(); netChart.current = null;
      suriChart.current?.destroy(); suriChart.current = null;
      extra1Chart.current?.destroy(); extra1Chart.current = null;
      extra2Chart.current?.destroy(); extra2Chart.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // isoToHHMM: converts ISO timestamp → "HH:MM" in local time, used for chart X-axis display.
  const isoToHHMM = (ts: string) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  // applyChart: isoTs = sorted unique ISO timestamps (used as lookup keys).
  // chart.data.labels is set to HH:MM formatted strings for display.
  function applyChart(chart: Chart | null, rows: MultiRow[] | Row[], isoTs: string[], seriesKeys: string[], seriesLabels: string[]) {
    if (!chart) return;
    chart.data.labels = isoTs.map(isoToHHMM);
    for (let i = 0; i < seriesKeys.length; i++) {
      const key = seriesKeys[i];
      const lab = seriesLabels[i] ?? key;
      const ds = chart.data.datasets[i];
      if (!ds) continue;
      ds.label = lab;
      if ('series' in (rows[0] ?? {})) {
        const rr = rows as MultiRow[];
        // build ISO-ts → value map for this series
        const perTs = new Map<string, number>();
        for (const r of rr) if (r.series === lab || r.series === key) perTs.set(r.ts, r.value);
        (ds.data as any) = isoTs.map(ts => perTs.get(ts) ?? null);
      } else {
        const rr = rows as Row[];
        (ds.data as any) = rr.map(r => r.value);
      }
    }
    chart.update('none');
  }

  React.useEffect(() => {
    ensureCharts();

    // CPU
    const cpuTs = Array.from(new Set(cpuRows.map(r => r.ts))).sort((a,b)=>Date.parse(a)-Date.parse(b));
    applyChart(cpuChart.current, cpuRows, cpuTs, ['load1','load5','load15'], ['load1','load5','load15']);

    // Disk
    const diskTs = Array.from(new Set(diskRows.map(r => r.ts))).sort((a,b)=>Date.parse(a)-Date.parse(b));
    applyChart(diskChart.current, diskRows, diskTs, ['aqu-sz','%util'], ['aqu-sz','%util']);

    // Net
    const netTs = Array.from(new Set(netRows.map(r => r.ts))).sort((a,b)=>Date.parse(a)-Date.parse(b));
    applyChart(netChart.current, netRows, netTs, ['RX Mbps','TX Mbps'], ['RX Mbps','TX Mbps']);

    // Suricata
    const suriTs = suriRows.map(r => r.ts);
    applyChart(suriChart.current, suriRows, suriTs, ['alerts'], ['alerts']);

    // Extra charts
    if (extraCharts[0] && extra1Ref.current) {
      if (!extra1Chart.current) extra1Chart.current = makeNeLineChart(extra1Ref.current, 1);
      const rows = extraRows[extraCharts[0].id] ?? [];
      applyChart(extra1Chart.current, rows, rows.map(r => r.ts), [extraCharts[0].label], [extraCharts[0].label]);
    }
    if (extraCharts[1] && extra2Ref.current) {
      if (!extra2Chart.current) extra2Chart.current = makeNeLineChart(extra2Ref.current, 1);
      const rows = extraRows[extraCharts[1].id] ?? [];
      applyChart(extra2Chart.current, rows, rows.map(r => r.ts), [extraCharts[1].label], [extraCharts[1].label]);
    }

  }, [cpuRows, diskRows, netRows, suriRows, extraRows]);

  const lastCpu  = React.useMemo(() => { const m: Record<string,number> = {}; for (const r of cpuRows)  m[r.series] = r.value; return m; }, [cpuRows]);
  const lastDisk = React.useMemo(() => { const m: Record<string,number> = {}; for (const r of diskRows) m[r.series] = r.value; return m; }, [diskRows]);
  const lastNet  = React.useMemo(() => { const m: Record<string,number> = {}; for (const r of netRows)  m[r.series] = r.value; return m; }, [netRows]);
  const fmtN = (v: any, d = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—');
  const suriLast = suriRows.length ? suriRows[suriRows.length - 1].value : null;

  const dbColor  = health?.db === 'ok' ? '#4ade80' : health?.db === 'error' ? '#f87171' : '#fbbf24';
  const apiColor = health?.ok ? '#4ade80' : '#fbbf24';
  const cpuLoad1 = lastCpu['load1'] ?? 0;
  const cpuColor = cpuLoad1 > 4 ? '#f87171' : cpuLoad1 > 2 ? '#fbbf24' : '#55f3ff';

  const kpis = [
    { label: 'CPU Load',        value: `${fmtN(lastCpu['load1'])} · ${fmtN(lastCpu['load5'])} · ${fmtN(lastCpu['load15'])}`, hint: 'load1 · load5 · load15', color: cpuColor },
    { label: 'Disk Queue',      value: `${fmtN(lastDisk['aqu-sz'])} · ${fmtN(lastDisk['%util'])}`,                            hint: 'aqu-sz · %util',         color: '#a78bfa' },
    { label: 'Net Traffic',     value: `${fmtN(lastNet['RX Mbps'])} · ${fmtN(lastNet['TX Mbps'])}`,                           hint: 'RX · TX  Mbps',          color: '#38bdf8' },
    { label: 'Suricata Alerts', value: fmtN(suriLast, 0),                                                                      hint: t('home_suri_hint'),       color: (suriLast ?? 0) > 20 ? '#f87171' : '#fbbf24' },
    { label: 'API',             value: health?.ok ? 'online' : '…',                                                            hint: '/api/v1/health',          color: apiColor },
    { label: 'Postgres',        value: health?.db ?? '…',                                                                      hint: 'database',                color: dbColor },
  ];

  return (
    <div style={{ position: 'relative' }}>
      {/* Star-field layer */}
      <div className="orbit-stars" />

      {/* Top panel: brand + status pills */}
      <div className="orbit-panel">
        <div className="orbit-panel-head">
          <div>
            <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '.4px' }}>◎ Orbit Core</div>
            <div style={{ color: 'rgba(233,238,255,.65)', fontSize: 12, marginTop: 4 }}>
              {t('home_subtitle')}<a href="#" onClick={(e) => { e.preventDefault(); setTab('src-nagios'); }} style={{ color: '#55f3ff', textDecoration: 'none' }}>{t('home_subtitle_link')}</a>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="orbit-pill">
              <span className="orbit-badge">view</span>
              <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                {assets.map(a => <option key={a.asset_id} value={a.asset_id}>{a.asset_id}</option>)}
              </select>
            </div>
            <div className="orbit-pill">
              <span className="orbit-badge">range</span>
              {[['60m',1],['6h',6],['24h',24]].map(([lbl, h]) => (
                <button key={lbl} className="orbit-badge" style={{ cursor: 'pointer', background: 'transparent' }}
                  onClick={() => { setFrom(relativeFrom(Number(h))); setTo(new Date().toISOString()); }}>{lbl}</button>
              ))}
            </div>
            <div className="orbit-pill">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: apiColor, display: 'inline-block' }} />
              <span>{health ? (health.ok ? 'live' : 'degraded') : 'connecting…'}</span>
            </div>
            <div className="orbit-pill">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dbColor, display: 'inline-block' }} />
              <span>db: {health?.db ?? '…'}</span>
            </div>
            <div className="orbit-pill" style={{ padding: '3px 4px', gap: 2 }}>
              {([
                { key: 'side',  label: '▣',  title: 'Lado a lado' },
                { key: 'cols1', label: '1×', title: '1 por linha' },
                { key: 'cols2', label: '2×', title: '2 por linha' },
                { key: 'cols3', label: '3×', title: '3 por linha' },
              ] as const).map(({ key, label, title }) => {
                const active = chartLayout === key;
                return (
                  <button key={key} onClick={() => setChartLayout(key)} title={title} style={{
                    padding: '3px 9px',
                    fontSize: 11,
                    fontWeight: active ? 700 : 400,
                    borderRadius: 999,
                    border: 'none',
                    background: active ? 'rgba(85,243,255,.18)' : 'transparent',
                    color: active ? 'rgba(85,243,255,.95)' : 'rgba(233,238,255,.4)',
                    cursor: 'pointer',
                    transition: 'all .15s',
                  }}>{label}</button>
                );
              })}
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div className="orbit-kpi-strip">
          {kpis.map((k) => (
            <div key={k.label} className="orbit-kpi" style={{ '--kpi-color': k.color } as React.CSSProperties}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value" style={{ color: k.color }}>{k.value}</div>
              <div className="kpi-hint">{k.hint}</div>
            </div>
          ))}
        </div>

        {/* Charts + feed */}
        <div className={chartLayout === 'side' ? 'orbit-home-main' : 'orbit-home-below'} style={{ padding: '0 16px 16px' }}>
          {/* Charts section */}
          <div>
            {/* Add-chart bar */}
            {(() => {
              const visibleFixed = 4 - hiddenFixed.length;
              const total = visibleFixed + extraCharts.length;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'rgba(233,238,255,.45)', letterSpacing: '.2px' }}>
                    {total}/6 charts
                  </span>
                  {total < 6 && !showAddChart && (
                    <button className="orbit-badge" style={{ cursor: 'pointer', background: 'rgba(85,243,255,.10)', borderColor: 'rgba(85,243,255,.3)', color: '#55f3ff' }}
                      onClick={() => setShowAddChart(true)}>{t('home_add_chart')}</button>
                  )}
                  {hiddenFixed.length > 0 && (
                    <button className="orbit-badge" style={{ cursor: 'pointer', background: 'rgba(155,124,255,.10)', borderColor: 'rgba(155,124,255,.3)', color: '#9b7cff' }}
                      onClick={() => setHiddenFixed([])}>↺ restaurar ({hiddenFixed.length})</button>
                  )}
                  {hiddenEps && (
                    <button className="orbit-badge" style={{ cursor: 'pointer', background: 'rgba(85,243,255,.10)', borderColor: 'rgba(85,243,255,.3)', color: '#55f3ff' }}
                      onClick={() => setHiddenEps(false)}>+ EPS</button>
                  )}
                </div>
              );
            })()}

            {/* Add-chart picker */}
            {showAddChart && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '10px 12px', marginBottom: 8, background: 'rgba(12,18,40,.8)', border: '1px solid rgba(140,160,255,.18)', borderRadius: 12 }}>
                <select className="orbit-pill" value={addNs}
                  onChange={e => { setAddNs(e.target.value); setAddMetric(''); }}
                  style={{ padding: '4px 8px' }}>
                  {Array.from(new Set(metricOpts.map(m => m.namespace))).map(ns => (
                    <option key={ns} value={ns}>{ns}</option>
                  ))}
                </select>
                <select className="orbit-pill" value={addMetric}
                  onChange={e => { setAddMetric(e.target.value); if (!addLabel) setAddLabel(e.target.value); }}
                  style={{ padding: '4px 8px' }}>
                  {metricOpts.filter(m => m.namespace === addNs).map(m => (
                    <option key={m.metric} value={m.metric}>{m.metric}</option>
                  ))}
                </select>
                <input className="orbit-pill" value={addLabel} placeholder="label"
                  onChange={e => setAddLabel(e.target.value)}
                  style={{ padding: '4px 8px', width: 90, background: 'transparent', border: '1px solid rgba(140,160,255,.18)', color: 'rgba(233,238,255,.85)', borderRadius: 999 }} />
                <button className="orbit-badge" style={{ cursor: 'pointer', background: 'rgba(85,243,255,.12)', color: '#55f3ff', borderColor: 'rgba(85,243,255,.3)' }}
                  onClick={() => {
                    if (!addMetric) return;
                    const id = `${addNs}:${addMetric}:${Date.now()}`;
                    const label = addLabel || addMetric;
                    setExtraCharts(prev => [...prev, { id, ns: addNs, metric: addMetric, label }]);
                    setShowAddChart(false);
                    setAddLabel('');
                  }}>Adicionar</button>
                <button className="orbit-badge" style={{ cursor: 'pointer' }}
                  onClick={() => setShowAddChart(false)}>Cancelar</button>
              </div>
            )}

            {/* Charts grid */}
            <div className={`orbit-charts-grid${chartLayout === 'cols1' ? ' orbit-charts-grid--1' : chartLayout === 'cols2' ? ' orbit-charts-grid--2' : chartLayout === 'cols3' ? ' orbit-charts-grid--3' : ''}`}>
              {!hiddenFixed.includes('cpu') && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">CPU Load</div>
                  <button className="orbit-chart-close" onClick={() => setHiddenFixed(h => [...h, 'cpu'])} title={t('chart_remove')}>×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={cpuRef} /></div>
                </div>
              )}
              {!hiddenFixed.includes('disk') && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">Disk Queue</div>
                  <button className="orbit-chart-close" onClick={() => setHiddenFixed(h => [...h, 'disk'])} title={t('chart_remove')}>×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={diskRef} /></div>
                </div>
              )}
              {!hiddenFixed.includes('net') && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">Net Traffic</div>
                  <button className="orbit-chart-close" onClick={() => setHiddenFixed(h => [...h, 'net'])} title={t('chart_remove')}>×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={netRef} /></div>
                </div>
              )}
              {!hiddenFixed.includes('suri') && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">Suricata Alerts</div>
                  <button className="orbit-chart-close" onClick={() => setHiddenFixed(h => [...h, 'suri'])} title={t('chart_remove')}>×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={suriRef} /></div>
                </div>
              )}
              {extraCharts[0] && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">{extraCharts[0].label}</div>
                  <button className="orbit-chart-close" title={t('chart_remove')}
                    onClick={() => {
                      setExtraCharts(prev => prev.filter((_, i) => i !== 0));
                      setExtraRows(prev => { const n = { ...prev }; delete n[extraCharts[0].id]; return n; });
                      extra1Chart.current?.destroy(); extra1Chart.current = null;
                      if (extraCharts[1]) { extra1Chart.current = extra2Chart.current; extra2Chart.current = null; }
                    }}>×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={extra1Ref} /></div>
                </div>
              )}
              {extraCharts[1] && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">{extraCharts[1].label}</div>
                  <button className="orbit-chart-close" title={t('chart_remove')}
                    onClick={() => {
                      setExtraCharts(prev => prev.filter((_, i) => i !== 1));
                      setExtraRows(prev => { const n = { ...prev }; delete n[extraCharts[1].id]; return n; });
                      extra2Chart.current?.destroy(); extra2Chart.current = null;
                    }}>×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={extra2Ref} /></div>
                </div>
              )}
              {/* EPS chart spanning full width */}
              {!hiddenEps && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <EpsChart namespace="wazuh" from={relativeFrom(24)} to={new Date().toISOString()} variant="chart-box" onClose={() => setHiddenEps(true)} />
                </div>
              )}
            </div>
          </div>

          {/* Live event feed — consolidated */}
          <div className="orbit-panel" style={{ margin: 0 }}>
            <div className="orbit-panel-head">
              <div>
                <div className="orbit-panel-title">Live Feed</div>
                <div className="orbit-panel-meta">eventos consolidados por fonte</div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {/* source toggle pills — built from namespaces in feed + always show known ones */}
                {[...new Set([...feed.map(e => eventSource(e)), 'nagios', 'wazuh', 'fortigate', 'n8n', 'otel'])].sort().map(ns => {
                  const active = feedNs.includes(ns);
                  const color  = NS_COLOR[ns] ?? 'rgba(233,238,255,.55)';
                  const bg     = NS_BG[ns]    ?? 'rgba(30,40,80,.5)';
                  return (
                    <button key={ns} onClick={() =>
                      setFeedNs(prev => prev.includes(ns) ? prev.filter(x => x !== ns) : [...prev, ns])
                    } style={{
                      padding: '4px 11px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      border: `1px solid ${active ? color : 'rgba(140,160,255,.2)'}`,
                      background: active ? bg : 'transparent',
                      color: active ? color : 'rgba(233,238,255,.35)',
                      cursor: 'pointer',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      transition: 'all .15s',
                    }}>{ns}</button>
                  );
                })}
                <span className="orbit-badge" style={{ marginLeft: 4 }}>stream</span>
              </div>
            </div>
            <div className="orbit-feed">
              {(() => {
                const visible = feed.filter(e => feedNs.includes(eventSource(e)));
                if (visible.length === 0) return (
                  <div style={{ color: 'rgba(233,238,255,.45)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                    {t('home_no_events')}
                  </div>
                );
                return visible.slice(0, 30).map((e, idx) => (
                  <FeedRow key={idx} e={e} />
                ));
              })()}
            </div>
          </div>
        </div>

        {err && <div style={S.err}>{err}</div>}
      </div>
    </div>
  );
}

// ─── CORRELATIONS TAB ─────────────────────────────────────────────────────────
//
// Shows metric anomalies that were detected around significant events.
// z_score ≥ 2 → metric spiked by 2+ standard deviations at event time.
// rel_change  → percentage change vs 24 h baseline.

function ZScore({ z }: { z: number | null }) {
  if (z == null) return <span style={{ color: '#64748b' }}>—</span>;
  const abs = Math.abs(z);
  const color = abs >= 4 ? '#f87171' : abs >= 2 ? '#fb923c' : '#fbbf24';
  return <span style={{ color, fontWeight: 700, fontFamily: 'monospace' }}>{z.toFixed(2)}σ</span>;
}

function RelChange({ r }: { r: number | null }) {
  if (r == null) return <span style={{ color: '#64748b' }}>—</span>;
  const pct = (r * 100).toFixed(1);
  const color = Math.abs(r) >= 1 ? '#f87171' : Math.abs(r) >= 0.5 ? '#fb923c' : '#fbbf24';
  return <span style={{ color, fontFamily: 'monospace' }}>{r >= 0 ? '+' : ''}{pct}%</span>;
}

function CorrelationsTab({ assets }: { assets: AssetOpt[] }) {
  const [assetId, setAssetId]         = React.useState('');
  const [from, setFrom]               = React.useState(() => relativeFrom(24));
  const [to, setTo]                   = React.useState(() => new Date().toISOString());
  const [rows, setRows]               = React.useState<CorrelationRow[]>([]);
  const [loading, setLoading]         = React.useState(false);
  const [err, setErr]                 = React.useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = React.useState<number | null>(null);

  async function run() {
    setLoading(true); setErr(null); setExpandedIdx(null);
    try {
      const params = new URLSearchParams({ from, to, limit: '500' });
      if (assetId) params.set('asset_id', assetId);
      const r = await fetch(`api/v1/correlations?${params}`, { headers: apiGetHeaders() });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setRows(j.correlations ?? []);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { run(); }, []);

  const fmtNum = (n: number | null) =>
    n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(3);

  return (
    <div>
      <div style={S.card}>
        <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 4 }}>{t('corr_title')}</div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
          {t('corr_desc1')} {t('corr_desc2')}
        </div>
        <div className="orbit-grid-4" style={{ marginBottom: 10 }}>
          <label style={S.label}>
            Asset
            <select style={S.select} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">{t('all')}</option>
              {assets.map((a) => <option key={a.asset_id} value={a.asset_id}>{a.asset_id}</option>)}
            </select>
          </label>
          <label style={S.label}>
            From (ISO)
            <input style={S.input} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={S.label}>
            To (ISO)
            <input style={S.input} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{t('actions')}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 2 }}>
              <button style={S.btn} onClick={run} disabled={loading}>{loading ? '…' : t('search')}</button>
              <span style={{ color: '#64748b', fontSize: 12 }}>{rows.length} correlations</span>
            </div>
          </div>
        </div>
        <div style={{ ...S.row }}>
          <RangeShortcuts setFrom={setFrom} setTo={setTo} />
        </div>
        {err && <div style={S.err}>{err}</div>}
      </div>

      {rows.length === 0 && !loading && !err && (
        <div style={{ ...S.card, color: '#64748b', textAlign: 'center', padding: 32 }}>
          {t('corr_no_data')}
        </div>
      )}

      {/* Table — sticky header, expandable rows, fills remaining viewport height */}
      {rows.length > 0 && (
        <div style={{ ...S.card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 370px)', minHeight: 240 }}>
          <table style={{ ...S.table, tableLayout: 'fixed', minWidth: 560 }}>
            <colgroup>
              <col style={{ width: 88 }} />  {/* event ts   */}
              <col style={{ width: '16%' }} />{/* asset      */}
              <col style={{ width: '22%' }} />{/* metric     */}
              <col style={{ width: '22%' }} />{/* base→peak  */}
              <col />                          {/* anomaly    */}
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#0d1224' }}>
              <tr>
                {[t('corr_col_event'), t('asset'), t('metric'), t('corr_col_base_peak'), t('corr_col_anomaly')].map((h) => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isExp = expandedIdx === i;
                return (
                  <React.Fragment key={i}>
                    <tr
                      onClick={() => setExpandedIdx(isExp ? null : i)}
                      style={{
                        cursor: 'pointer',
                        background: isExp
                          ? 'rgba(85,243,255,0.06)'
                          : i % 2 ? 'rgba(255,255,255,0.015)' : 'transparent',
                      }}
                    >
                      {/* Event timestamp */}
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap', color: '#64748b' }}>
                        {fmtTs(r.event_ts)}
                      </td>
                      {/* Asset */}
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.asset_id}>
                        {r.asset_id}
                      </td>
                      {/* Metric (ns/name) */}
                      <td style={{ ...S.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${r.metric_ns}/${r.metric}`}>
                        <span style={{ color: '#64748b', fontSize: 10 }}>{r.metric_ns}/</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.metric}</span>
                      </td>
                      {/* Baseline → Peak */}
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                        <span style={{ color: '#94a3b8' }}>{fmtNum(r.baseline_avg)}</span>
                        <span style={{ color: '#475569', margin: '0 4px' }}>→</span>
                        <span style={{ color: '#f0abfc' }}>{fmtNum(r.peak_value)}</span>
                      </td>
                      {/* Anomaly: z-score + Δ rel side by side */}
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                        <ZScore z={r.z_score} />
                        <span style={{ color: '#334155', margin: '0 6px' }}>·</span>
                        <RelChange r={r.rel_change} />
                        <span style={{ marginLeft: 8, fontSize: 10, color: '#475569', verticalAlign: 'middle', userSelect: 'none' }}>
                          {isExp ? '▲' : '▶'}
                        </span>
                      </td>
                    </tr>
                    {isExp && (
                      <tr style={{ background: 'rgba(85,243,255,0.025)' }}>
                        <td colSpan={5} style={{ ...S.td, padding: '10px 14px 12px', borderTop: '1px solid rgba(85,243,255,0.08)' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px', fontSize: 11 }}>
                            {[
                              ['event_ts',    r.event_ts],
                              ['detected_at', r.detected_at],
                              ['asset',       r.asset_id],
                              ['namespace',   r.metric_ns],
                              ['metric',      r.metric],
                            ].map(([k, v]) => (
                              <span key={k}>
                                <span style={{ color: '#475569' }}>{k}</span>{' '}
                                <code style={{ color: '#cbd5e1', fontSize: 11 }}>{v}</code>
                              </span>
                            ))}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px', fontSize: 11, marginTop: 6 }}>
                            {[
                              ['baseline_avg', fmtNum(r.baseline_avg)],
                              ['baseline_std', r.baseline_std != null ? `±${r.baseline_std.toFixed(3)}` : '—'],
                              ['peak',         fmtNum(r.peak_value)],
                              ['z_score',      r.z_score != null ? `${r.z_score.toFixed(2)}σ` : '—'],
                              ['rel_change',   r.rel_change != null ? `${(r.rel_change * 100).toFixed(1)}%` : '—'],
                            ].map(([k, v]) => (
                              <span key={k}>
                                <span style={{ color: '#475569' }}>{k}</span>{' '}
                                <code style={{ color: '#a5f3fc', fontSize: 11 }}>{v}</code>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── ADMIN TAB ────────────────────────────────────────────────────────────────

const codeStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  padding: '1px 5px',
  borderRadius: 4,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
};

const preStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(140,160,255,0.15)',
  borderRadius: 10,
  padding: '12px 14px',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#a5f3fc',
  overflowX: 'auto',
  margin: 0,
  lineHeight: 1.6,
};

function AdminTab({ setTab }: { setTab: (t: Tab) => void }) {
  const [apiKey, setApiKey]         = React.useState(() => localStorage.getItem('orbit_api_key') ?? '');
  const [saved, setSaved]           = React.useState(false);
  const [apiProtected, setApiProtected] = React.useState<boolean | null>(null);
  const [checking, setChecking]     = React.useState(true);

  React.useEffect(() => {
    setChecking(true);
    // Unauthenticated fetch — no localStorage key used
    fetch('api/v1/catalog/assets?limit=1')
      .then(r => { setApiProtected(r.status === 401); })
      .catch(() => setApiProtected(null))
      .finally(() => setChecking(false));
  }, []);

  function saveKey() {
    localStorage.setItem('orbit_api_key', apiKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div>
      <div style={S.card}>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>{t('admin_title')}</div>
        <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13 }}>{t('admin_api_desc')}</div>
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>API Protection</div>
        {checking ? (
          <div style={{ color: '#64748b', fontSize: 13 }}>{t('admin_checking')}</div>
        ) : apiProtected === null ? (
          <div style={{ color: '#f87171', fontSize: 13 }}>{t('admin_api_check_err')}</div>
        ) : apiProtected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
            <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 13 }}>{t('admin_api_protected')}</span>
            <span style={{ color: '#64748b', fontSize: 12 }}>{t('admin_api_server_key')}</span>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f87171', display: 'inline-block' }} />
              <span style={{ color: '#f87171', fontWeight: 700, fontSize: 13 }}>{t('admin_api_open')}</span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{t('admin_api_no_auth')}</span>
            </div>
            <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.7 }}>
              Any request can read and ingest data without authentication.<br />
              {t('admin_api_protect_hint')}{' '}
              <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4 }}>ORBIT_API_KEY</code>
              {' '}{t('admin_api_protect_hint2')}
            </div>
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>API Key (client)</div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
          Key sent in this UI’s requests via header <code style={codeStyle}>X-Api-Key</code>.
          Persistida no <code style={codeStyle}>localStorage</code> do browser.
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            placeholder="ORBIT_API_KEY (deixe vazio se sem auth)"
            style={{ ...S.input, flex: 1 }}
          />
          <button onClick={saveKey} style={S.btnSm}>{saved ? t('saved') : t('save')}</button>
        </div>
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Configure server authentication</div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12, lineHeight: 1.7 }}>
          Authentication is controlled by the environment variable <code style={codeStyle}>ORBIT_API_KEY</code> in the API process.
          If not set, the API accepts any request without authentication.
        </div>

        <div style={{ fontWeight: 600, fontSize: 12, color: 'rgba(233,238,255,0.65)', marginBottom: 6 }}>systemd</div>
        <pre style={preStyle}>{`# /etc/systemd/system/orbit-core-api.service
[Service]
Environment=ORBIT_API_KEY=sua-chave-aqui

# Recarregar e reiniciar:
systemctl daemon-reload
systemctl restart orbit-core-api`}</pre>

        <div style={{ fontWeight: 600, fontSize: 12, color: 'rgba(233,238,255,0.65)', margin: '12px 0 6px' }}>Docker / docker-compose</div>
        <pre style={preStyle}>{`environment:
  - ORBIT_API_KEY=sua-chave-aqui`}</pre>

        <div style={{ fontWeight: 600, fontSize: 12, color: 'rgba(233,238,255,0.65)', margin: '12px 0 6px' }}>Manual</div>
        <pre style={preStyle}>{`ORBIT_API_KEY=sua-chave-aqui node dist/index.js`}</pre>
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Configurar connectors</div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12, lineHeight: 1.7 }}>
          All connectors support <code style={codeStyle}>ORBIT_API_KEY</code> via environment variable.
          When set, the header <code style={codeStyle}>X-Api-Key</code> is sent automatically in every request.
        </div>

        <div style={{ fontWeight: 600, fontSize: 12, color: 'rgba(233,238,255,0.65)', marginBottom: 6 }}>Nagios / Wazuh / n8n</div>
        <pre style={preStyle}>{`export ORBIT_API=http://seu-servidor:3000
export ORBIT_API_KEY=sua-chave-aqui
python3 ship_events.py`}</pre>

        <div style={{ fontWeight: 600, fontSize: 12, color: 'rgba(233,238,255,0.65)', margin: '12px 0 6px' }}>Fortigate</div>
        <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.7 }}>
          Uses the Wazuh connector (<code style={codeStyle}>ship_events.py</code>) — same configuration above.
        </div>
      </div>

      <AiConfigCard />

      <SourcesTab setTab={setTab} />
    </div>
  );
}

function AiConfigCard() {
  const [aiKey,   setAiKey]   = React.useState(() => localStorage.getItem('ai_api_key') ?? '');
  const [aiModel, setAiModel] = React.useState(() => localStorage.getItem('ai_model') ?? 'claude-sonnet-4-6');
  const [saved,   setSaved]   = React.useState(false);

  function save() {
    localStorage.setItem('ai_api_key', aiKey);
    localStorage.setItem('ai_model',   aiModel);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div style={S.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>AI Agent — Dashboard Builder</div>
      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12, lineHeight: 1.7 }}>
        Chave e modelo usados pelo AI agent ao gerar dashboards automaticamente.
        Persistidos no <code style={codeStyle}>localStorage</code> — enviados via headers <code style={codeStyle}>X-Ai-Key</code> / <code style={codeStyle}>X-Ai-Model</code>.
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={S.label}>
          Anthropic API Key
          <input
            type="password"
            value={aiKey}
            onChange={e => setAiKey(e.target.value)}
            placeholder="sk-ant-..."
            style={{ ...S.input, width: 280 }}
          />
        </label>
        <label style={S.label}>
          Modelo
          <select value={aiModel} onChange={e => setAiModel(e.target.value)} style={S.select}>
            <option value="claude-opus-4-6">claude-opus-4-6</option>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6 (recomendado)</option>
            <option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001</option>
          </select>
        </label>
        <button onClick={save} style={S.btnSm}>{saved ? t('saved') : t('save')}</button>
      </div>
    </div>
  );
}

function SourcesTab({ setTab }: { setTab: (t: Tab) => void }) {
  return (
    <div>
      <div style={S.card}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>Sources</div>
        <div style={{ color: 'rgba(233,238,255,0.78)', marginTop: 6, fontSize: 13 }}>
          Selecione uma fonte configurada para abrir o workspace.
        </div>
      </div>

      <div style={S.card}>
        <div className="orbit-grid-3">
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 900 }}>Nagios</div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, letterSpacing: '.05em' }}>{t('sources_active')}</span>
            </div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>{t('sources_nagios_desc')}</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 14 }}>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/nagios/README.md" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                📄 Manual
              </a>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/nagios/ship_events.py" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚙ Conector
              </a>
            </div>
            <div style={{ marginTop: 10 }}>
              <button style={S.btn} onClick={() => setTab('src-nagios')}>Open Nagios</button>
            </div>
          </div>
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 900 }}>Wazuh</div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, letterSpacing: '.05em' }}>{t('sources_active')}</span>
            </div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>{t('sources_wazuh_desc')}</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 14 }}>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/wazuh/README.md" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                📄 Manual
              </a>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/wazuh/ship_events.py" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚙ Conector
              </a>
            </div>
            <div style={{ marginTop: 10 }}>
              <button style={S.btn} onClick={() => setTab('events')}>{t('sources_view_events')}</button>
            </div>
          </div>
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 900 }}>Fortigate</div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, letterSpacing: '.05em' }}>{t('sources_active')}</span>
            </div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>Firewall logs via syslog → Wazuh → orbit-core</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 14 }}>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/fortigate/README.md" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                📄 Manual
              </a>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/wazuh/ship_events.py" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚙ Conector
              </a>
            </div>
            <div style={{ marginTop: 10 }}>
              <button style={S.btn} onClick={() => setTab('events')}>{t('sources_view_events')}</button>
            </div>
          </div>
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 900 }}>n8n</div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, letterSpacing: '.05em' }}>{t('sources_active')}</span>
            </div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>{t('sources_n8n_desc')}</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 14 }}>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/n8n/README.md" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                📄 Manual
              </a>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/n8n/ship_events.py" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚙ Conector
              </a>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/n8n/orbit_error_reporter.json" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚡ Plug-and-play
              </a>
            </div>
            <div style={{ marginTop: 10 }}>
              <button style={S.btn} onClick={() => setTab('events')}>{t('sources_view_events')}</button>
            </div>
          </div>
          <div style={S.card}>
            <div style={{ fontWeight: 900 }}>Explore</div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>Core metrics/events explorer</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button style={S.btnSm} onClick={() => setTab('metrics')}>Metrics</button>
              <button style={S.btnSm} onClick={() => setTab('events')}>Events</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD HELPERS ────────────────────────────────────────────────────────

function presetToRange(preset: string): { from: string; to: string } {
  const hours: Record<string, number> = { '60m': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720 };
  const h = hours[preset] ?? 24;
  return { from: relativeFrom(h), to: new Date().toISOString() };
}

// ─── DASHBOARD WIDGET RENDERER ────────────────────────────────────────────────

type WidgetSpec = {
  id: string;
  title: string;
  kind: string;
  layout: { x: number; y: number; w: number; h: number };
  query: Record<string, unknown>;
  note?: string;
};

function DashboardWidgetRenderer({ widget, from, to, assets }: { widget: WidgetSpec; from: string; to: string; assets: AssetOpt[] }) {
  const kind = widget.kind;

  if (kind === 'eps') {
    const ns = (widget.query.namespace as string) ?? '';
    return (
      <div style={{ gridColumn: `span ${widget.layout.w}` }}>
        <EpsChart namespace={ns} from={from} to={to} variant="chart-box" />
      </div>
    );
  }

  if (kind === 'events') {
    return <DashWidgetEvents widget={widget} from={from} to={to} />;
  }

  if (kind === 'timeseries_multi') {
    return <DashWidgetMulti widget={widget} from={from} to={to} assets={assets} />;
  }

  if (kind === 'kpi') {
    return <DashWidgetKpi widget={widget} from={from} to={to} assets={assets} />;
  }

  if (kind === 'gauge') {
    return <DashWidgetGauge widget={widget} from={from} to={to} assets={assets} />;
  }

  // default: timeseries
  return <DashWidgetTimeseries widget={widget} from={from} to={to} assets={assets} />;
}

function DashWidgetTimeseries({ widget, from, to, assets }: { widget: WidgetSpec; from: string; to: string; assets: AssetOpt[] }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const chartRef  = React.useRef<ReturnType<typeof makeNeLineChart>>(null);
  const [loading, setLoading] = React.useState(false);
  const [isEmpty, setIsEmpty] = React.useState(false);

  React.useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current = makeNeLineChart(canvasRef.current, 1);
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, []);

  React.useEffect(() => {
    setLoading(true);
    // timeseries requires asset_id — if missing, use first available asset
    let q: Record<string, unknown> = { ...widget.query, from, to };
    if (!q.asset_id && assets.length > 0) q.asset_id = assets[0].asset_id;
    if (!q.asset_id) { setIsEmpty(true); setLoading(false); return; }

    fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ query: q }) })
      .then(r => r.json())
      .then(j => {
        const rows: Row[] = j?.result?.rows ?? [];
        setIsEmpty(rows.length === 0);
        const chart = chartRef.current;
        if (!chart) return;
        (chart.data.labels as string[]) = rows.map(r => {
          const d = new Date(r.ts);
          return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        });
        chart.data.datasets[0].label = widget.title;
        chart.data.datasets[0].data  = rows.map(r => r.value);
        chart.update('none');
      })
      .catch(() => setIsEmpty(true))
      .finally(() => setLoading(false));
  }, [widget.id, from, to, assets]);

  return (
    <div className="orbit-chart-box" style={{ gridColumn: `span ${widget.layout.w}` }}>
      <div className="orbit-chart-tag">{widget.title}{loading ? ' · …' : ''}</div>
      <div className="orbit-chart-canvas-wrap">
        <canvas ref={canvasRef} style={{ display: isEmpty ? 'none' : 'block' }} />
        {isEmpty && !loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12 }}>
            {t('events_no_data')}
          </div>
        )}
      </div>
    </div>
  );
}

function DashWidgetMulti({ widget, from, to, assets }: { widget: WidgetSpec; from: string; to: string; assets: AssetOpt[] }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const chartRef  = React.useRef<ReturnType<typeof makeNeLineChart>>(null);
  const [loading, setLoading] = React.useState(false);
  const [isEmpty, setIsEmpty] = React.useState(false);

  React.useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current = makeNeLineChart(canvasRef.current, 6);
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, []);

  React.useEffect(() => {
    setLoading(true);

    // Build proper timeseries_multi query.
    // The AI may generate simplified format {namespace, metric, group_by} — convert to {series:[...]}.
    const wq = widget.query as Record<string, unknown>;
    if (!wq.series && assets.length === 0) { setIsEmpty(true); setLoading(false); return; }
    let q: Record<string, unknown>;
    if (wq.series) {
      // Already proper format
      q = { ...wq, from, to };
    } else {
      // Simplified format: build series from available assets
      const ns     = (wq.namespace as string) ?? '';
      const metric = (wq.metric    as string) ?? '';
      // Guard: if namespace or metric are empty, nothing to query
      if (!ns || !metric) { setIsEmpty(true); setLoading(false); return; }
      const filterAsset = wq.asset_id as string | undefined;
      const pool = filterAsset
        ? assets.filter(a => a.asset_id === filterAsset)
        : assets.slice(0, 20);
      q = {
        kind: 'timeseries_multi',
        from, to,
        series: pool.map(a => ({
          asset_id:  a.asset_id,
          namespace: ns,
          metric,
          label:     a.name ?? a.asset_id,
        })),
      };
    }

    fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ query: q }) })
      .then(r => r.json())
      .then(j => {
        const rows: MultiRow[] = j?.result?.rows ?? [];
        setIsEmpty(rows.length === 0);
        const chart = chartRef.current;
        if (!chart) return;

        // Group by series
        const bySeries = new Map<string, Array<{ ts: string; value: number }>>();
        for (const row of rows) {
          const arr = bySeries.get(row.series) ?? [];
          arr.push({ ts: row.ts, value: row.value });
          bySeries.set(row.series, arr);
        }
        const seriesKeys = Array.from(bySeries.keys());
        const allTs = Array.from(new Set(rows.map(r => r.ts))).sort();

        (chart.data.labels as string[]) = allTs.map(ts => {
          const d = new Date(ts);
          return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        });
        chart.data.datasets = seriesKeys.map((key, i) => {
          const pts = new Map((bySeries.get(key) ?? []).map(p => [p.ts, p.value]));
          const colors = ['#55f3ff', '#9b7cff', '#60a5fa', '#fbbf24', '#a3e635', '#fb7185'];
          return {
            label: key,
            data: allTs.map(ts => pts.get(ts) ?? null),
            borderColor: colors[i % colors.length],
            backgroundColor: 'rgba(0,0,0,0)',
            tension: 0.38,
            fill: false,
            pointRadius: 0,
          } as any;
        });
        chart.update('none');
      })
      .catch(() => setIsEmpty(true))
      .finally(() => setLoading(false));
  }, [widget.id, from, to, assets]);

  return (
    <div className="orbit-chart-box" style={{ gridColumn: `span ${widget.layout.w}` }}>
      <div className="orbit-chart-tag">{widget.title}{loading ? ' · …' : ''}</div>
      <div className="orbit-chart-canvas-wrap">
        <canvas ref={canvasRef} style={{ display: isEmpty ? 'none' : 'block' }} />
        {isEmpty && !loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12 }}>
            {t('events_no_data')}
          </div>
        )}
      </div>
    </div>
  );
}

function DashWidgetEvents({ widget, from, to }: { widget: WidgetSpec; from: string; to: string }) {
  const [events, setEvents] = React.useState<EventRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    const q = { ...widget.query, from, to, limit: widget.query.limit ?? 20 };
    fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ query: q }) })
      .then(r => r.json())
      .then(j => setEvents(j?.result?.rows ?? []))
      .catch(e => console.error("[orbit]", e))
      .finally(() => setLoading(false));
  }, [widget.id, from, to]);

  return (
    <div className="orbit-chart-box" style={{ gridColumn: `span ${widget.layout.w}`, height: 'auto', minHeight: 180 }}>
      <div className="orbit-chart-tag">{widget.title}{loading ? ' · …' : ''}</div>
      <div style={{ overflowY: 'auto', maxHeight: 280, paddingTop: 8 }}>
        {events.length === 0 && !loading && (
          <div style={{ color: '#64748b', fontSize: 12, padding: '12px 0' }}>{t('home_no_events')}</div>
        )}
        {events.map(e => <FeedRow key={e.ts + e.title} e={e} />)}
      </div>
    </div>
  );
}

function DashWidgetKpi({ widget, from, to, assets }: { widget: WidgetSpec; from: string; to: string; assets: AssetOpt[] }) {
  const [value, setValue] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    let q: Record<string, unknown> = { ...widget.query, from, to };
    if (!q.asset_id && assets.length > 0) q.asset_id = assets[0].asset_id;
    if (!q.asset_id) { setLoading(false); return; }
    fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ query: q }) })
      .then(r => r.json())
      .then(j => {
        const rows: Row[] = j?.result?.rows ?? [];
        setValue(rows.length ? rows[rows.length - 1].value : null);
      })
      .catch(e => console.error("[orbit]", e))
      .finally(() => setLoading(false));
  }, [widget.id, from, to, assets]);

  const display = loading ? '…' : value === null ? '—' : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(2);

  return (
    <div className="orbit-chart-box" style={{ gridColumn: `span ${widget.layout.w}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
      <div className="orbit-chart-tag">{widget.title}</div>
      <div style={{ fontSize: 42, fontWeight: 900, color: '#55f3ff', letterSpacing: '-0.02em', marginTop: 16 }}>{display}</div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{(widget.query.metric as string) ?? ''}</div>
    </div>
  );
}

function DashWidgetGauge({ widget, from, to, assets }: { widget: WidgetSpec; from: string; to: string; assets: AssetOpt[] }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const chartRef  = React.useRef<Chart | null>(null);
  const [value, setValue] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);

  const min = Number((widget.query as Record<string, unknown>).min ?? 0);
  const max = Number((widget.query as Record<string, unknown>).max ?? 100);

  function gaugeColor(pct: number): string {
    if (pct >= 0.75) return '#f87171';
    if (pct >= 0.50) return '#fbbf24';
    return '#4ade80';
  }

  // Create Chart.js doughnut (half-gauge) once
  React.useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    chartRef.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [0, 100],
          backgroundColor: ['#4ade80', 'rgba(140,160,255,.08)'],
          borderWidth: 0,
          borderRadius: 4,
        }] as any,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        circumference: 180,
        rotation: -90,
        cutout: '74%',
        animation: { duration: 600 },
        plugins: {
          legend:  { display: false },
          tooltip: { enabled: false },
        },
      },
    });
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, []);

  // Fetch last metric value
  React.useEffect(() => {
    setLoading(true);
    const wq = widget.query as Record<string, unknown>;
    let q: Record<string, unknown> = { ...wq, from, to };
    delete q.min; delete q.max;  // strip display-only fields before sending to API
    if (!q.asset_id && assets.length > 0) q.asset_id = assets[0].asset_id;
    if (!q.asset_id) { setLoading(false); return; }

    fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ query: q }) })
      .then(r => r.json())
      .then(j => {
        const rows: Row[] = j?.result?.rows ?? [];
        const v = rows.length ? rows[rows.length - 1].value : null;
        setValue(v);
        const chart = chartRef.current;
        if (!chart || v === null) return;
        const clampedV = Math.max(min, Math.min(max, v));
        const pct      = (clampedV - min) / (max - min);
        const color    = gaugeColor(pct);
        const filled   = pct * 100;
        chart.data.datasets[0].data = [filled, 100 - filled] as any;
        (chart.data.datasets[0] as any).backgroundColor = [color, 'rgba(140,160,255,.08)'];
        chart.update('none');
      })
      .catch(e => console.error("[orbit]", e))
      .finally(() => setLoading(false));
  }, [widget.id, from, to, assets]);

  const clampedV = value !== null ? Math.max(min, Math.min(max, value)) : null;
  const pct      = clampedV !== null ? (clampedV - min) / (max - min) : null;
  const color    = pct !== null ? gaugeColor(pct) : '#55f3ff';
  const display  = loading ? '…' : value === null ? '—'
    : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(1);

  return (
    <div className="orbit-chart-box" style={{ gridColumn: `span ${widget.layout.w}`, display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 150 }}>
      <div className="orbit-chart-tag">{widget.title}</div>
      <div style={{ position: 'relative', width: '100%', height: 110 }}>
        <canvas ref={canvasRef} />
        <div style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', textAlign: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 32, fontWeight: 900, color, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{display}</div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>{(widget.query as Record<string, unknown>).metric as string ?? ''}</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '80%', fontSize: 10, color: '#475569', marginTop: 2 }}>
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ─── DASHBOARDS TAB ───────────────────────────────────────────────────────────

type DashMode = 'list' | 'build' | 'view';

type SavedDashboard = {
  id: string;
  name: string;
  description?: string;
  time?: { preset: string };
  widget_count: number;
  updated_at: string;
};

type BuildWidget = {
  id: string;
  title: string;
  kind: string;
  namespace: string;
  metric: string;       // for timeseries_multi: comma-separated metrics
  assetId: string;
  severities: string;
  kindFilter: string;
  span: 1 | 2;
  gaugeMin: number;
  gaugeMax: number;
};

type EventNsCatalog = {
  namespace:  string;
  total:      number;
  last_seen:  string | null;
  kinds:      string[];
  agents:     string[];
  severities: string[];
};

const WIDGET_KINDS = ['timeseries', 'timeseries_multi', 'events', 'eps', 'kpi', 'gauge'];
const TIME_PRESETS = ['60m', '6h', '24h', '7d', '30d'];

function buildWidgetToSpec(w: BuildWidget): WidgetSpec {
  let query: Record<string, unknown> = {};

  if (w.kind === 'eps') {
    query = { kind: 'event_count', namespace: w.namespace };
  } else if (w.kind === 'events') {
    query = { kind: 'events', namespace: w.namespace, limit: 20 };
    if (w.assetId)    query.asset_id   = w.assetId;
    if (w.severities) query.severities = w.severities.split(',').map(s => s.trim()).filter(Boolean);
    if (w.kindFilter) query.kinds      = [w.kindFilter];
  } else if (w.kind === 'timeseries_multi') {
    const metrics = w.metric.split(',').map(m => m.trim()).filter(Boolean);
    if (w.assetId && w.namespace && metrics.length > 0) {
      // Single asset, one or more metrics → series format (e.g. load1, load5, load15)
      query = {
        kind: 'timeseries_multi',
        series: metrics.map(m => ({ asset_id: w.assetId, namespace: w.namespace, metric: m, label: m })),
      };
    } else {
      // Multi-asset: all assets, same namespace/metric (first metric only)
      query = { kind: 'timeseries_multi', namespace: w.namespace, metric: metrics[0] ?? w.metric, group_by: ['asset_id'] };
    }
  } else if (w.kind === 'gauge') {
    query = { kind: 'timeseries', namespace: w.namespace, metric: w.metric, min: w.gaugeMin, max: w.gaugeMax };
    if (w.assetId) query.asset_id = w.assetId;
  } else {
    // timeseries or kpi
    query = { kind: 'timeseries', namespace: w.namespace, metric: w.metric };
    if (w.assetId) query.asset_id = w.assetId;
  }

  return {
    id:     w.id,
    title:  w.title,
    kind:   w.kind,
    layout: { x: 0, y: 0, w: w.span, h: 1 },
    query,
  };
}

function DashboardsTab({ assets }: { assets: AssetOpt[] }) {
  const [mode, setMode]           = React.useState<DashMode>('list');
  const [dashboards, setDashboards] = React.useState<SavedDashboard[]>([]);
  const [viewSpec, setViewSpec]   = React.useState<any | null>(null);
  const [editSpec, setEditSpec]   = React.useState<any | null>(null);
  const [loading, setLoading]     = React.useState(false);

  // Rotation state
  const [rotating, setRotating]   = React.useState(false);
  const [rotIdx, setRotIdx]       = React.useState(0);
  const [rotInterval, setRotInterval] = React.useState(30);
  const [rotProgress, setRotProgress] = React.useState(0);
  const rotTimer  = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const rotTick   = React.useRef<ReturnType<typeof setInterval> | null>(null);

  function loadList() {
    setLoading(true);
    fetch('api/v1/dashboards', { headers: apiGetHeaders() })
      .then(r => r.json())
      .then(j => setDashboards(j?.dashboards ?? []))
      .catch(e => console.error("[orbit]", e))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    if (mode === 'list') loadList();
  }, [mode]);

  // Rotation ticker
  React.useEffect(() => {
    if (!rotating || dashboards.length < 2) return;

    const totalMs = rotInterval * 1000;
    const tickMs  = 200;
    let elapsed   = 0;
    setRotProgress(0);

    rotTick.current = setInterval(() => {
      elapsed += tickMs;
      setRotProgress(Math.min(100, (elapsed / totalMs) * 100));
    }, tickMs);

    rotTimer.current = setInterval(() => {
      setRotIdx(i => (i + 1) % dashboards.length);
      elapsed = 0;
      setRotProgress(0);
    }, totalMs);

    return () => {
      if (rotTimer.current) clearInterval(rotTimer.current);
      if (rotTick.current)  clearInterval(rotTick.current);
    };
  }, [rotating, rotInterval, dashboards.length]);

  function startRotation() {
    if (dashboards.length === 0) return;
    setRotIdx(0);
    setRotating(true);
    // open the first dashboard
    const first = dashboards[0];
    fetch(`api/v1/dashboards/${first.id}`, { headers: apiGetHeaders() })
      .then(r => r.json())
      .then(j => { setViewSpec(j.spec); setMode('view'); })
      .catch(e => console.error("[orbit]", e));
  }

  function stopRotation() {
    setRotating(false);
    setRotProgress(0);
    if (rotTimer.current) clearInterval(rotTimer.current);
    if (rotTick.current)  clearInterval(rotTick.current);
  }

  // When rotation advances, load the new dashboard
  React.useEffect(() => {
    if (!rotating || dashboards.length === 0) return;
    const d = dashboards[rotIdx % dashboards.length];
    if (!d) return;
    fetch(`api/v1/dashboards/${d.id}`, { headers: apiGetHeaders() })
      .then(r => r.json())
      .then(j => setViewSpec(j.spec))
      .catch(e => console.error("[orbit]", e));
  }, [rotIdx, rotating]);

  async function openView(id: string) {
    const j = await fetch(`api/v1/dashboards/${id}`, { headers: apiGetHeaders() }).then(r => r.json());
    setViewSpec(j.spec);
    setMode('view');
  }

  async function openEdit(id: string) {
    const j = await fetch(`api/v1/dashboards/${id}`, { headers: apiGetHeaders() }).then(r => r.json());
    setEditSpec(j.spec);
    setMode('build');
  }

  async function deleteDash(id: string) {
    if (!confirm(t('dash_confirm_del'))) return;
    await fetch(`api/v1/dashboards/${id}`, { method: 'DELETE', headers: apiGetHeaders() });
    loadList();
  }

  if (mode === 'view' && viewSpec) {
    return (
      <DashboardView
        spec={viewSpec}
        rotating={rotating}
        rotProgress={rotProgress}
        rotIdx={rotIdx}
        rotTotal={dashboards.length}
        onBack={() => { stopRotation(); setMode('list'); }}
        onEdit={() => { setEditSpec(viewSpec); setMode('build'); }}
        onStopRotation={stopRotation}
        assets={assets}
      />
    );
  }

  if (mode === 'build') {
    return (
      <DashboardBuilder
        assets={assets}
        initialSpec={editSpec}
        onCancel={() => { setEditSpec(null); setMode('list'); }}
        onSaved={() => { setEditSpec(null); setMode('list'); }}
      />
    );
  }

  // LIST mode
  return (
    <div>
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>⊞ Dashboards</div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 4 }}>
              {t('dash_desc')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Rotation controls */}
            <label style={{ ...S.label, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(233,238,255,.65)' }}>Intervalo</span>
              <select
                value={rotInterval}
                onChange={e => setRotInterval(Number(e.target.value))}
                style={{ ...S.select, padding: '5px 8px', fontSize: 12 }}
              >
                <option value={15}>15s</option>
                <option value={30}>30s</option>
                <option value={60}>1min</option>
                <option value={300}>5min</option>
              </select>
            </label>
            <button
              onClick={startRotation}
              disabled={dashboards.length < 2}
              style={{ ...S.btnSm, opacity: dashboards.length < 2 ? 0.4 : 1 }}
            >
              ▶ Rotation
            </button>
            <button
              onClick={() => { setEditSpec(null); setMode('build'); }}
              style={S.btn}
            >
              + Criar Dashboard
            </button>
          </div>
        </div>
      </div>

      {loading && <div style={{ color: '#64748b', fontSize: 13, padding: '8px 0' }}>Carregando…</div>}

      {!loading && dashboards.length === 0 && (
        <div style={{ ...S.card, textAlign: 'center', color: '#64748b', padding: 40 }}>
          No dashboards saved yet.<br />
          <button onClick={() => { setEditSpec(null); setMode('build'); }} style={{ ...S.btn, marginTop: 16 }}>
            Criar o primeiro dashboard
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {dashboards.map(d => (
          <div key={d.id} style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{d.name}</div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {d.time?.preset ?? '24h'}
              </span>
            </div>
            {d.description && (
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>{d.description}</div>
            )}
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
              {d.widget_count} widget{d.widget_count !== 1 ? 's' : ''} · {new Date(d.updated_at).toLocaleDateString()}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => openView(d.id)} style={S.btn}>Abrir</button>
              <button onClick={() => openEdit(d.id)} style={S.btnSm}>✎ Editar</button>
              <button onClick={() => deleteDash(d.id)} style={{ ...S.btnSm, borderColor: 'rgba(248,113,113,.35)', color: '#f87171' }}>× Deletar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardView({ spec, rotating, rotProgress, rotIdx, rotTotal, onBack, onEdit, onStopRotation, assets }: {
  spec: any;
  rotating: boolean;
  rotProgress: number;
  rotIdx: number;
  rotTotal: number;
  onBack: () => void;
  onEdit: () => void;
  onStopRotation: () => void;
  assets: AssetOpt[];
}) {
  const { from, to } = presetToRange(spec?.time?.preset ?? '24h');
  const widgets: WidgetSpec[] = spec?.widgets ?? [];
  const maxW = Math.max(...widgets.map((w: WidgetSpec) => w.layout?.w ?? 1), 2);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={S.btnSm}>← Voltar</button>
        <div style={{ fontWeight: 900, fontSize: 18, flex: 1 }}>{spec?.name ?? 'Dashboard'}</div>
        <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700 }}>
          {spec?.time?.preset ?? '24h'}
        </span>
        <button onClick={onEdit} style={S.btnSm}>✎ Editar</button>
        {rotating && (
          <button onClick={onStopRotation} style={{ ...S.btnSm, borderColor: 'rgba(248,113,113,.35)', color: '#f87171' }}>
            ⏹ Stop rotation
          </button>
        )}
      </div>

      {/* Rotation indicator */}
      {rotating && (
        <div style={{ marginBottom: 14, background: 'rgba(85,243,255,0.06)', border: '1px solid rgba(85,243,255,.18)', borderRadius: 10, padding: '8px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#55f3ff', marginBottom: 6 }}>
            <span>▶ Rotation ativa</span>
            <span>{rotIdx + 1} / {rotTotal}</span>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${rotProgress}%`, background: '#55f3ff', borderRadius: 99, transition: 'width 0.2s linear' }} />
          </div>
        </div>
      )}

      {/* Grid */}
      <div
        className="orbit-charts-grid"
        style={{ '--cols': maxW } as React.CSSProperties}
      >
        {widgets.map(widget => (
          <DashboardWidgetRenderer key={widget.id} widget={widget} from={from} to={to} assets={assets} />
        ))}
      </div>
    </div>
  );
}

function DashboardBuilder({ assets, initialSpec, onCancel, onSaved }: {
  assets: AssetOpt[];
  initialSpec: any | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName]             = React.useState(initialSpec?.name ?? '');
  const [desc, setDesc]             = React.useState(initialSpec?.description ?? '');
  const [preset, setPreset]         = React.useState<string>(initialSpec?.time?.preset ?? '24h');
  const [widgets, setWidgets]       = React.useState<BuildWidget[]>(() => {
    if (!initialSpec?.widgets) return [];
    return (initialSpec.widgets as WidgetSpec[]).map(w => ({
      id:         w.id,
      title:      w.title,
      kind:       w.kind,
      namespace:  (w.query.namespace as string) ?? '',
      metric:     (w.query.metric as string) ?? '',
      assetId:    (w.query.asset_id as string) ?? '',
      severities: Array.isArray(w.query.severities) ? (w.query.severities as string[]).join(', ') : '',
      kindFilter: Array.isArray(w.query.kinds) ? (w.query.kinds as string[])[0] ?? '' : '',
      span:       (w.layout.w as 1 | 2) ?? 1,
      gaugeMin:   (w.query.gauge_min as number) ?? 0,
      gaugeMax:   (w.query.gauge_max as number) ?? 100,
    }));
  });

  // Add widget form
  const [newKind,       setNewKind]       = React.useState('timeseries');
  const [newTitle,      setNewTitle]      = React.useState('');
  const [newNs,         setNewNs]         = React.useState('');
  const [newMetric,     setNewMetric]     = React.useState('');
  const [newAsset,      setNewAsset]      = React.useState('');
  const [newSev,        setNewSev]        = React.useState('');
  const [newKindFilter, setNewKindFilter] = React.useState('');
  const [newSpan,       setNewSpan]       = React.useState<1 | 2>(1);
  const [newGaugeMin,   setNewGaugeMin]   = React.useState(0);
  const [newGaugeMax,   setNewGaugeMax]   = React.useState(100);

  // Catalog
  const [nsOpts,      setNsOpts]      = React.useState<string[]>([]);
  const [metricOpts,  setMetricOpts]  = React.useState<MetricOpt[]>([]);
  const [eventCatalog,setEventCatalog]= React.useState<EventNsCatalog[]>([]);

  React.useEffect(() => {
    // Event namespaces catalog
    fetch('api/v1/catalog/events', { headers: apiGetHeaders() })
      .then(r => r.json())
      .then(j => setEventCatalog((j?.namespaces ?? []) as EventNsCatalog[]))
      .catch(e => console.error("[orbit]", e));

    // Metrics catalog — ALL assets (batched in parallel)
    if (assets.length) {
      Promise.all(
        assets.map(a =>
          fetch(`api/v1/catalog/metrics?asset_id=${encodeURIComponent(a.asset_id)}&limit=200`, { headers: apiGetHeaders() })
            .then(r => r.json())
            .then(j => (j?.metrics ?? []) as MetricOpt[])
            .catch(() => [] as MetricOpt[])
        )
      ).then(results => {
        const merged = results.flat();
        const seen = new Set<string>();
        const deduped = merged.filter(m => {
          const k = `${m.namespace}:${m.metric}`;
          if (seen.has(k)) return false;
          seen.add(k); return true;
        });
        setMetricOpts(deduped);
        // Merge metric namespaces + event namespaces into combined list
        const metricNs = Array.from(new Set(deduped.map(m => m.namespace)));
        setNsOpts(prev => {
          const combined = Array.from(new Set([...metricNs, ...prev]));
          return combined;
        });
      });
    }
  }, [assets.length]);

  // Keep nsOpts in sync when eventCatalog loads
  React.useEffect(() => {
    if (eventCatalog.length === 0) return;
    const evNs = eventCatalog.map(e => e.namespace);
    setNsOpts(prev => Array.from(new Set([...prev, ...evNs])));
  }, [eventCatalog.length]);

  // AI state
  const [aiPrompt, setAiPrompt]     = React.useState('');
  const [aiLoading, setAiLoading]   = React.useState(false);
  const [aiError, setAiError]       = React.useState<string | null>(null);

  // Save state
  const [saving, setSaving]         = React.useState(false);
  const [saveErr, setSaveErr]       = React.useState<string | null>(null);

  async function generateWithAI() {
    const aiKey   = localStorage.getItem('ai_api_key') ?? '';
    const aiModel = localStorage.getItem('ai_model') ?? 'claude-sonnet-4-6';
    if (!aiKey) {
      setAiError(t('alerts_no_api_key'));
      return;
    }
    setAiLoading(true); setAiError(null);
    try {
      const r = await fetch('api/v1/ai/dashboard', {
        method: 'POST',
        headers: { ...apiHeaders(), 'x-ai-key': aiKey, 'x-ai-model': aiModel },
        body: JSON.stringify({ prompt: aiPrompt }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      const spec = j.spec;
      // Populate form from AI spec
      setName(spec.name ?? '');
      setDesc(spec.description ?? '');
      setPreset(spec.time?.preset ?? '24h');
      setWidgets((spec.widgets as WidgetSpec[]).map(w => ({
        id:         w.id,
        title:      w.title,
        kind:       w.kind,
        namespace:  (w.query.namespace as string) ?? '',
        metric:     (w.query.metric as string) ?? '',
        assetId:    (w.query.asset_id as string) ?? '',
        severities: Array.isArray(w.query.severities) ? (w.query.severities as string[]).join(', ') : '',
        kindFilter: Array.isArray(w.query.kinds) ? (w.query.kinds as string[])[0] ?? '' : '',
        span:       (w.layout.w as 1 | 2),
        gaugeMin:   (w.query.gauge_min as number) ?? 0,
        gaugeMax:   (w.query.gauge_max as number) ?? 100,
      })));
    } catch (e: any) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  }

  function addWidget() {
    if (!newTitle.trim()) return;
    const needsMetric = ['timeseries', 'timeseries_multi', 'kpi', 'gauge'].includes(newKind);
    const needsNs     = ['timeseries', 'timeseries_multi', 'kpi', 'gauge', 'eps', 'events'].includes(newKind);
    if (needsNs     && !newNs.trim())     return;
    if (needsMetric && !newMetric.trim()) return;
    const w: BuildWidget = {
      id:         `w-${Date.now()}`,
      title:      newTitle.trim(),
      kind:       newKind,
      namespace:  newNs,
      metric:     newMetric,
      assetId:    newAsset,
      severities: newSev,
      kindFilter: newKindFilter,
      span:       newSpan,
      gaugeMin:   newGaugeMin,
      gaugeMax:   newGaugeMax,
    };
    setWidgets(prev => [...prev, w]);
    setNewTitle('');
    setNewKindFilter('');
  }

  function removeWidget(id: string) {
    setWidgets(prev => prev.filter(w => w.id !== id));
  }

  async function save() {
    if (!name.trim()) { setSaveErr(t('dash_name_required')); return; }
    if (widgets.length === 0) { setSaveErr(t('dash_widget_required')); return; }

    const specId = initialSpec?.id ?? `dash-${Date.now()}`;
    const spec = {
      id:          specId,
      name:        name.trim(),
      description: desc.trim() || undefined,
      version:     'v1',
      time:        { preset },
      tags:        [] as string[],
      widgets:     widgets.map(buildWidgetToSpec),
    };

    setSaving(true); setSaveErr(null);
    try {
      const method = initialSpec ? 'PUT' : 'POST';
      const url    = initialSpec ? `api/v1/dashboards/${specId}` : 'api/v1/dashboards';
      const r = await fetch(url, { method, headers: apiHeaders(), body: JSON.stringify(spec) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      onSaved();
    } catch (e: any) {
      setSaveErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  const filteredMetrics = metricOpts.filter(m => !newNs || m.namespace === newNs);

  return (
    <div>
      {/* Header bar */}
      <div style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={S.label}>
          Nome
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Meu Dashboard" style={{ ...S.input, minWidth: 180 }} />
        </label>
        <label style={S.label}>
          Description
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder={t('optional')} style={{ ...S.input, minWidth: 220 }} />
        </label>
        <label style={S.label}>
          Time preset
          <select value={preset} onChange={e => setPreset(e.target.value)} style={S.select}>
            {TIME_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <button onClick={save} disabled={saving} style={S.btn}>{saving ? t('saving') : t('save')}</button>
        <button onClick={onCancel} style={S.btnSm}>Cancelar</button>
      </div>
      {saveErr && <div style={S.err}>{saveErr}</div>}

      {/* AI section */}
      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>✦ AI Assistant</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <textarea
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            placeholder="Describe the dashboard you want to create… ex: monitor CPU and memory of nagios servers and show EPS from wazuh"
            style={{ ...S.input, flex: 1, minHeight: 64, resize: 'vertical' as const }}
          />
          <button
            onClick={generateWithAI}
            disabled={aiLoading || !aiPrompt.trim()}
            style={{ ...S.btn, whiteSpace: 'nowrap' }}
          >
            {aiLoading ? '…generating' : '⚡ Generate with AI'}
          </button>
        </div>
        {aiError && <div style={S.err}>{aiError}</div>}
        {aiLoading && (
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Consultando Claude…</div>
        )}
      </div>

      {/* Add widget manually */}
      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>+ Adicionar Widget</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={S.label}>
            Kind
            <select value={newKind} onChange={e => setNewKind(e.target.value)} style={S.select}>
              {WIDGET_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label style={S.label}>
            Title
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="ex: CPU Usage" style={{ ...S.input, width: 160 }} />
          </label>
          <label style={S.label}>
            Namespace
            <select value={newNs} onChange={e => { setNewNs(e.target.value); setNewKindFilter(''); setNewSev(''); }} style={S.select}>
              <option value="">— qualquer —</option>
              {nsOpts.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {(newKind === 'timeseries' || newKind === 'timeseries_multi' || newKind === 'kpi' || newKind === 'gauge') && (
            <label style={S.label}>
              {newKind === 'timeseries_multi' ? t('metrics_csv') : t('metric')}
              {newKind === 'timeseries_multi' ? (
                <input
                  value={newMetric}
                  onChange={e => setNewMetric(e.target.value)}
                  placeholder="ex: load1, load5, load15"
                  style={{ ...S.input, width: 200 }}
                />
              ) : (
                <select value={newMetric} onChange={e => setNewMetric(e.target.value)} style={S.select}>
                  <option value="">— selecione —</option>
                  {filteredMetrics.map(m => (
                    <option key={`${m.namespace}:${m.metric}`} value={m.metric}>{m.metric}</option>
                  ))}
                </select>
              )}
            </label>
          )}
          {newKind === 'gauge' && (
            <>
              <label style={S.label}>
                Min
                <input type="number" value={newGaugeMin} onChange={e => setNewGaugeMin(Number(e.target.value))} style={{ ...S.input, width: 64 }} />
              </label>
              <label style={S.label}>
                Max
                <input type="number" value={newGaugeMax} onChange={e => setNewGaugeMax(Number(e.target.value))} style={{ ...S.input, width: 64 }} />
              </label>
            </>
          )}
          {(newKind === 'timeseries' || newKind === 'timeseries_multi' || newKind === 'events' || newKind === 'gauge') && (
            <label style={S.label}>
              Asset {newKind === 'timeseries_multi' ? '(opcional)' : ''}
              <select value={newAsset} onChange={e => setNewAsset(e.target.value)} style={S.select}>
                <option value="">— todos —</option>
                {(newKind === 'events' && newNs
                  ? (eventCatalog.find(e => e.namespace === newNs)?.agents ?? assets.map(a => ({ asset_id: a.asset_id, name: a.name })))
                  : assets
                ).map((a: any) => <option key={a.asset_id ?? a} value={a.asset_id ?? a}>{a.name ?? a.asset_id ?? a}</option>)}
              </select>
            </label>
          )}
          {(newKind === 'events' || newKind === 'eps') && (() => {
            const evNs = eventCatalog.find(e => e.namespace === newNs);
            return (
              <>
                {evNs && evNs.kinds.length > 0 && (
                  <label style={S.label}>
                    Tipo evento
                    <select value={newKindFilter} onChange={e => setNewKindFilter(e.target.value)} style={S.select}>
                      <option value="">— todos —</option>
                      {evNs.kinds.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </label>
                )}
                {newKind === 'events' && evNs && evNs.severities.length > 0 && (
                  <label style={S.label}>
                    Severidade
                    <select value={newSev} onChange={e => setNewSev(e.target.value)} style={S.select}>
                      <option value="">— todas —</option>
                      <option value="critical,high">critical + high</option>
                      <option value="medium,high,critical">medium + high + critical</option>
                      {evNs.severities.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                )}
              </>
            );
          })()}
          <label style={S.label}>
            Span
            <select value={newSpan} onChange={e => setNewSpan(Number(e.target.value) as 1 | 2)} style={S.select}>
              <option value={1}>1 — metade</option>
              <option value={2}>2 — inteiro</option>
            </select>
          </label>
          <button onClick={addWidget} style={S.btn}>Adicionar</button>
        </div>
      </div>

      {/* Widget list */}
      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
          Widgets ({widgets.length})
        </div>
        {widgets.length === 0 && (
          <div style={{ color: '#64748b', fontSize: 13 }}>No widgets added yet.</div>
        )}
        {widgets.map(w => (
          <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(140,160,255,.10)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.10)', color: '#55f3ff', fontWeight: 700 }}>{w.kind}</span>
            <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{w.title}</span>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {[w.namespace, w.metric, w.assetId, w.kindFilter ? `kind:${w.kindFilter}` : '', w.severities ? `sev:${w.severities}` : ''].filter(Boolean).join(' · ')}
            </span>
            <span style={{ fontSize: 11, color: '#64748b' }}>span:{w.span}</span>
            <button onClick={() => removeWidget(w.id)} style={{ ...S.btnSm, borderColor: 'rgba(248,113,113,.35)', color: '#f87171', padding: '4px 8px' }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ALERTS TAB ───────────────────────────────────────────────────────────────

type AlertChannel = { id: string; name: string; kind: string; created_at: string };
type AlertRule = {
  id: number; name: string; enabled: boolean;
  asset_id: string | null; namespace: string | null; metric: string | null;
  condition: any; severity: string; channels: string[];
  state: string; fired_at: string | null; last_value: number | null;
  silence_until: string | null; created_at: string;
};
type AlertNotif = { id: number; rule_id: number; rule_name: string; channel_id: string; event: string; ok: boolean; error: string | null; sent_at: string };

function AlertsTab({ assets }: { assets: AssetOpt[] }) {
  const [subtab, setSubtab]       = React.useState<'rules' | 'channels' | 'history'>('rules');
  const [rules, setRules]         = React.useState<AlertRule[]>([]);
  const [channels, setChannels]   = React.useState<AlertChannel[]>([]);
  const [history, setHistory]     = React.useState<AlertNotif[]>([]);
  const [loading, setLoading]     = React.useState(false);
  const [err, setErr]             = React.useState<string | null>(null);
  const [toast, setToast]         = React.useState<{ msg: string; ok: boolean } | null>(null);

  // — new rule form —
  const [showRuleForm, setShowRuleForm] = React.useState(false);
  const [rf, setRf] = React.useState({
    name: '', asset_id: '', namespace: '', metric: '',
    condKind: 'threshold' as 'threshold' | 'absence',
    op: '>' as string, condValue: '', windowMin: '5', agg: 'avg',
    severity: 'medium', selectedChannels: [] as string[],
  });

  // — expand state —
  const [expandedRuleId, setExpandedRuleId] = React.useState<number | null>(null);

  // — new channel form —
  const [showChForm, setShowChForm]   = React.useState(false);
  const [cf, setCf] = React.useState({
    id: '', name: '', kind: 'webhook' as 'webhook' | 'telegram',
    url: '', headers: '', bot_token: '', chat_id: '',
  });

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  async function loadRules() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('api/v1/alerts/rules', { headers: apiGetHeaders() });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setRules(j.rules);
    } catch (e: any) { setErr(String(e)); } finally { setLoading(false); }
  }

  async function loadChannels() {
    try {
      const r = await fetch('api/v1/alerts/channels', { headers: apiGetHeaders() });
      const j = await r.json();
      if (j.ok) setChannels(j.channels);
    } catch {}
  }

  async function loadHistory() {
    try {
      const r = await fetch('api/v1/alerts/history', { headers: apiGetHeaders() });
      const j = await r.json();
      if (j.ok) setHistory(j.notifications);
    } catch {}
  }

  React.useEffect(() => {
    loadRules();
    loadChannels();
    loadHistory();
  }, []);

  async function toggleRule(rule: AlertRule) {
    await fetch(`api/v1/alerts/rules/${rule.id}`, {
      method: 'PATCH', headers: apiHeaders(),
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    loadRules();
  }

  async function silenceRule(rule: AlertRule) {
    const until = new Date(Date.now() + 3600_000).toISOString();
    await fetch(`api/v1/alerts/rules/${rule.id}`, {
      method: 'PATCH', headers: apiHeaders(),
      body: JSON.stringify({ silence_until: until }),
    });
    showToast('Regra silenciada por 1h', true);
    loadRules();
  }

  async function deleteRule(id: number) {
    if (!confirm(t('alerts_confirm_delete'))) return;
    await fetch(`api/v1/alerts/rules/${id}`, { method: 'DELETE', headers: apiGetHeaders() });
    loadRules();
  }

  async function saveRule() {
    const condition = rf.condKind === 'threshold'
      ? { kind: 'threshold', op: rf.op, value: parseFloat(rf.condValue), window_min: parseInt(rf.windowMin), agg: rf.agg }
      : { kind: 'absence', window_min: parseInt(rf.windowMin) };
    const body: any = {
      name: rf.name, enabled: true, condition,
      severity: rf.severity, channels: rf.selectedChannels,
    };
    if (rf.asset_id)  body.asset_id  = rf.asset_id;
    if (rf.namespace) body.namespace = rf.namespace;
    if (rf.metric)    body.metric    = rf.metric;

    const r = await fetch('api/v1/alerts/rules', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) { showToast('Error: ' + JSON.stringify(j.error), false); return; }
    showToast('Regra criada!', true);
    setShowRuleForm(false);
    setRf({ name: '', asset_id: '', namespace: '', metric: '', condKind: 'threshold', op: '>', condValue: '', windowMin: '5', agg: 'avg', severity: 'medium', selectedChannels: [] });
    loadRules();
  }

  async function deleteChannel(id: string) {
    if (!confirm('Remove this channel?')) return;
    await fetch(`api/v1/alerts/channels/${id}`, { method: 'DELETE', headers: apiGetHeaders() });
    loadChannels();
  }

  async function testChannel(id: string) {
    const r = await fetch(`api/v1/alerts/channels/${id}/test`, { method: 'POST', headers: apiHeaders() });
    const j = await r.json();
    showToast(j.ok ? t('alerts_notif_ok') : '✗ Error: ' + j.error, j.ok);
  }

  async function saveChannel() {
    const config = cf.kind === 'webhook'
      ? { url: cf.url, ...(cf.headers.trim() ? { headers: JSON.parse(cf.headers) } : {}) }
      : { bot_token: cf.bot_token, chat_id: cf.chat_id };
    const body = { id: cf.id, name: cf.name, kind: cf.kind, config };
    const r = await fetch('api/v1/alerts/channels', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) { showToast('Error: ' + JSON.stringify(j.error), false); return; }
    showToast('Canal salvo!', true);
    setShowChForm(false);
    setCf({ id: '', name: '', kind: 'webhook', url: '', headers: '', bot_token: '', chat_id: '' });
    loadChannels();
  }

  function conditionText(rule: AlertRule) {
    const c = rule.condition;
    if (c.kind === 'threshold') return `${c.agg ?? 'avg'} ${c.op} ${c.value} (${c.window_min}min)`;
    if (c.kind === 'absence')   return `absence ${c.window_min}min`;
    return JSON.stringify(c);
  }

  function stateBadge(rule: AlertRule) {
    const silenced = rule.silence_until && new Date(rule.silence_until) > new Date();
    if (!rule.enabled) return <span style={{ background: '#1e293b', color: '#64748b', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{t('alerts_state_disabled')}</span>;
    if (silenced)      return <span style={{ background: '#1c1c1c', color: '#94a3b8', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{t('alerts_state_silenced')}</span>;
    if (rule.state === 'firing') return <span style={{ background: '#450a0a', color: '#f87171', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>FIRING</span>;
    return <span style={{ background: '#052e16', color: '#4ade80', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>OK</span>;
  }

  const subtabBtn = (t: 'rules' | 'channels' | 'history', label: string) => (
    <button onClick={() => setSubtab(t)} style={{
      background: subtab === t ? 'rgba(85,243,255,0.15)' : 'transparent',
      border: subtab === t ? '1px solid rgba(85,243,255,0.4)' : '1px solid transparent',
      borderRadius: 8, color: subtab === t ? '#55f3ff' : '#94a3b8',
      padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    }}>{label}</button>
  );

  return (
    <div>
      {toast && (
        <div style={{ position: 'fixed', top: 18, right: 24, zIndex: 9999, padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: toast.ok ? '#052e16' : '#450a0a', color: toast.ok ? '#4ade80' : '#f87171', border: `1px solid ${toast.ok ? '#4ade80' : '#f87171'}`, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
          {toast.msg}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {subtabBtn('rules',    t('alerts_subtab_rules'))}
        {subtabBtn('channels', t('alerts_subtab_channels'))}
        {subtabBtn('history',  t('alerts_subtab_history'))}
      </div>

      {/* ── RULES ─────────────────────────────────────────────────────────── */}
      {subtab === 'rules' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>{t('alerts_rules_count').replace('{n}', String(rules.length))}</span>
            <button onClick={() => setShowRuleForm(x => !x)} style={{ ...S.btn, padding: '7px 16px', fontSize: 13 }}>
              {showRuleForm ? t('alerts_cancel_rule') : t('alerts_new_rule')}
            </button>
          </div>

          {showRuleForm && (
            <div style={{ ...S.card, marginBottom: 16, border: '1px solid rgba(85,243,255,0.25)' }}>
              <div style={{ fontWeight: 700, color: '#55f3ff', marginBottom: 12, fontSize: 14 }}>{t('alerts_form_title')}</div>
              <div className="orbit-grid-4" style={{ marginBottom: 10 }}>
                <label style={S.label}>Nome<input style={S.input} value={rf.name} onChange={e => setRf(p => ({ ...p, name: e.target.value }))} placeholder={t('alerts_name_ph')} /></label>
                <label style={S.label}>Asset<input style={S.input} value={rf.asset_id} onChange={e => setRf(p => ({ ...p, asset_id: e.target.value }))} placeholder={t('alerts_asset_ph')} /></label>
                <label style={S.label}>Namespace<input style={S.input} value={rf.namespace} onChange={e => setRf(p => ({ ...p, namespace: e.target.value }))} placeholder={t('alerts_ns_ph')} /></label>
                <label style={S.label}>Metric<input style={S.input} value={rf.metric} onChange={e => setRf(p => ({ ...p, metric: e.target.value }))} placeholder="cpu (empty=all)" /></label>
              </div>
              <div className="orbit-grid-4" style={{ marginBottom: 10 }}>
                <label style={S.label}>{t('alerts_cond_type')}
                  <select style={S.select} value={rf.condKind} onChange={e => setRf(p => ({ ...p, condKind: e.target.value as any }))}>
                    <option value="threshold">{t('alerts_cond_threshold')}</option>
                    <option value="absence">{t('alerts_cond_nodata')}</option>
                  </select>
                </label>
                {rf.condKind === 'threshold' && <>
                  <label style={S.label}>{t('operator')}
                    <select style={S.select} value={rf.op} onChange={e => setRf(p => ({ ...p, op: e.target.value }))}>
                      {['>', '>=', '<', '<='].map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label style={S.label}>{t('value')}<input style={S.input} type="number" value={rf.condValue} onChange={e => setRf(p => ({ ...p, condValue: e.target.value }))} placeholder="80" /></label>
                  <label style={S.label}>{t('alerts_aggregation')}
                    <select style={S.select} value={rf.agg} onChange={e => setRf(p => ({ ...p, agg: e.target.value }))}>
                      <option value="avg">avg</option>
                      <option value="max">max</option>
                    </select>
                  </label>
                </>}
              </div>
              <div className="orbit-grid-4" style={{ marginBottom: 12 }}>
                <label style={S.label}>{t('alerts_window_min')}<input style={S.input} type="number" value={rf.windowMin} onChange={e => setRf(p => ({ ...p, windowMin: e.target.value }))} placeholder="5" /></label>
                <label style={S.label}>{t('severity')}
                  <select style={S.select} value={rf.severity} onChange={e => setRf(p => ({ ...p, severity: e.target.value }))}>
                    {['info','low','medium','high','critical'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label style={{ ...S.label, gridColumn: 'span 2' }}>{t('channels')}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    {channels.length === 0 && <span style={{ color: '#64748b', fontSize: 12 }}>{t('alerts_no_channels')}</span>}
                    {channels.map(ch => (
                      <label key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
                        <input type="checkbox" checked={rf.selectedChannels.includes(ch.id)}
                          onChange={e => setRf(p => ({ ...p, selectedChannels: e.target.checked ? [...p.selectedChannels, ch.id] : p.selectedChannels.filter(x => x !== ch.id) }))} />
                        {ch.name} <span style={{ color: '#64748b' }}>({ch.kind})</span>
                      </label>
                    ))}
                  </div>
                </label>
              </div>
              <button onClick={saveRule} style={{ ...S.btn, padding: '8px 20px' }}>{t('alerts_save_rule')}</button>
            </div>
          )}

          {err && <div style={S.err}>{err}</div>}
          {loading && <div style={{ color: '#94a3b8', fontSize: 13, padding: 12 }}>{t('loading')}</div>}

          {/* Rules table — sticky header, expandable rows */}
          <div style={{ ...S.card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 420px)', minHeight: 200 }}>
            <table style={{ ...S.table, tableLayout: 'fixed', minWidth: 520 }}>
              <colgroup>
                <col style={{ width: 88 }} />  {/* state      */}
                <col style={{ width: 68 }} />  {/* sev        */}
                <col style={{ width: '20%' }} />{/* name       */}
                <col style={{ width: '20%' }} />{/* target     */}
                <col />                          {/* condition  */}
                <col style={{ width: 96 }} />  {/* actions    */}
              </colgroup>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#0d1224' }}>
                <tr>{[t('nagios_col_state'), t('severity'), t('name'), 'Target', 'Condition', t('actions')].map(h =>
                  <th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rules.length === 0 && !loading && (
                  <tr><td colSpan={6} style={{ ...S.td, color: '#64748b', textAlign: 'center', padding: 24 }}>
                    {t('alerts_no_rules_list')}
                  </td></tr>
                )}
                {rules.map((rule, i) => {
                  const isExp = expandedRuleId === rule.id;
                  return (
                    <React.Fragment key={rule.id}>
                      <tr
                        style={{ background: rule.state === 'firing' ? 'rgba(248,113,113,0.04)' : isExp ? 'rgba(85,243,255,0.05)' : i % 2 ? 'rgba(255,255,255,0.015)' : 'transparent' }}
                      >
                        <td style={S.td}>{stateBadge(rule)}</td>
                        <td style={S.td}><SevBadge sev={rule.severity} /></td>
                        <td
                          style={{ ...S.td, fontWeight: 600, color: '#e9eeff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                          title={rule.name}
                          onClick={() => setExpandedRuleId(isExp ? null : rule.id)}
                        >
                          {rule.name}
                          <span style={{ marginLeft: 6, fontSize: 10, color: '#475569', verticalAlign: 'middle', userSelect: 'none' }}>
                            {isExp ? '▲' : '▶'}
                          </span>
                        </td>
                        <td style={{ ...S.td, fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[rule.asset_id, rule.namespace, rule.metric].filter(Boolean).join(' / ') || t('all')}
                        </td>
                        <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: '#7dd3fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {conditionText(rule)}
                          {rule.last_value !== null && (
                            <span style={{ color: '#475569', marginLeft: 6 }}>| {rule.last_value!.toFixed(2)}</span>
                          )}
                        </td>
                        <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                          <button onClick={() => toggleRule(rule)} style={{ ...S.btnSm, marginRight: 4, color: rule.enabled ? '#4ade80' : '#64748b' }} title={rule.enabled ? t('alerts_btn_toggle_off') : t('alerts_btn_toggle_on')}>
                            {rule.enabled ? '●' : '○'}
                          </button>
                          <button onClick={() => silenceRule(rule)} style={{ ...S.btnSm, marginRight: 4 }} title={t('alerts_btn_silence')}>🔕</button>
                          <button onClick={() => deleteRule(rule.id)} style={{ ...S.btnSm, color: '#f87171' }} title={t('remove')}>✕</button>
                        </td>
                      </tr>
                      {isExp && (
                        <tr style={{ background: 'rgba(85,243,255,0.025)' }}>
                          <td colSpan={6} style={{ ...S.td, padding: '10px 14px 12px', borderTop: '1px solid rgba(85,243,255,0.08)' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px', fontSize: 11, marginBottom: 6 }}>
                              {[
                                ['name',      rule.name],
                                ['asset',     rule.asset_id || t('all')],
                                ['namespace', rule.namespace || t('all')],
                                ['metric',    rule.metric || t('all')],
                                ['severity',  rule.severity],
                              ].map(([k, v]) => (
                                <span key={k}>
                                  <span style={{ color: '#475569' }}>{k}</span>{' '}
                                  <code style={{ color: '#cbd5e1', fontSize: 11 }}>{v}</code>
                                </span>
                              ))}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px', fontSize: 11 }}>
                              <span>
                                <span style={{ color: '#475569' }}>condition</span>{' '}
                                <code style={{ color: '#7dd3fc', fontSize: 11 }}>{conditionText(rule)}</code>
                              </span>
                              {rule.last_value !== null && (
                                <span>
                                  <span style={{ color: '#475569' }}>last value</span>{' '}
                                  <code style={{ color: '#a5f3fc', fontSize: 11 }}>{rule.last_value!.toFixed(4)}</code>
                                </span>
                              )}
                              {rule.channels.length > 0 && (
                                <span>
                                  <span style={{ color: '#475569' }}>channels</span>{' '}
                                  <code style={{ color: '#cbd5e1', fontSize: 11 }}>{rule.channels.join(', ')}</code>
                                </span>
                              )}
                              {rule.silence_until && new Date(rule.silence_until) > new Date() && (
                                <span>
                                  <span style={{ color: '#475569' }}>silenced until</span>{' '}
                                  <code style={{ color: '#fbbf24', fontSize: 11 }}>{new Date(rule.silence_until).toLocaleString()}</code>
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── CHANNELS ──────────────────────────────────────────────────────── */}
      {subtab === 'channels' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>{t('alerts_channels_count').replace('{n}', String(channels.length))}</span>
            <button onClick={() => setShowChForm(x => !x)} style={{ ...S.btn, padding: '7px 16px', fontSize: 13 }}>
              {showChForm ? t('alerts_cancel_rule') : t('alerts_new_channel')}
            </button>
          </div>

          {showChForm && (
            <div style={{ ...S.card, marginBottom: 16, border: '1px solid rgba(85,243,255,0.25)' }}>
              <div style={{ fontWeight: 700, color: '#55f3ff', marginBottom: 12, fontSize: 14 }}>{t('alerts_channel_title')}</div>
              <div className="orbit-grid-4" style={{ marginBottom: 10 }}>
                <label style={S.label}>ID (slug)<input style={S.input} value={cf.id} onChange={e => setCf(p => ({ ...p, id: e.target.value }))} placeholder="telegram-ops" /></label>
                <label style={S.label}>Nome<input style={S.input} value={cf.name} onChange={e => setCf(p => ({ ...p, name: e.target.value }))} placeholder="Telegram NOC" /></label>
                <label style={S.label}>{t('type')}
                  <select style={S.select} value={cf.kind} onChange={e => setCf(p => ({ ...p, kind: e.target.value as any }))}>
                    <option value="webhook">Webhook</option>
                    <option value="telegram">Telegram</option>
                  </select>
                </label>
              </div>
              {cf.kind === 'webhook' && (
                <div className="orbit-grid-2" style={{ marginBottom: 10 }}>
                  <label style={S.label}>URL<input style={S.input} value={cf.url} onChange={e => setCf(p => ({ ...p, url: e.target.value }))} placeholder="https://hooks.example.com/..." /></label>
                  <label style={S.label}>{t('headers_json')}<textarea style={{ ...S.input, height: 60, resize: 'vertical' }} value={cf.headers} onChange={e => setCf(p => ({ ...p, headers: e.target.value }))} placeholder='{"Authorization":"Bearer ..."}'  /></label>
                </div>
              )}
              {cf.kind === 'telegram' && (
                <div className="orbit-grid-2" style={{ marginBottom: 10 }}>
                  <label style={S.label}>Bot Token<input style={S.input} value={cf.bot_token} onChange={e => setCf(p => ({ ...p, bot_token: e.target.value }))} placeholder="1234567890:AAH..." /></label>
                  <label style={S.label}>Chat ID<input style={S.input} value={cf.chat_id} onChange={e => setCf(p => ({ ...p, chat_id: e.target.value }))} placeholder="-1001234567890" /></label>
                </div>
              )}
              <button onClick={saveChannel} style={{ ...S.btn, padding: '8px 20px' }}>{t('alerts_save_channel')}</button>
            </div>
          )}

          <div style={{ ...S.card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 420px)', minHeight: 200 }}>
            <table style={{ ...S.table, tableLayout: 'fixed', minWidth: 400 }}>
              <colgroup>
                <col style={{ width: '22%' }} />{/* id      */}
                <col style={{ width: '24%' }} />{/* name    */}
                <col style={{ width: 84 }} />  {/* type    */}
                <col />                          {/* created */}
                <col style={{ width: 96 }} />  {/* actions */}
              </colgroup>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#0d1224' }}>
                <tr>{['ID', t('name'), t('type'), t('created_at'), t('actions')].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {channels.length === 0 && (
                  <tr><td colSpan={5} style={{ ...S.td, color: '#64748b', textAlign: 'center', padding: 24 }}>
                    {t('alerts_no_channels_list')}
                  </td></tr>
                )}
                {channels.map((ch, i) => (
                  <tr key={ch.id} style={{ background: i % 2 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.id}</td>
                    <td style={{ ...S.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</td>
                    <td style={S.td}>
                      <span style={{ background: ch.kind === 'telegram' ? '#172554' : '#1c1917', color: ch.kind === 'telegram' ? '#60a5fa' : '#fdba74', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                        {ch.kind.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ ...S.td, fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(ch.created_at).toLocaleString()}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                      <button onClick={() => testChannel(ch.id)} style={{ ...S.btnSm, marginRight: 6, color: '#55f3ff' }}>{t('test')}</button>
                      <button onClick={() => deleteChannel(ch.id)} style={{ ...S.btnSm, color: '#f87171' }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── HISTORY ───────────────────────────────────────────────────────── */}
      {subtab === 'history' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>{t('alerts_history_count').replace('{n}', String(history.length))}</span>
            <button onClick={loadHistory} style={{ ...S.btnSm }}>{t('reload')}</button>
          </div>
          <div style={{ ...S.card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 380px)', minHeight: 200 }}>
            <table style={{ ...S.table, tableLayout: 'fixed', minWidth: 480 }}>
              <colgroup>
                <col style={{ width: 110 }} /> {/* time    */}
                <col style={{ width: '22%' }} />{/* rule    */}
                <col style={{ width: '18%' }} />{/* channel */}
                <col style={{ width: 106 }} /> {/* event   */}
                <col />                          {/* status+error */}
              </colgroup>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#0d1224' }}>
                <tr>{[t('alerts_notif_col_time'), t('alerts_notif_col_rule'), t('alerts_notif_col_ch'), t('alerts_notif_col_event'), `${t('alerts_notif_col_status')} / ${t('alerts_notif_col_error')}`].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr><td colSpan={5} style={{ ...S.td, color: '#64748b', textAlign: 'center', padding: 24 }}>
                    {t('alerts_no_notifs')}
                  </td></tr>
                )}
                {history.map((n, i) => {
                  const isExp = !n.ok && !!n.error;
                  return (
                    <React.Fragment key={n.id}>
                      <tr style={{ background: !n.ok ? 'rgba(248,113,113,0.04)' : i % 2 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                        <td style={{ ...S.td, fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                          {new Date(n.sent_at).toLocaleString()}
                        </td>
                        <td style={{ ...S.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.rule_name ?? String(n.rule_id)}>
                          {n.rule_name ?? n.rule_id}
                        </td>
                        <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {n.channel_id}
                        </td>
                        <td style={S.td}>
                          <span style={{ color: n.event === 'firing' ? '#f87171' : '#4ade80', fontWeight: 700, fontSize: 11 }}>
                            {n.event === 'firing' ? '🚨 FIRING' : '✅ RESOLVED'}
                          </span>
                        </td>
                        <td style={{ ...S.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {n.ok
                            ? <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 12 }}>✓ OK</span>
                            : <>
                                <span style={{ color: '#f87171', fontWeight: 700, fontSize: 12 }}>✗ ERROR</span>
                                {n.error && (
                                  <span style={{ color: '#f87171', fontSize: 11, marginLeft: 6 }}>{n.error}</span>
                                )}
                              </>
                          }
                        </td>
                      </tr>
                      {isExp && false /* errors shown inline */}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CONNECTORS TAB ───────────────────────────────────────────────────────────

type Connector = {
  id: string; source_id: string; mode: 'push' | 'pull'; type: 'metric' | 'event';
  spec: object; status: 'draft' | 'approved' | 'disabled'; auto: boolean;
  description: string | null; pull_url: string | null; pull_interval_min: number;
  created_at: string; updated_at: string;
};
type ConnectorRun = {
  id: string; source_id: string; started_at: string; finished_at: string | null;
  status: 'ok' | 'error'; ingested: number; raw_size: number | null; error: string | null;
};

const SPEC_TEMPLATE_METRIC = `{
  "type": "metric",
  "items_path": "data.items",
  "mappings": {
    "ts":        { "path": "$.timestamp", "transform": "iso8601" },
    "asset_id":  { "path": "$.host", "default": "unknown" },
    "namespace": { "value": "my-source" },
    "metric":    { "path": "$.metric_name" },
    "value":     { "path": "$.value", "transform": "number" },
    "unit":      { "path": "$.unit" }
  }
}`;

const SPEC_TEMPLATE_EVENT = `{
  "type": "event",
  "items_path": "alerts",
  "mappings": {
    "ts":          { "path": "$.timestamp" },
    "asset_id":    { "path": "$.host" },
    "namespace":   { "value": "my-source" },
    "kind":        { "path": "$.rule.name" },
    "severity":    { "path": "$.level", "transform": "severity_map" },
    "title":       { "path": "$.rule.name" },
    "message":     { "path": "$.full_log" },
    "fingerprint": { "path": "$.id" }
  }
}`;

function statusBadge(status: string) {
  const cfg: Record<string, { bg: string; fg: string; label: string }> = {
    approved: { bg: '#052e16', fg: '#4ade80', label: 'APROVADO' },
    draft:    { bg: '#451a03', fg: '#fbbf24', label: 'DRAFT' },
    disabled: { bg: '#1e293b', fg: '#64748b', label: 'DESATIV.' },
  };
  const c = cfg[status] ?? cfg.draft;
  return <span style={{ background: c.bg, color: c.fg, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{c.label}</span>;
}

function modeBadge(mode: string) {
  return <span style={{ background: mode === 'pull' ? '#1e1040' : '#0c1a3a', color: mode === 'pull' ? '#a78bfa' : '#38bdf8', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{mode.toUpperCase()}</span>;
}

function ConnectorsTab() {
  const [subtab, setSubtab] = React.useState<'list' | 'create' | 'ai' | 'plugin'>('list');
  const [connectors, setConnectors] = React.useState<Connector[]>([]);
  const [loading, setLoading]       = React.useState(false);
  const [err, setErr]               = React.useState<string | null>(null);
  const [toast, setToast]           = React.useState<{ msg: string; ok: boolean } | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [runs, setRuns]             = React.useState<ConnectorRun[]>([]);
  const [runsLoading, setRunsLoading] = React.useState(false);

  // ── Test panel (dry-run, pull) ──
  const [testId, setTestId]           = React.useState<string | null>(null);
  const [testPayload, setTestPayload] = React.useState('');
  const [testLoading, setTestLoading] = React.useState(false);
  const [testResult, setTestResult]   = React.useState<any>(null);
  const [testErr, setTestErr]         = React.useState<string | null>(null);

  // ── Push panel (real ingest, push connectors) ──
  const [pushId, setPushId]           = React.useState<string | null>(null);
  const [pushPayload, setPushPayload] = React.useState('');
  const [pushLoading, setPushLoading] = React.useState(false);
  const [pushResult, setPushResult]   = React.useState<any>(null);
  const [pushErr, setPushErr]         = React.useState<string | null>(null);
  const [pushCopied, setPushCopied]   = React.useState(false);

  // ── Create form ──
  const [cf, setCf] = React.useState({
    id: '', source_id: '', mode: 'push', type: 'metric', description: '',
    pull_url: '', pull_interval_min: '5', spec: SPEC_TEMPLATE_METRIC,
  });

  // ── AI Generate form ──
  const [af, setAf] = React.useState({
    aiKey:      localStorage.getItem('orbit_ai_key') ?? '',
    aiModel:    'claude-sonnet-4-6',
    sourceType: '',
    type:       '',
    id:         '',
    description: '',
    payload:    '',
  });
  const [aiLoading, setAiLoading]   = React.useState(false);
  const [aiResult, setAiResult]     = React.useState<{ id: string; source_id: string; spec: object; next_step: string } | null>(null);
  const [aiErr, setAiErr]           = React.useState<string | null>(null);

  // ── Plugin Generator form ──
  const [pf, setPf] = React.useState({
    aiKey:       localStorage.getItem('orbit_ai_key') ?? '',
    aiModel:     'claude-sonnet-4-6',
    description: '',
  });
  const [pluginLoading, setPluginLoading]                                                          = React.useState(false);
  const [pluginResult, setPluginResult] = React.useState<{ connector_spec: object; agent_script: string; readme: string } | null>(null);
  const [pluginErr, setPluginErr]       = React.useState<string | null>(null);

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('api/v1/connectors', { headers: apiGetHeaders() });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setConnectors(j.connectors);
    } catch (e: any) { setErr(String(e)); } finally { setLoading(false); }
  }

  React.useEffect(() => { load(); }, []);

  async function approve(id: string) {
    await fetch(`api/v1/connectors/${id}/approve`, { method: 'POST', headers: apiHeaders() });
    showToast('Connector approved!', true); load();
  }
  async function disable(id: string) {
    await fetch(`api/v1/connectors/${id}/disable`, { method: 'POST', headers: apiHeaders() });
    showToast('Connector disabled', true); load();
  }
  async function del(id: string) {
    if (!confirm(`Remover connector "${id}"?`)) return;
    await fetch(`api/v1/connectors/${id}`, { method: 'DELETE', headers: apiGetHeaders() });
    showToast('Removed', true); load();
  }

  async function toggleRuns(conn: Connector) {
    if (expandedId === conn.id) { setExpandedId(null); return; }
    setExpandedId(conn.id); setRunsLoading(true);
    try {
      const r = await fetch(`api/v1/connectors/${conn.id}/runs`, { headers: apiGetHeaders() });
      const j = await r.json();
      setRuns(j.ok ? j.runs : []);
    } catch { setRuns([]); } finally { setRunsLoading(false); }
  }

  function toggleTest(c: Connector) {
    if (testId === c.id) { setTestId(null); setTestResult(null); setTestErr(null); return; }
    setTestId(c.id); setTestPayload(''); setTestResult(null); setTestErr(null);
  }

  async function runTest(c: Connector) {
    setTestLoading(true); setTestResult(null); setTestErr(null);
    try {
      const body: any = {};
      if (testPayload.trim()) {
        try { body.payload = JSON.parse(testPayload); } catch { setTestErr('Invalid JSON'); setTestLoading(false); return; }
      }
      const r = await fetch(`api/v1/connectors/${c.id}/test`, {
        method: 'POST', headers: apiHeaders(), body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setTestResult(j);
    } catch (e: any) { setTestErr(String(e)); } finally { setTestLoading(false); }
  }

  function togglePush(c: Connector) {
    if (pushId === c.id) { setPushId(null); setPushResult(null); setPushErr(null); return; }
    setPushId(c.id); setPushPayload(''); setPushResult(null); setPushErr(null); setPushCopied(false);
  }

  async function runPush(c: Connector) {
    if (!pushPayload.trim()) { setPushErr('Enter the JSON payload'); return; }
    let payloadObj: unknown;
    try { payloadObj = JSON.parse(pushPayload); } catch { setPushErr('Invalid JSON'); return; }
    setPushLoading(true); setPushResult(null); setPushErr(null);
    try {
      const r = await fetch(`api/v1/ingest/raw/${encodeURIComponent(c.source_id)}`, {
        method: 'POST', headers: apiHeaders(), body: JSON.stringify(payloadObj),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setPushResult(j);
    } catch (e: any) { setPushErr(String(e)); } finally { setPushLoading(false); }
  }

  function curlExample(c: Connector): string {
    const base = `${window.location.origin}/orbit-core`;
    const key  = localStorage.getItem('orbit_api_key') ?? 'YOUR_API_KEY';
    const body = pushPayload.trim() || '{"your": "payload"}';
    return [
      `curl -s -X POST '${base}/api/v1/ingest/raw/${c.source_id}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      key !== 'YOUR_API_KEY' ? `  -H 'X-Api-Key: ${key}' \\` : `  -H 'X-Api-Key: YOUR_API_KEY' \\`,
      `  -d '${body}'`,
    ].join('\n');
  }

  async function create() {
    let specObj: unknown;
    try { specObj = JSON.parse(cf.spec); } catch { showToast('Invalid Spec JSON', false); return; }
    const body: any = {
      id: cf.id, source_id: cf.source_id || cf.id, mode: cf.mode,
      type: cf.type, spec: specObj,
      pull_interval_min: parseInt(cf.pull_interval_min) || 5,
    };
    if (cf.description) body.description = cf.description;
    if (cf.mode === 'pull' && cf.pull_url) body.pull_url = cf.pull_url;
    const r = await fetch('api/v1/connectors', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) { showToast('Error: ' + JSON.stringify(j.error), false); return; }
    showToast('Connector saved as draft!', true);
    setCf({ id: '', source_id: '', mode: 'push', type: 'metric', description: '', pull_url: '', pull_interval_min: '5', spec: SPEC_TEMPLATE_METRIC });
    setSubtab('list'); load();
  }

  async function pluginGenerate() {
    if (!pf.aiKey) { setPluginErr('Enter the Anthropic API Key'); return; }
    if (!pf.description.trim()) { setPluginErr('Descreva a fonte de dados'); return; }
    localStorage.setItem('orbit_ai_key', pf.aiKey);
    setPluginLoading(true); setPluginErr(null); setPluginResult(null);
    try {
      const r = await fetch('api/v1/ai/plugin', {
        method: 'POST',
        headers: { ...apiHeaders(), 'x-ai-key': pf.aiKey, 'x-ai-model': pf.aiModel },
        body: JSON.stringify({ description: pf.description }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setPluginResult({ connector_spec: j.connector_spec, agent_script: j.agent_script, readme: j.readme });
    } catch (e: any) { setPluginErr(String(e)); } finally { setPluginLoading(false); }
  }

  function downloadText(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function aiGenerate() {
    if (!af.aiKey) { setAiErr('Enter the Anthropic API Key'); return; }
    let payloadObj: unknown;
    try { payloadObj = JSON.parse(af.payload); } catch { setAiErr('Invalid Payload JSON'); return; }
    localStorage.setItem('orbit_ai_key', af.aiKey);
    setAiLoading(true); setAiErr(null); setAiResult(null);
    try {
      const body: any = { payload: payloadObj };
      if (af.sourceType) body.source_type = af.sourceType;
      if (af.type)       body.type        = af.type;
      if (af.id)         body.id          = af.id;
      if (af.description) body.description = af.description;
      const r = await fetch('api/v1/connectors/generate', {
        method: 'POST',
        headers: { ...apiHeaders(), 'x-ai-key': af.aiKey, 'x-ai-model': af.aiModel },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setAiResult({ id: j.id, source_id: j.source_id, spec: j.spec, next_step: j.next_step });
    } catch (e: any) { setAiErr(String(e)); } finally { setAiLoading(false); }
  }

  const subtabBtn = (t: 'list' | 'create' | 'ai' | 'plugin', label: string) => (
    <button onClick={() => setSubtab(t)} style={{
      background: subtab === t ? 'rgba(85,243,255,0.15)' : 'transparent',
      border: subtab === t ? '1px solid rgba(85,243,255,0.4)' : '1px solid transparent',
      borderRadius: 8, color: subtab === t ? '#55f3ff' : '#94a3b8',
      padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    }}>{label}</button>
  );

  return (
    <div>
      {toast && (
        <div style={{ position: 'fixed', top: 18, right: 24, zIndex: 9999, padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: toast.ok ? '#052e16' : '#450a0a', color: toast.ok ? '#4ade80' : '#f87171', border: `1px solid ${toast.ok ? '#4ade80' : '#f87171'}`, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
          {toast.msg}
        </div>
      )}

      {/* ── Subtab bar ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {subtabBtn('list',   t('conn_title'))}
        {subtabBtn('create', '+ Criar')}
        {subtabBtn('ai',     '✨ Generate with AI')}
        {subtabBtn('plugin', '⬇ Plugin IA')}
      </div>

      {/* ── LIST ── */}
      {subtab === 'list' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>{connectors.length} connector(s)</span>
            <button onClick={load} style={{ ...S.btnSm, fontSize: 12 }}>{t('reload')}</button>
          </div>
          {err && <div style={S.err}>{err}</div>}
          {loading && <div style={{ color: '#94a3b8', fontSize: 13 }}>Carregando…</div>}
          {!loading && connectors.length === 0 && (
            <div style={{ ...S.card, textAlign: 'center', color: '#64748b', padding: 40 }}>
              No connectors. Create one manually or use <strong>✨ Generate with AI</strong>.
            </div>
          )}
          {connectors.map(c => (
            <div key={c.id} style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
              {/* Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', flexWrap: 'wrap' as const }}>
                {/* expand toggle */}
                <button onClick={() => toggleRuns(c)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14, padding: '2px 6px', borderRadius: 4 }} title="Ver runs">
                  {expandedId === c.id ? '▼' : '▶'}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#e9eeff' }}>{c.id}</span>
                    {modeBadge(c.mode)}
                    <span style={{ background: '#0f172a', color: '#94a3b8', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{c.type.toUpperCase()}</span>
                    {statusBadge(c.status)}
                    {c.auto && <span style={{ background: '#1a1540', color: '#c084fc', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>✨ AI</span>}
                  </div>
                  {c.description && <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{c.description}</div>}
                  <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>
                    source: <code style={{ color: '#7dd3fc' }}>{c.source_id}</code>
                    {c.mode === 'pull' && c.pull_url && <> · pull: <code style={{ color: '#a78bfa' }}>{c.pull_url}</code> ({c.pull_interval_min}min)</>}
                    {c.mode === 'push' && <> · webhook: <code style={{ color: '#34d399' }}>/api/v1/ingest/raw/{c.source_id}</code></>}
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {(c.status === 'draft' || c.status === 'disabled') && (
                    <button onClick={() => approve(c.id)} style={{ ...S.btnSm, color: '#4ade80', borderColor: 'rgba(74,222,128,0.35)' }} title={t('conn_approve')}>{t('conn_approve')}</button>
                  )}
                  {c.status === 'approved' && (
                    <button onClick={() => disable(c.id)} style={{ ...S.btnSm, color: '#94a3b8' }} title={t('conn_btn_disable_tt')}>{t('conn_btn_disable')}</button>
                  )}
                  {c.mode === 'push' && (
                    <button onClick={() => togglePush(c)} style={{ ...S.btnSm, color: '#34d399', borderColor: 'rgba(52,211,153,0.30)', background: pushId === c.id ? 'rgba(52,211,153,0.10)' : 'transparent' }} title={t('conn_btn_push_tt')}>📤 Push</button>
                  )}
                  <button onClick={() => toggleTest(c)} style={{ ...S.btnSm, color: '#fbbf24', borderColor: 'rgba(251,191,36,0.30)', background: testId === c.id ? 'rgba(251,191,36,0.10)' : 'transparent' }} title={t('conn_btn_test_tt')}>{t('conn_btn_test')}</button>
                  <button onClick={() => del(c.id)} style={{ ...S.btnSm, color: '#f87171', borderColor: 'rgba(248,113,113,0.30)' }} title={t('remove')}>🗑</button>
                </div>
              </div>

              {/* Runs panel */}
              {expandedId === c.id && (
                <div style={{ borderTop: '1px solid rgba(140,160,255,0.12)', padding: '12px 16px', background: 'rgba(4,7,19,0.4)' }}>
                  <div style={{ color: '#55f3ff', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t('conn_runs_history')}</div>
                  {runsLoading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Carregando…</div>}
                  {!runsLoading && runs.length === 0 && <div style={{ color: '#475569', fontSize: 12 }}>{t('conn_no_runs')}</div>}
                  {!runsLoading && runs.length > 0 && (
                    <table style={{ ...S.table, fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={S.th}>{t('conn_runs_start')}</th>
                          <th style={S.th}>Status</th>
                          <th style={S.th}>{t('conn_runs_ingested')}</th>
                          <th style={S.th}>Raw Size</th>
                          <th style={S.th}>{t('conn_runs_duration')}</th>
                          <th style={S.th}>{t('conn_runs_error')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runs.map(r => {
                          const dur = r.finished_at ? Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime())) : null;
                          return (
                            <tr key={r.id}>
                              <td style={S.td}>{fmtTs(r.started_at)}</td>
                              <td style={S.td}>
                                {r.status === 'ok'
                                  ? <span style={{ color: '#4ade80', fontWeight: 700 }}>✓ ok</span>
                                  : <span style={{ color: '#f87171', fontWeight: 700 }}>✗ error</span>
                                }
                              </td>
                              <td style={S.td}>{r.ingested}</td>
                              <td style={S.td}>{r.raw_size ? `${r.raw_size}b` : '—'}</td>
                              <td style={S.td}>{dur !== null ? `${dur}ms` : '—'}</td>
                              <td style={{ ...S.td, color: '#f87171', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{r.error ?? '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Push panel */}
              {pushId === c.id && (
                <div style={{ borderTop: '1px solid rgba(52,211,153,0.15)', padding: '12px 16px', background: 'rgba(4,7,19,0.4)' }}>
                  <div style={{ color: '#34d399', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t('conn_push_title')}</div>
                  {/* Webhook URL row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' as const }}>
                    <code style={{ fontSize: 11, color: '#94a3b8', background: 'rgba(15,23,42,0.6)', padding: '4px 8px', borderRadius: 6, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                      POST {window.location.origin}/orbit-core/api/v1/ingest/raw/{c.source_id}
                    </code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(curlExample(c)); setPushCopied(true); setTimeout(() => setPushCopied(false), 2000); }}
                      style={{ ...S.btnSm, color: pushCopied ? '#4ade80' : '#34d399', borderColor: 'rgba(52,211,153,0.30)', flexShrink: 0, fontSize: 11 }}
                    >{pushCopied ? t('conn_push_copied') : t('conn_push_copy_curl')}</button>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>
                    Payload will be mapped by spec and saved to DB. The connector must be <strong style={{ color: '#4ade80' }}>approved</strong>.
                  </div>
                  <textarea
                    style={{ ...S.input, width: '100%', minHeight: 100, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' as const, boxSizing: 'border-box' as const, marginBottom: 8 }}
                    value={pushPayload} onChange={e => setPushPayload(e.target.value)}
                    placeholder={'{\n  "your": "raw payload here"\n}'}
                  />
                  {pushErr && <div style={{ ...S.err, marginBottom: 8, fontSize: 11 }}>✗ {pushErr}</div>}
                  <button onClick={() => runPush(c)} disabled={pushLoading} style={{ ...S.btnSm, color: '#34d399', borderColor: 'rgba(52,211,153,0.35)' }}>
                    {pushLoading ? t('conn_push_sending') : t('conn_push_send')}
                  </button>
                  {pushResult && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' as const }}>
                      <span style={{ color: '#4ade80', fontWeight: 700 }}>✓ ingested: {pushResult.ingested ?? pushResult.inserted ?? 0}</span>
                      {(pushResult.skipped ?? 0) > 0 && <span style={{ color: '#f87171' }}>✗ skipped: {pushResult.skipped}</span>}
                      {pushResult.errors?.length > 0 && (
                        <div style={{ color: '#f87171', fontSize: 11, width: '100%' }}>
                          {pushResult.errors.slice(0, 3).map((e: string, i: number) => <div key={i}>{e}</div>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Test panel */}
              {testId === c.id && (
                <div style={{ borderTop: '1px solid rgba(251,191,36,0.15)', padding: '12px 16px', background: 'rgba(4,7,19,0.4)' }}>
                  <div style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t('conn_test_dry_run')}</div>
                  <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>
                    {c.mode === 'pull'
                      ? <>Optional payload — empty will fetch from <code style={{ color: '#a78bfa' }}>{c.pull_url ?? 'pull_url'}</code></>
                      : 'Provide a JSON payload to simulate the mapping without saving to DB.'}
                  </div>
                  <textarea
                    style={{ ...S.input, width: '100%', minHeight: 90, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' as const, boxSizing: 'border-box' as const, marginBottom: 8 }}
                    value={testPayload} onChange={e => setTestPayload(e.target.value)}
                    placeholder={c.mode === 'pull' ? '{ ... } — optional' : '{ ... } — required'}
                  />
                  {testErr && <div style={{ ...S.err, marginBottom: 8, fontSize: 11 }}>✗ {testErr}</div>}
                  <button onClick={() => runTest(c)} disabled={testLoading} style={{ ...S.btnSm, color: '#fbbf24', borderColor: 'rgba(251,191,36,0.35)' }}>
                    {testLoading ? t('conn_test_testing') : t('conn_test_run_btn')}
                  </button>
                  {testResult && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 12, flexWrap: 'wrap' as const }}>
                        <span style={{ color: '#4ade80' }}>✓ valid: <strong>{testResult.valid}</strong></span>
                        {testResult.skipped > 0 && <span style={{ color: '#f87171' }}>✗ invalid: <strong>{testResult.skipped}</strong></span>}
                        <span style={{ color: '#64748b' }}>source: <strong>{testResult.source}</strong></span>
                        <span style={{ color: '#64748b' }}>type: <strong>{testResult.type}</strong></span>
                      </div>
                      {testResult.errors?.length > 0 && (
                        <div style={{ color: '#f87171', fontSize: 11, marginBottom: 8 }}>
                          {testResult.errors.slice(0, 3).map((e: string, i: number) => <div key={i}>{e}</div>)}
                        </div>
                      )}
                      {testResult.mapped?.length > 0 && (
                        <pre style={{ background: 'rgba(4,7,19,0.6)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: 8, padding: 10, fontSize: 11, color: '#fef3c7', overflowX: 'auto' as const, maxHeight: 200, margin: 0 }}>
                          {JSON.stringify(testResult.mapped[0], null, 2)}{testResult.mapped.length > 1 ? `\n… +${testResult.mapped.length - 1} more` : ''}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── CREATE ── */}
      {subtab === 'create' && (
        <div style={{ ...S.card, border: '1px solid rgba(85,243,255,0.20)' }}>
          <div style={{ fontWeight: 700, color: '#55f3ff', marginBottom: 16, fontSize: 15 }}>{t('conn_new_title')}</div>
          <div className="orbit-grid-2" style={{ marginBottom: 12 }}>
            <label style={S.label}>ID (slug)
              <input style={S.input} value={cf.id} onChange={e => setCf(p => ({ ...p, id: e.target.value }))} placeholder="nagios-perf" />
            </label>
            <label style={S.label}>Source ID
              <input style={S.input} value={cf.source_id} onChange={e => setCf(p => ({ ...p, source_id: e.target.value }))} placeholder="same as ID if not provided" />
            </label>
          </div>
          <div className="orbit-grid-4" style={{ marginBottom: 12 }}>
            <label style={S.label}>{t('mode')}
              <select style={S.select} value={cf.mode} onChange={e => setCf(p => ({ ...p, mode: e.target.value }))}>
                <option value="push">push</option>
                <option value="pull">pull</option>
              </select>
            </label>
            <label style={S.label}>{t('type')}
              <select style={S.select} value={cf.type}
                onChange={e => setCf(p => ({ ...p, type: e.target.value, spec: e.target.value === 'event' ? SPEC_TEMPLATE_EVENT : SPEC_TEMPLATE_METRIC }))}>
                <option value="metric">metric</option>
                <option value="event">event</option>
              </select>
            </label>
            {cf.mode === 'pull' && <>
              <label style={{ ...S.label, gridColumn: 'span 2' }}>Pull URL
                <input style={S.input} value={cf.pull_url} onChange={e => setCf(p => ({ ...p, pull_url: e.target.value }))} placeholder="http://host/metrics" />
              </label>
            </>}
          </div>
          {cf.mode === 'pull' && (
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>{t('conn_pull_interval')}
                <input style={{ ...S.input, width: 100 }} type="number" min={1} max={1440} value={cf.pull_interval_min}
                  onChange={e => setCf(p => ({ ...p, pull_interval_min: e.target.value }))} />
              </label>
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>{t('description')}
              <input style={S.input} value={cf.description} onChange={e => setCf(p => ({ ...p, description: e.target.value }))} placeholder={t('optional')} />
            </label>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...S.label, marginBottom: 4 }}>{t('conn_spec_dsl')}</label>
            <textarea style={{ ...S.input, width: '100%', minHeight: 220, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' as const, boxSizing: 'border-box' as const }}
              value={cf.spec} onChange={e => setCf(p => ({ ...p, spec: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={create} style={S.btn}>{t('conn_save_draft')}</button>
            <button onClick={() => setSubtab('list')} style={S.btnSm}>{t('cancel')}</button>
          </div>
        </div>
      )}

      {/* ── AI GENERATE ── */}
      {subtab === 'ai' && (
        <div style={{ ...S.card, border: '1px solid rgba(155,124,255,0.25)' }}>
          <div style={{ fontWeight: 700, color: '#c084fc', marginBottom: 4, fontSize: 15 }}>{t('conn_ai_title')}</div>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 16 }}>
            Paste an example payload. Claude will analyze the structure and generate the mapping spec automatically.
          </div>

          <div className="orbit-grid-2" style={{ marginBottom: 12 }}>
            <label style={S.label}>API Key Anthropic
              <input style={{ ...S.input, fontFamily: 'monospace' }} type="password" value={af.aiKey}
                onChange={e => setAf(p => ({ ...p, aiKey: e.target.value }))} placeholder="sk-ant-..." />
            </label>
            <label style={S.label}>{t('conn_ai_model')}
              <input style={S.input} value={af.aiModel} onChange={e => setAf(p => ({ ...p, aiModel: e.target.value }))} placeholder="claude-sonnet-4-6" />
            </label>
          </div>
          <div className="orbit-grid-4" style={{ marginBottom: 12 }}>
            <label style={S.label}>Source Type (hint)
              <input style={S.input} value={af.sourceType} onChange={e => setAf(p => ({ ...p, sourceType: e.target.value }))} placeholder="nagios, wazuh, snmp…" />
            </label>
            <label style={S.label}>Type (optional)
              <select style={S.select} value={af.type} onChange={e => setAf(p => ({ ...p, type: e.target.value }))}>
                <option value="">AI infers</option>
                <option value="metric">metric</option>
                <option value="event">event</option>
              </select>
            </label>
            <label style={S.label}>ID (optional)
              <input style={S.input} value={af.id} onChange={e => setAf(p => ({ ...p, id: e.target.value }))} placeholder="auto-generated" />
            </label>
            <label style={S.label}>Description (optional)
              <input style={S.input} value={af.description} onChange={e => setAf(p => ({ ...p, description: e.target.value }))} />
            </label>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...S.label, marginBottom: 4 }}>Example Payload (JSON)</label>
            <textarea style={{ ...S.input, width: '100%', minHeight: 200, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' as const, boxSizing: 'border-box' as const }}
              value={af.payload} onChange={e => setAf(p => ({ ...p, payload: e.target.value }))}
              placeholder={'{\n  "host": "server-01",\n  "service": "cpu",\n  "value": 72.4,\n  "ts": 1740576000\n}'} />
          </div>

          {aiErr && <div style={{ ...S.err, marginBottom: 12 }}>✗ {aiErr}</div>}

          <div style={{ display: 'flex', gap: 10, marginBottom: aiResult ? 20 : 0 }}>
            <button onClick={aiGenerate} disabled={aiLoading} style={{ ...S.btn, background: 'linear-gradient(135deg, rgba(155,124,255,0.30), rgba(85,243,255,0.18))', borderColor: 'rgba(155,124,255,0.50)' }}>
              {aiLoading ? t('conn_ai_generating') : t('conn_ai_generate')}
            </button>
          </div>

          {aiResult && (
            <div style={{ marginTop: 20, borderTop: '1px solid rgba(155,124,255,0.20)', paddingTop: 16 }}>
              <div style={{ color: '#c084fc', fontWeight: 700, marginBottom: 8, fontSize: 13 }}>✓ Spec gerado — ID: <code style={{ color: '#e9eeff' }}>{aiResult.id}</code></div>
              <pre style={{ background: 'rgba(4,7,19,0.6)', border: '1px solid rgba(155,124,255,0.20)', borderRadius: 10, padding: 14, fontSize: 12, color: '#a5b4fc', overflowX: 'auto' as const, maxHeight: 300 }}>
                {JSON.stringify(aiResult.spec, null, 2)}
              </pre>
              <div style={{ color: '#64748b', fontSize: 12, margin: '10px 0' }}>
                {aiResult.next_step}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => { setSubtab('list'); load(); setAiResult(null); }} style={S.btn}>
                  View in List
                </button>
                <button onClick={() => approve(aiResult.id)} style={{ ...S.btn, background: 'linear-gradient(135deg, rgba(74,222,128,0.25), rgba(74,222,128,0.15))', borderColor: 'rgba(74,222,128,0.40)', color: '#4ade80' }}>
                  ✓ Approve Now
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PLUGIN GENERATOR ── */}
      {subtab === 'plugin' && (
        <div style={{ ...S.card, border: '1px solid rgba(85,243,255,0.20)' }}>
          <div style={{ fontWeight: 700, color: '#55f3ff', marginBottom: 4, fontSize: 15 }}>⬇ Gerador de Plugin com IA</div>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 16 }}>
            Describe your data source. The AI generates a collection agent, connector spec and install instructions — all ready to download.
          </div>

          <div className="orbit-grid-2" style={{ marginBottom: 12 }}>
            <label style={S.label}>API Key Anthropic
              <input style={{ ...S.input, fontFamily: 'monospace' }} type="password" value={pf.aiKey}
                onChange={e => setPf(p => ({ ...p, aiKey: e.target.value }))} placeholder="sk-ant-..." />
            </label>
            <label style={S.label}>Modelo
              <input style={S.input} value={pf.aiModel} onChange={e => setPf(p => ({ ...p, aiModel: e.target.value }))} />
            </label>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ ...S.label, marginBottom: 4 }}>Data source description
              <textarea
                style={{ ...S.input, width: '100%', minHeight: 120, resize: 'vertical' as const, boxSizing: 'border-box' as const, marginTop: 4 }}
                value={pf.description}
                onChange={e => setPf(p => ({ ...p, description: e.target.value }))}
                placeholder={'Exemplos:\n• Servidor Linux — CPU, memória e disco via /proc e df\n• App Node.js com Express — latência e taxa de erro por endpoint\n• Switch Cisco — tráfego de interface via SNMP walk\n• Banco PostgreSQL — queries lentas e conexões ativas'}
              />
            </label>
          </div>

          {pluginErr && <div style={{ ...S.err, marginBottom: 12 }}>✗ {pluginErr}</div>}

          <button onClick={pluginGenerate} disabled={pluginLoading}
            style={{ ...S.btn, background: 'linear-gradient(135deg, rgba(85,243,255,0.25), rgba(85,243,255,0.12))', borderColor: 'rgba(85,243,255,0.45)', color: '#55f3ff', marginBottom: pluginResult ? 20 : 0 }}>
            {pluginLoading ? '⏳ Generating plugin...' : '⬇ Generate Plugin'}
          </button>

          {pluginResult && (
            <div style={{ marginTop: 20, borderTop: '1px solid rgba(85,243,255,0.15)', paddingTop: 16 }}>
              <div style={{ color: '#55f3ff', fontWeight: 700, marginBottom: 14, fontSize: 13 }}>
                ✓ Plugin gerado — 3 arquivos prontos para download
              </div>

              {/* File cards */}
              {([
                { label: 'connector_spec.json', icon: '📋', content: JSON.stringify(pluginResult.connector_spec, null, 2), color: '#a78bfa', hint: 'Importe no orbit-core → Connectors → Criar (cole o JSON no campo Spec)' },
                { label: 'agent.py',            icon: '🐍', content: pluginResult.agent_script,                            color: '#38bdf8', hint: 'Rode no servidor monitorado. Edite as variáveis ORBIT_URL, ORBIT_SOURCE_ID e ORBIT_API_KEY.' },
                { label: 'README.md',           icon: '📄', content: pluginResult.readme,                                  color: '#4ade80', hint: 'Instruções de instalação completas.' },
              ] as const).map(f => (
                <div key={f.label} style={{ marginBottom: 12, border: `1px solid ${f.color}28`, borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: `${f.color}10` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{f.icon}</span>
                      <code style={{ color: f.color, fontWeight: 700, fontSize: 13 }}>{f.label}</code>
                    </div>
                    <button onClick={() => downloadText(f.content, f.label)}
                      style={{ ...S.btnSm, borderColor: `${f.color}60`, color: f.color, background: `${f.color}15`, fontSize: 12 }}>
                      ⬇ Download
                    </button>
                  </div>
                  <div style={{ padding: '4px 14px 8px', color: '#64748b', fontSize: 11 }}>{f.hint}</div>
                  <pre style={{ margin: 0, padding: '10px 14px', background: 'rgba(4,7,19,0.55)', fontSize: 11, color: '#94a3b8', maxHeight: 160, overflowY: 'auto' as const, overflowX: 'auto' as const, borderTop: '1px solid rgba(140,160,255,0.08)' }}>
                    {f.content.length > 800 ? f.content.slice(0, 800) + '\n…' : f.content}
                  </pre>
                </div>
              ))}

              <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(85,243,255,0.06)', border: '1px solid rgba(85,243,255,0.15)', fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
                <strong style={{ color: '#55f3ff' }}>Next steps:</strong>{' '}
                1) Importe o <code style={{ color: '#a78bfa' }}>connector_spec.json</code> em Connectors → Criar.{' '}
                2) Copie <code style={{ color: '#38bdf8' }}>agent.py</code> para <code>/opt/orbit-agents/</code> no servidor e edite as variáveis de configuração.{' '}
                3) Agende via cron: <code>*/2 * * * * python3 /opt/orbit-agents/agent.py</code>
              </div>

              <button onClick={() => setPluginResult(null)} style={{ ...S.btnSm, marginTop: 12, color: '#64748b' }}>
                Generate new
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#f87171', fontFamily: 'monospace', background: '#0f0f12', minHeight: '100dvh' }}>
          <div style={{ fontSize: 18, marginBottom: 12, fontWeight: 700 }}>Erro inesperado na interface</div>
          <pre style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 20 }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '8px 20px', cursor: 'pointer', background: '#2d2d8f', border: 'none', color: '#e2e8f0', borderRadius: 8, fontWeight: 600 }}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

export function App() {
  const isMobile = useIsMobile();
  const [tab, setTab]         = React.useState<Tab>('home');
  const [assets, setAssets]   = React.useState<AssetOpt[]>([]);
  const [needsKey, setNeedsKey] = React.useState(false);
  const [, _forceLocale] = React.useReducer((x: number) => x + 1, 0);

  React.useEffect(() => {
    fetch('api/v1/catalog/assets?limit=500', { headers: apiGetHeaders() })
      .then((r) => { if (r.status === 401) { setNeedsKey(true); return null; } return r.json(); })
      .then((j) => { if (j) { setNeedsKey(false); setAssets((j?.assets ?? []).map((a: any) => ({ asset_id: a.asset_id, name: a.name ?? a.asset_id }))); } })
      .catch(e => console.error("[orbit]", e));
  }, [tab]);

  return (
    <ErrorBoundary>
    <div style={S.root}>
      <TopBar tab={tab} setTab={setTab} onLocaleChange={_forceLocale} />
      <div style={{ flex: 1, minWidth: 0, padding: isMobile ? '14px 12px' : '22px 24px' }}>
        {needsKey && tab !== 'admin' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', marginBottom: 18, background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.35)', borderRadius: 12, fontSize: 13, color: '#fbbf24' }}>
            <span style={{ fontSize: 18 }}>⚠</span>
            <span>{t('err_api_key')}<strong>API Key</strong>{t('err_api_key_mid')}</span>
            <button onClick={() => setTab('admin')} style={{ background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.4)', borderRadius: 8, color: '#fbbf24', padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>⚙ Admin</button>
            <span>{t('err_api_key_suffix')}</span>
          </div>
        )}
        {tab === 'home'          && <HomeTab        assets={assets} setTab={setTab} />}
        {tab === 'system'        && <SystemTab />}
        {tab === 'dashboards'    && <DashboardsTab  assets={assets} />}
        {tab === 'src-nagios'    && <NagiosTab      assets={assets} />}
        {tab === 'src-wazuh'     && <EventsTab      key="src-wazuh"     assets={assets} defaultNs="wazuh" />}
        {tab === 'src-fortigate' && <EventsTab      key="src-fortigate" assets={assets} defaultNs="wazuh" />}
        {tab === 'src-n8n'       && <EventsTab      key="src-n8n"       assets={assets} defaultNs="n8n"   />}
        {tab === 'src-otel'      && <EventsTab      key="src-otel"      assets={assets} defaultNs="otel"  />}
        {tab === 'events'        && <EventsTab      key="events"        assets={assets} />}
        {tab === 'metrics'       && <MetricsTab     assets={assets} />}
        {tab === 'correlations'  && <CorrelationsTab assets={assets} />}
        {tab === 'alerts'        && <AlertsTab assets={assets} />}
        {tab === 'connectors'    && <ConnectorsTab />}
        {tab === 'admin'         && <AdminTab setTab={setTab} />}
      </div>
    </div>
    </ErrorBoundary>
  );
}
