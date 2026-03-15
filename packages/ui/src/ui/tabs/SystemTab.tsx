import React from 'react';
import { Chart } from 'chart.js';
import { t } from '../i18n';
import { S, apiGetHeaders, visibleInterval, useIsMobile } from '../shared';

export interface SysData {
  ok: boolean;
  environment: 'container' | 'vps' | 'unknown';
  cpu:     { count: number; model: string; load: [number, number, number] };
  memory:  { total_mb: number; free_mb: number; used_mb: number; percent: number; process_rss_mb: number; process_heap_used_mb: number; process_heap_total_mb: number };
  network: Array<{ name: string; rx_bytes: number; tx_bytes: number; rx_per_sec: number; tx_per_sec: number }>;
  disk:    { total_gb: number; used_gb: number; free_gb: number; percent: number };
  db:      { total: number; idle: number; waiting: number; connected: boolean };
  pg_stats: { db_size_mb: number; cache_hit_pct: number; active_connections: number; tup_fetched_ps: number; tup_written_ps: number } | null;
  workers: Record<string, { alive: boolean; last_beat: string | null; beats: number; errors: number }>;
  process: { pid: number; uptime_sec: number; node_version: string; started_at: string };
}

export function fmtBytes(b: number): string {
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

export function HomeSysIndicators({ data }: { data: SysData | null }) {
  if (!data) return null;

  const { cpu, memory, disk, network } = data;
  const loadPct   = Math.min(100, (cpu.load[0] / cpu.count) * 100);
  const loadColor = cpu.load[0] > cpu.count * 0.8 ? '#ff5dd6' : cpu.load[0] > cpu.count * 0.5 ? '#fbbf24' : '#4ade80';
  const memColor  = memory.percent > 85 ? '#ff5dd6' : memory.percent > 65 ? '#fbbf24' : '#55f3ff';
  const diskColor = disk.percent > 85 ? '#ff5dd6' : disk.percent > 65 ? '#fbbf24' : '#4ade80';
  const primaryIf = network.find((n: any) => n.name === 'eth0') ?? network[0] ?? null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="orbit-grid-4" style={{ gap: 10 }}>
        <SysCard title={t('sys_cpu')} accent="rgba(85,243,255,0.35)">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: loadColor }}>{cpu.load[0].toFixed(2)}</span>
            <span style={{ fontSize: 10, color: 'rgba(233,238,255,0.45)' }}>{cpu.count} vCPU</span>
          </div>
          <Bar pct={loadPct} color={loadColor} />
        </SysCard>

        <SysCard title={t('sys_memory')} accent="rgba(155,124,255,0.35)">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: memColor }}>{memory.percent}%</span>
            <span style={{ fontSize: 10, color: 'rgba(233,238,255,0.45)' }}>{memory.used_mb} / {memory.total_mb} MB</span>
          </div>
          <Bar pct={memory.percent} color={memColor} />
        </SysCard>

        <SysCard title={t('sys_disk')} accent={`rgba(${disk.percent > 85 ? '248,113,113' : disk.percent > 65 ? '251,191,36' : '74,222,128'},0.30)`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: diskColor }}>{disk.percent}%</span>
            <span style={{ fontSize: 10, color: 'rgba(233,238,255,0.45)' }}>{disk.used_gb} / {disk.total_gb} GB</span>
          </div>
          <Bar pct={disk.percent} color={diskColor} />
        </SysCard>

        <SysCard title={t('sys_network')} accent="rgba(251,191,36,0.30)">
          {primaryIf ? (<>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#e9eeff', marginBottom: 2 }}>{primaryIf.name}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11 }}>
              <div style={{ color: '#4ade80' }}>↓ {fmtBytes(primaryIf.rx_per_sec)}</div>
              <div style={{ color: '#55f3ff' }}>↑ {fmtBytes(primaryIf.tx_per_sec)}</div>
            </div>
          </>) : (
            <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.35)' }}>N/A</div>
          )}
        </SysCard>
      </div>
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

// ── EPS types & chart for System tab ─────────────────────────────────────────

interface EpsValues { eps_10s: number; eps_1m: number; eps_5m: number; total: number }
interface EpsSnapshot { ok: boolean; global: EpsValues; sources: Record<string, EpsValues> }
interface EpsHistoryPoint { ts: string; global: number; sources: Record<string, number> }

const EPS_HISTORY_MAX = 60;   // 60 samples × 5s = 5 min
const EPS_COLORS: Record<string, string> = {};
const EPS_PALETTE = ['#55f3ff','#9b7cff','#fb923c','#a3e635','#fb7185','#fbbf24','#60a5fa','#e879f9'];
let epsColorIdx = 0;
function epsColor(source: string): string {
  if (!EPS_COLORS[source]) EPS_COLORS[source] = EPS_PALETTE[epsColorIdx++ % EPS_PALETTE.length];
  return EPS_COLORS[source];
}

function SystemEpsChart() {
  const [history, setHistory] = React.useState<EpsHistoryPoint[]>([]);
  const [latest, setLatest]   = React.useState<EpsSnapshot | null>(null);
  const [mode, setMode]       = React.useState<'line' | 'radar'>('line');
  const [window, setWindow]   = React.useState<'eps_10s' | 'eps_1m' | 'eps_5m'>('eps_1m');
  const lineCanvasRef  = React.useRef<HTMLCanvasElement | null>(null);
  const radarCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const lineChartRef   = React.useRef<Chart | null>(null);
  const radarChartRef  = React.useRef<Chart | null>(null);

  // Poll EPS endpoint
  React.useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch('api/v1/connectors/eps', { headers: apiGetHeaders() });
        if (!r.ok) return;
        const d: EpsSnapshot = await r.json();
        if (cancelled) return;
        setLatest(d);
        const ts = new Date().toISOString();
        const sources: Record<string, number> = {};
        for (const [k, v] of Object.entries(d.sources)) {
          if (k === 'unknown') continue;
          sources[k] = v.eps_1m;
        }
        setHistory(prev => {
          const next = [...prev, { ts, global: d.global.eps_1m, sources }];
          return next.length > EPS_HISTORY_MAX ? next.slice(-EPS_HISTORY_MAX) : next;
        });
      } catch { /* silent */ }
    }
    poll();
    const stop = visibleInterval(poll, 5_000);
    return () => { cancelled = true; stop(); };
  }, []);

  // Create line chart once
  React.useEffect(() => {
    const c = lineCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    lineChartRef.current = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            border: { display: false },
            grid: { color: 'rgba(140,160,255,.05)', drawTicks: false },
            ticks: { color: 'rgba(233,238,255,.50)', maxRotation: 0, autoSkip: true, maxTicksLimit: 7, padding: 6, font: { size: 10, weight: 600 as const } },
          },
          y: {
            stacked: true,
            border: { display: false },
            grid: { color: 'rgba(140,160,255,.07)', drawTicks: false },
            ticks: { color: 'rgba(233,238,255,.50)', padding: 6, font: { size: 10, weight: 600 as const } },
            beginAtZero: true,
          },
        },
        plugins: {
          legend: { position: 'bottom' as const, labels: { color: 'rgba(233,238,255,.72)', boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', padding: 12, font: { size: 10, weight: 700 as const } } },
          tooltip: { backgroundColor: 'rgba(3,6,18,.92)', borderColor: 'rgba(140,160,255,.25)', borderWidth: 1, titleColor: 'rgba(233,238,255,.9)', bodyColor: 'rgba(233,238,255,.75)' },
        },
      },
      plugins: [{
        id: 'epsGlow',
        beforeDatasetsDraw(c) { c.ctx.save(); c.ctx.shadowColor = 'rgba(85,243,255,.22)'; c.ctx.shadowBlur = 14; },
        afterDatasetsDraw(c) { c.ctx.restore(); },
      }],
    });
    return () => { lineChartRef.current?.destroy(); lineChartRef.current = null; };
  }, []);

  // Create radar chart once
  React.useEffect(() => {
    const c = radarCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    radarChartRef.current = new Chart(ctx, {
      type: 'radar',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        scales: {
          r: {
            beginAtZero: true,
            grid: { color: 'rgba(140,160,255,.12)' },
            angleLines: { color: 'rgba(140,160,255,.10)' },
            pointLabels: { color: 'rgba(233,238,255,.75)', font: { size: 11, weight: 700 as const } },
            ticks: { color: 'rgba(233,238,255,.45)', backdropColor: 'transparent', font: { size: 9 } },
          },
        },
        plugins: {
          legend: { labels: { color: 'rgba(233,238,255,.72)', boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', padding: 14, font: { size: 10, weight: 700 as const } } },
          tooltip: { backgroundColor: 'rgba(3,6,18,.92)', borderColor: 'rgba(140,160,255,.25)', borderWidth: 1, titleColor: 'rgba(233,238,255,.9)', bodyColor: 'rgba(233,238,255,.75)' },
        },
      },
    });
    return () => { radarChartRef.current?.destroy(); radarChartRef.current = null; };
  }, []);

  // Update line chart data
  React.useEffect(() => {
    const chart = lineChartRef.current;
    if (!chart || !history.length) return;
    const fmt = (ts: string) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; };
    const labels = history.map(h => fmt(h.ts));

    // Collect all source keys across history
    const allSources = new Set<string>();
    for (const h of history) for (const k of Object.keys(h.sources)) allSources.add(k);
    const sourceKeys = Array.from(allSources).sort();

    const datasets: Chart['data']['datasets'] = [
      // Total — thin dashed line on top (no fill, no stack)
      {
        label: 'Total',
        data: history.map(h => h.global),
        borderColor: 'rgba(255,255,255,.60)',
        backgroundColor: 'transparent',
        tension: 0.35, fill: false, pointRadius: 0, borderWidth: 1.5, borderDash: [5, 3],
        order: 0,
      },
      // Per-source stacked areas
      ...sourceKeys.map(src => ({
        label: src,
        data: history.map(h => h.sources[src] ?? 0),
        borderColor: epsColor(src),
        backgroundColor: epsColor(src) + '30',
        tension: 0.35, fill: true, pointRadius: 0, borderWidth: 1.5,
        stack: 'sources',
        order: 1,
      })),
    ];

    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update('none');
  }, [history]);

  // Update radar chart data
  React.useEffect(() => {
    const chart = radarChartRef.current;
    if (!chart || !latest) return;

    const entries = Object.entries(latest.sources).filter(([k]) => k !== 'unknown');
    if (!entries.length) return;
    const labels = entries.map(([k]) => k);

    chart.data.labels = labels;
    chart.data.datasets = [
      {
        label: `EPS ${window === 'eps_10s' ? '10s' : window === 'eps_1m' ? '1m' : '5m'}`,
        data: entries.map(([, v]) => v[window]),
        borderColor: 'rgba(85,243,255,.85)',
        backgroundColor: 'rgba(85,243,255,.15)',
        pointBackgroundColor: 'rgba(85,243,255,.95)',
        pointBorderColor: 'rgba(85,243,255,.95)',
        pointRadius: 4, borderWidth: 2,
      },
      {
        label: 'Total (scaled)',
        data: entries.map(([, v]) => {
          const maxTotal = Math.max(...entries.map(([, e]) => e.total)) || 1;
          const maxEps = Math.max(...entries.map(([, e]) => e[window])) || 1;
          return (v.total / maxTotal) * maxEps;
        }),
        borderColor: 'rgba(155,124,255,.70)',
        backgroundColor: 'rgba(155,124,255,.10)',
        pointBackgroundColor: 'rgba(155,124,255,.90)',
        pointBorderColor: 'rgba(155,124,255,.90)',
        pointRadius: 3, borderWidth: 1.5,
      },
    ];
    chart.update('none');
  }, [latest, window]);

  const globalEps = latest?.global;

  return (
    <SysCard title="EPS — Events Per Second" accent="rgba(85,243,255,0.35)">
      {/* Header: KPIs + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {globalEps && (
          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#55f3ff' }}>{globalEps.eps_10s.toFixed(1)}</div>
              <div style={{ fontSize: 9, color: 'rgba(233,238,255,0.45)', letterSpacing: '0.5px' }}>10s</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#9b7cff' }}>{globalEps.eps_1m.toFixed(1)}</div>
              <div style={{ fontSize: 9, color: 'rgba(233,238,255,0.45)', letterSpacing: '0.5px' }}>1m</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fbbf24' }}>{globalEps.eps_5m.toFixed(1)}</div>
              <div style={{ fontSize: 9, color: 'rgba(233,238,255,0.45)', letterSpacing: '0.5px' }}>5m</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#e9eeff' }}>{globalEps.total.toLocaleString()}</div>
              <div style={{ fontSize: 9, color: 'rgba(233,238,255,0.45)', letterSpacing: '0.5px' }}>total</div>
            </div>
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {mode === 'radar' && (
            <div style={{ display: 'flex', gap: 2 }}>
              {(['eps_10s', 'eps_1m', 'eps_5m'] as const).map(w => (
                <button key={w} onClick={() => setWindow(w)} style={{
                  padding: '3px 8px', fontSize: 10, fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: window === w ? 'rgba(85,243,255,0.20)' : 'rgba(255,255,255,0.05)',
                  color: window === w ? '#55f3ff' : 'rgba(233,238,255,0.5)',
                }}>{w === 'eps_10s' ? '10s' : w === 'eps_1m' ? '1m' : '5m'}</button>
              ))}
            </div>
          )}
          <button onClick={() => setMode(mode === 'line' ? 'radar' : 'line')} style={{
            padding: '3px 10px', fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid rgba(140,160,255,0.20)', cursor: 'pointer',
            background: 'rgba(255,255,255,0.05)', color: 'rgba(233,238,255,0.7)',
          }}>{mode === 'line' ? 'Radar' : 'Timeline'}</button>
        </div>
      </div>
      {/* Charts */}
      <div style={{ position: 'relative', height: 280 }}>
        <canvas ref={lineCanvasRef}  style={{ display: mode === 'line' ? 'block' : 'none', width: '100%', height: '100%' }} />
        <canvas ref={radarCanvasRef} style={{ display: mode === 'radar' ? 'block' : 'none', width: '100%', height: '100%' }} />
        {!latest && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(233,238,255,0.35)', fontSize: 12 }}>
            Aguardando dados…
          </div>
        )}
      </div>
      {/* Per-source mini table */}
      {latest && Object.keys(latest.sources).filter(k => k !== 'unknown').length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, marginTop: 4 }}>
          {Object.entries(latest.sources).filter(([k]) => k !== 'unknown').sort((a, b) => b[1].eps_1m - a[1].eps_1m).map(([src, v]) => (
            <div key={src} style={{ background: 'rgba(3,6,18,0.5)', border: `1px solid ${epsColor(src)}33`, borderRadius: 8, padding: '6px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: epsColor(src), flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#e9eeff' }}>{src}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, fontSize: 10 }}>
                <div style={{ color: 'rgba(233,238,255,0.45)' }}>10s <span style={{ color: '#94a3b8', fontWeight: 700 }}>{v.eps_10s.toFixed(1)}</span></div>
                <div style={{ color: 'rgba(233,238,255,0.45)' }}>1m <span style={{ color: '#94a3b8', fontWeight: 700 }}>{v.eps_1m.toFixed(1)}</span></div>
                <div style={{ color: 'rgba(233,238,255,0.45)' }}>5m <span style={{ color: '#94a3b8', fontWeight: 700 }}>{v.eps_5m.toFixed(1)}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SysCard>
  );
}

export function SystemTab() {
  const isMobile = useIsMobile();
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
    const stop = visibleInterval(poll, 15_000);
    return () => { cancelled = true; stop(); };
  }, []);

  if (err)   return <div style={{ padding: 32, color: '#ff5dd6' }}>Error: {err}</div>;
  if (!data) return <div style={{ padding: 32, color: 'rgba(233,238,255,0.4)' }}>Carregando sistema…</div>;

  const { cpu, memory, network, disk, db, pg_stats, workers, process: proc } = data;
  const loadColor = cpu.load[0] > cpu.count * 0.8 ? '#ff5dd6' : cpu.load[0] > cpu.count * 0.5 ? '#fbbf24' : '#4ade80';
  const memColor  = memory.percent > 85 ? '#ff5dd6' : memory.percent > 65 ? '#fbbf24' : '#55f3ff';
  const diskColor = disk.percent > 85 ? '#ff5dd6' : disk.percent > 65 ? '#fbbf24' : '#4ade80';

  return (
    <div style={{ padding: isMobile ? '14px 10px 24px' : '20px 24px 40px', maxWidth: 1400 }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 800, color: '#e9eeff' }}>Infraestrutura</div>
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

      {/* Middle row: Network + Disk */}
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

        {/* Disk */}
        <SysCard title="Disco" accent={`rgba(${disk.percent > 85 ? '248,113,113' : disk.percent > 65 ? '251,191,36' : '74,222,128'},0.30)`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 28, fontWeight: 900, color: diskColor }}>{disk.percent}%</span>
            <span style={{ fontSize: 11, color: 'rgba(233,238,255,0.45)' }}>{disk.used_gb} / {disk.total_gb} GB</span>
          </div>
          <Bar pct={disk.percent} color={diskColor} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, marginTop: 2 }}>
            <div style={{ color: 'rgba(233,238,255,0.45)' }}>usado <span style={{ color: '#94a3b8' }}>{disk.used_gb} GB</span></div>
            <div style={{ color: 'rgba(233,238,255,0.45)' }}>livre <span style={{ color: '#94a3b8' }}>{disk.free_gb} GB</span></div>
          </div>
        </SysCard>
      </div>

      {/* DB row: Pool + PostgreSQL I/O */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14, marginBottom: 14 }}>

        {/* DB pool */}
        <SysCard title="PostgreSQL — Pool" accent={db.connected ? 'rgba(74,222,128,0.30)' : 'rgba(255,93,214,0.35)'}>
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

        {/* PostgreSQL I/O & Stats */}
        {pg_stats ? (
          <SysCard title="PostgreSQL — I/O & Stats" accent="rgba(85,243,255,0.25)">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {/* DB Size */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#55f3ff' }}>
                  {pg_stats.db_size_mb >= 1024 ? `${(pg_stats.db_size_mb / 1024).toFixed(1)} GB` : `${pg_stats.db_size_mb} MB`}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(233,238,255,0.45)', marginTop: 2 }}>tamanho DB</div>
              </div>
              {/* Cache Hit */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: pg_stats.cache_hit_pct >= 95 ? '#4ade80' : pg_stats.cache_hit_pct >= 80 ? '#fbbf24' : '#ff5dd6' }}>
                  {pg_stats.cache_hit_pct}%
                </div>
                <div style={{ fontSize: 10, color: 'rgba(233,238,255,0.45)', marginTop: 2 }}>cache hit</div>
                <div style={{ marginTop: 4 }}>
                  <Bar pct={pg_stats.cache_hit_pct} color={pg_stats.cache_hit_pct >= 95 ? '#4ade80' : '#fbbf24'} />
                </div>
              </div>
              {/* Active connections */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#9b7cff' }}>{pg_stats.active_connections}</div>
                <div style={{ fontSize: 10, color: 'rgba(233,238,255,0.45)', marginTop: 2 }}>active connections</div>
              </div>
              {/* Throughput */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#fbbf24' }}>
                  <span style={{ fontSize: 10, display: 'block', color: 'rgba(233,238,255,0.45)', marginBottom: 2 }}>reads/s</span>
                  {pg_stats.tup_fetched_ps.toLocaleString()}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#fb923c', marginTop: 4 }}>
                  <span style={{ fontSize: 10, display: 'block', color: 'rgba(233,238,255,0.45)', marginBottom: 2 }}>writes/s</span>
                  {pg_stats.tup_written_ps.toLocaleString()}
                </div>
              </div>
            </div>
          </SysCard>
        ) : (
          <SysCard title="PostgreSQL — I/O & Stats" accent="rgba(100,116,139,0.25)">
            <div style={{ fontSize: 12, color: 'rgba(233,238,255,0.35)' }}>pg_stat_database não disponível</div>
          </SysCard>
        )}
      </div>

      {/* Workers */}
      <SysCard title={t('sys_workers')} accent="rgba(251,191,36,0.30)">
        <div className="orbit-grid-4" style={{ gap: 12 }}>
          {Object.entries(workers).map(([name, w]) => (
            <WorkerPill key={name} name={name} w={w} />
          ))}
        </div>
      </SysCard>

      {/* EPS */}
      <div style={{ marginTop: 14 }}>
        <SystemEpsChart />
      </div>
    </div>
  );
}
