import React from 'react';
import { Chart, registerables } from 'chart.js';
import './home.css';

// Register Chart.js components once.
Chart.register(...registerables);


// ─── types ────────────────────────────────────────────────────────────────────

type Row        = { ts: string; value: number };
type MultiRow   = { ts: string; series: string; value: number };
type EventRow   = { ts: string; asset_id: string; namespace: string; kind: string; severity: string; title: string; message: string };
type AssetOpt   = { asset_id: string; name: string };
type MetricOpt  = { namespace: string; metric: string; last_ts?: string };
type Tab        = 'home' | 'sources' | 'nagios' | 'events' | 'metrics' | 'correlations';

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
  nagios: '#38bdf8',
  wazuh:  '#a78bfa',
};
const NS_BG: Record<string, string> = {
  nagios: '#0c1a3a',
  wazuh:  '#1e1040',
};

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

// Build fetch headers — reads API key from sessionStorage if present.
function apiHeaders(): HeadersInit {
  const key = sessionStorage.getItem('orbit_api_key') ?? '';
  const h: HeadersInit = { 'content-type': 'application/json' };
  if (key) (h as Record<string, string>)['x-api-key'] = key;
  return h;
}

// GET helper (no body, still needs key header via ?).
function apiGetHeaders(): HeadersInit {
  const key = sessionStorage.getItem('orbit_api_key') ?? '';
  if (!key) return {};
  return { 'x-api-key': key };
}

// ─── canvas chart ─────────────────────────────────────────────────────────────

function drawChart(canvas: HTMLCanvasElement, rows: Row[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // We draw in CSS pixel coordinates (ctx is scaled in the resize step).
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(canvas.width / dpr));
  const h = Math.max(1, Math.floor(canvas.height / dpr));
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, w, h);

  const padL = 56, padR = 16, padT = 16, padB = 32;

  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + ((h - padT - padB) * i) / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  }

  if (!rows.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '14px system-ui';
    ctx.fillText('No data', padL + 8, padT + 28);
    return;
  }

  const vals = rows.map((r) => r.value);
  let vmin = Math.min(...vals), vmax = Math.max(...vals);
  if (vmin === vmax) { vmin -= 1; vmax += 1; }

  const x0 = padL, x1 = w - padR, y0 = padT, y1 = h - padB;
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

  // Y labels
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '11px system-ui';
  const fmtV = (v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(2);
  ctx.fillText(fmtV(vmax), 4, y0 + 12);
  ctx.fillText(fmtV((vmin + vmax) / 2), 4, (y0 + y1) / 2 + 4);
  ctx.fillText(fmtV(vmin), 4, y1);

  // X labels (first / mid / last)
  const fmt = (ts: string) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  ctx.fillText(fmt(rows[0].ts), x0, h - 10);
  if (rows.length > 2) ctx.fillText(fmt(rows[Math.floor(rows.length / 2)].ts), (x0 + x1) / 2 - 16, h - 10);
  ctx.fillText(fmt(rows[rows.length - 1].ts), x1 - 36, h - 10);
}

function drawMultiChart(canvas: HTMLCanvasElement, rows: MultiRow[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // We draw in CSS pixel coordinates (ctx is scaled in the resize step).
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(canvas.width / dpr));
  const h = Math.max(1, Math.floor(canvas.height / dpr));
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, w, h);

  const padL = 56, padR = 16, padT = 16, padB = 32;

  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + ((h - padT - padB) * i) / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  }

  if (!rows.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '14px system-ui';
    ctx.fillText('No data', padL + 8, padT + 28);
    return;
  }

  const bySeries = new Map<string, Array<{ ts: string; value: number }>>();
  for (const r of rows) {
    const arr = bySeries.get(r.series) ?? [];
    arr.push({ ts: r.ts, value: r.value });
    bySeries.set(r.series, arr);
  }
  // sort each series by ts
  for (const [k, arr] of bySeries) {
    arr.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    bySeries.set(k, arr);
  }

  const allVals: number[] = [];
  for (const arr of bySeries.values()) for (const p of arr) allVals.push(p.value);
  let vmin = Math.min(...allVals), vmax = Math.max(...allVals);
  if (vmin === vmax) { vmin -= 1; vmax += 1; }

  // build a global timeline (unique timestamps)
  const tsSet = new Set<string>();
  for (const arr of bySeries.values()) for (const p of arr) tsSet.add(p.ts);
  const tsList = Array.from(tsSet).sort((a, b) => Date.parse(a) - Date.parse(b));

  const x0 = padL, x1 = w - padR, y0 = padT, y1 = h - padB;
  const toX = (i: number) => x0 + ((x1 - x0) * i) / Math.max(1, tsList.length - 1);
  const toY = (v: number) => y1 - ((y1 - y0) * (v - vmin)) / (vmax - vmin);

  const palette = ['#55f3ff', '#9b7cff', '#60a5fa', '#fbbf24', '#a3e635', '#fb7185'];
  const keys = Array.from(bySeries.keys());

  // draw lines
  keys.forEach((seriesKey, idx) => {
    const color = palette[idx % palette.length];
    const points = bySeries.get(seriesKey)!;
    const map = new Map(points.map(p => [p.ts, p.value] as const));

    ctx.beginPath();
    let started = false;
    tsList.forEach((ts, i) => {
      const v = map.get(ts);
      if (v === undefined || v === null) return;
      const x = toX(i);
      const y = toY(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // Y labels
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '11px system-ui';
  const fmtV = (v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(2);
  ctx.fillText(fmtV(vmax), 4, y0 + 12);
  ctx.fillText(fmtV((vmin + vmax) / 2), 4, (y0 + y1) / 2 + 4);
  ctx.fillText(fmtV(vmin), 4, y1);

  // X labels (first / mid / last)
  const fmt = (ts: string) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  ctx.fillText(fmt(tsList[0]), x0, h - 10);
  if (tsList.length > 2) ctx.fillText(fmt(tsList[Math.floor(tsList.length / 2)]), (x0 + x1) / 2 - 16, h - 10);
  ctx.fillText(fmt(tsList[tsList.length - 1]), x1 - 36, h - 10);

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
    background:
      'radial-gradient(1000px 640px at 18% 10%, rgba(85,243,255,0.10), transparent 55%),' +
      'radial-gradient(900px 560px at 82% 78%, rgba(155,124,255,0.11), transparent 58%),' +
      'linear-gradient(180deg, #040713, #0b1220)',
  } as React.CSSProperties,
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    backdropFilter: 'blur(10px)',
    background: 'rgba(4,7,19,0.72)',
    borderBottom: '1px solid rgba(140,160,255,0.16)',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    height: 56,
  } as React.CSSProperties,
  logo: { fontSize: 18, fontWeight: 800, color: '#55f3ff', marginRight: 8, letterSpacing: '0.2px' } as React.CSSProperties,
  tabBar: {
    display: 'flex',
    gap: 0,
    marginLeft: 16,
  } as React.CSSProperties,
  body: { padding: '22px 24px', maxWidth: 1160, margin: '0 auto' } as React.CSSProperties,
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

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'rgba(12,18,40,0.55)' : 'transparent',
        border: '1px solid transparent',
        borderBottom: active ? '2px solid rgba(85,243,255,0.85)' : '2px solid transparent',
        color: active ? '#e9eeff' : 'rgba(233,238,255,0.70)',
        padding: '12px 14px 10px',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 800,
        letterSpacing: '0.02em',
        borderRadius: 12,
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
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
  const [key, setKey] = React.useState(() => sessionStorage.getItem('orbit_api_key') ?? '');
  const [saved, setSaved] = React.useState(false);

  function save() {
    sessionStorage.setItem('orbit_api_key', key);
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
    if (!assetId || !namespace || !metric) { setErr('Selecione asset / namespace / metric'); return; }
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
        <div style={{ ...S.grid4, marginBottom: 10 }}>
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
        <div style={{ ...S.grid2, marginBottom: 10 }}>
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

// ─── EVENTS TAB ───────────────────────────────────────────────────────────────

const SEVERITY_OPTS = ['', 'critical', 'high', 'medium', 'low', 'info'];

function EventsTab({ assets }: { assets: AssetOpt[] }) {
  const [assetId, setAssetId]     = React.useState('');
  const [namespace, setNamespace] = React.useState('');
  const [severity, setSeverity]   = React.useState('');
  const [from, setFrom]           = React.useState(() => relativeFrom(24));
  const [to, setTo]               = React.useState(() => new Date().toISOString());
  const [events, setEvents]       = React.useState<EventRow[]>([]);
  const [loading, setLoading]     = React.useState(false);
  const [err, setErr]             = React.useState<string | null>(null);

  async function run() {
    setLoading(true); setErr(null);
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

  // Auto-run on mount
  React.useEffect(() => { run(); }, []);

  return (
    <div>
      <div style={S.card}>
        <div style={{ ...S.grid4, marginBottom: 10 }}>
          <label style={S.label}>
            Asset
            <select style={S.select} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">— Todos —</option>
              {assets.map((a) => <option key={a.asset_id} value={a.asset_id}>{a.asset_id}</option>)}
            </select>
          </label>
          <label style={S.label}>
            Namespace
            <select style={S.select} value={namespace} onChange={(e) => setNamespace(e.target.value)}>
              <option value="">— Todos —</option>
              <option value="nagios">nagios</option>
              <option value="wazuh">wazuh</option>
            </select>
          </label>
          <label style={S.label}>
            Severity
            <select style={S.select} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {SEVERITY_OPTS.map((s) => <option key={s} value={s}>{s || '— Todas —'}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Ações</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 2 }}>
              <button style={S.btn} onClick={run} disabled={loading}>{loading ? '…' : 'Buscar'}</button>
              <span style={{ color: '#64748b', fontSize: 12 }}>{events.length} eventos</span>
            </div>
          </div>
        </div>
        <div style={{ ...S.grid2 }}>
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

      <div style={{ ...S.card, padding: 0, overflow: 'auto', maxHeight: 520 }}>
        <table style={S.table}>
          <thead>
            <tr>
              {['Timestamp', 'Asset', 'Namespace', 'Kind', 'Severity', 'Título', 'Mensagem'].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={7} style={{ ...S.td, color: '#64748b', textAlign: 'center', padding: 24 }}>
                Nenhum evento encontrado
              </td></tr>
            )}
            {events.map((ev, i) => (
              <tr key={i} style={{ background: i % 2 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{fmtTs(ev.ts)}</td>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{ev.asset_id}</td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{ev.namespace}</td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{ev.kind}</td>
                <td style={S.td}><SevBadge sev={ev.severity} /></td>
                <td style={{ ...S.td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ev.title}>{ev.title}</td>
                <td style={{ ...S.td, color: '#94a3b8', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ev.message}>{ev.message}</td>
              </tr>
            ))}
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
  const [assetId, setAssetId]   = React.useState('');
  const [stateFilter, setStateFilter] = React.useState('');
  const [from, setFrom]         = React.useState(() => relativeFrom(24));
  const [to, setTo]             = React.useState(() => new Date().toISOString());
  const [services, setServices] = React.useState<NagiosSvc[]>([]);
  const [loading, setLoading]   = React.useState(false);
  const [err, setErr]           = React.useState<string | null>(null);

  async function run() {
    setLoading(true); setErr(null);
    try {
      // Fetch nagios events (service and host kinds)
      const q: any = { kind: 'events', from, to, namespace: 'nagios', limit: 2000 };
      if (assetId) q.asset_id = assetId;

      const r = await fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ query: q }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));

      const raw: EventRow[] = j?.result?.rows ?? [];

      // Keep only the most recent event per asset_id + title (title encodes host+service in Nagios)
      // title format from ship_events.py: "HTTP CRITICAL", "CPU Load OK", "HOST DOWN", etc.
      // kind from write_hard_event.py: "service" or "host"
      const latestMap = new Map<string, NagiosSvc>();
      for (const ev of raw) {
        // Extract service name: for service events, kind="service" and title contains "SERVICE CHECK_NAME STATE"
        // For host events, kind="host"
        const isHost = ev.kind === 'host';
        const parts = ev.title.split(' ');
        // title = "SERVICE_NAME STATE" or "HOST STATE" — last word is the state
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
      // Sort: critical first, then host order
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
          { label: 'OK / UP',           count: counts.ok,       color: '#4ade80' },
          { label: 'WARNING',           count: counts.warning,  color: '#fbbf24' },
          { label: 'CRITICAL / DOWN',   count: counts.critical, color: '#f87171' },
          { label: 'UNKNOWN',           count: counts.unknown,  color: '#94a3b8' },
        ].map(({ label, count, color }) => (
          <div key={label} style={{
            background: '#1e293b',
            border: `1px solid ${color}44`,
            borderRadius: 8,
            padding: '8px 16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            minWidth: 100,
          }}>
            <span style={{ fontSize: 22, fontWeight: 700, color }}>{count}</span>
            <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={S.card}>
        <div style={{ ...S.grid4, marginBottom: 10 }}>
          <label style={S.label}>
            Host
            <select style={S.select} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">— Todos —</option>
              {assets.map((a) => <option key={a.asset_id} value={a.asset_id}>{a.asset_id}</option>)}
            </select>
          </label>
          <label style={S.label}>
            Estado
            <select style={S.select} value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
              {states.map((s) => <option key={s} value={s}>{s || '— Todos —'}</option>)}
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
          <button style={S.btn} onClick={run} disabled={loading}>{loading ? 'Buscando…' : 'Buscar'}</button>
          <span style={{ color: '#64748b', fontSize: 12 }}>{services.length} serviços</span>
        </div>
        {err && <div style={S.err}>{err}</div>}
      </div>

      <div style={{ ...S.card, padding: 0, overflow: 'auto', maxHeight: 560 }}>
        <table style={S.table}>
          <thead>
            <tr>
              {['Estado', 'Host', 'Serviço', 'Severity', 'Última mudança', 'Output'].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {services.length === 0 && (
              <tr><td colSpan={6} style={{ ...S.td, color: '#64748b', textAlign: 'center', padding: 24 }}>
                Nenhum serviço Nagios encontrado no período
              </td></tr>
            )}
            {services.map((svc, i) => (
              <tr key={i} style={{ background: i % 2 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                <td style={S.td}><StateBadge state={svc.state} /></td>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{svc.asset_id}</td>
                <td style={{ ...S.td, fontWeight: 500 }}>{svc.service}</td>
                <td style={S.td}><SevBadge sev={svc.severity} /></td>
                <td style={{ ...S.td, fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtTs(svc.ts)}</td>
                <td style={{ ...S.td, color: '#94a3b8', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={svc.output}>{svc.output}</td>
              </tr>
            ))}
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
  const [feedNs, setFeedNs] = React.useState<string[]>(['nagios', 'wazuh']);

  // Layout toggle: 'side' = charts left + feed right; 'below' = charts above + feed below
  const [chartLayout, setChartLayout] = React.useState<'side' | 'below'>('side');

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
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  async function runPulse() {
    if (!assetId) return;
    setErr(null);
    try {
      const qCpu = {
        language: 'orbitql',
        query: {
          kind: 'timeseries_multi',
          from,
          to,
          agg: 'avg',
          series: [
            { asset_id: assetId, namespace: 'nagios', metric: 'load1', dimensions: { service: 'CPU Load' }, label: 'load1' },
            { asset_id: assetId, namespace: 'nagios', metric: 'load5', dimensions: { service: 'CPU Load' }, label: 'load5' },
            { asset_id: assetId, namespace: 'nagios', metric: 'load15', dimensions: { service: 'CPU Load' }, label: 'load15' },
          ],
          limit: 12000,
        }
      };

      const qDisk = {
        language: 'orbitql',
        query: {
          kind: 'timeseries_multi',
          from,
          to,
          agg: 'avg',
          series: [
            { asset_id: assetId, namespace: 'nagios', metric: 'aqu', dimensions: { service: 'Disk_Queue_sda' }, label: 'aqu-sz' },
            { asset_id: assetId, namespace: 'nagios', metric: 'util', dimensions: { service: 'Disk_Queue_sda' }, label: '%util' },
          ],
          limit: 12000,
        }
      };

      const qNet = {
        language: 'orbitql',
        query: {
          kind: 'timeseries_multi',
          from,
          to,
          agg: 'avg',
          series: [
            { asset_id: assetId, namespace: 'nagios', metric: 'rx_mbps', dimensions: { service: 'Network_Traffic_eth0' }, label: 'RX Mbps' },
            { asset_id: assetId, namespace: 'nagios', metric: 'tx_mbps', dimensions: { service: 'Network_Traffic_eth0' }, label: 'TX Mbps' },
          ],
          limit: 12000,
        }
      };

      const qSuri = {
        language: 'orbitql',
        query: {
          kind: 'timeseries',
          asset_id: assetId,
          namespace: 'nagios',
          metric: 'alerts',
          from,
          to,
          agg: 'sum',
          dimensions: { service: 'Suricata_Alerts_5m' },
          limit: 20000,
        }
      };

      const qEvents = {
        language: 'orbitql',
        query: {
          kind: 'events',
          from,
          to,
          limit: 200,
        }
      };

      const [rCpu, rDisk, rNet, rSuri, rEv] = await Promise.all([
        fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(qCpu) }).then(r => r.json()),
        fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(qDisk) }).then(r => r.json()),
        fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(qNet) }).then(r => r.json()),
        fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(qSuri) }).then(r => r.json()),
        fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(qEvents) }).then(r => r.json()),
      ]);

      if (!rCpu.ok) throw new Error(rCpu.error ?? JSON.stringify(rCpu));
      if (!rDisk.ok) throw new Error(rDisk.error ?? JSON.stringify(rDisk));
      if (!rNet.ok) throw new Error(rNet.error ?? JSON.stringify(rNet));
      if (!rSuri.ok) throw new Error(rSuri.error ?? JSON.stringify(rSuri));
      if (!rEv.ok) throw new Error(rEv.error ?? JSON.stringify(rEv));

      setCpuRows((rCpu.result?.rows ?? []).map((x: any) => ({ ts: x.ts, series: x.series, value: Number(x.value) })));
      setDiskRows((rDisk.result?.rows ?? []).map((x: any) => ({ ts: x.ts, series: x.series, value: Number(x.value) })));
      setNetRows((rNet.result?.rows ?? []).map((x: any) => ({ ts: x.ts, series: x.series, value: Number(x.value) })));
      setSuriRows((rSuri.result?.rows ?? []).map((x: any) => ({ ts: x.ts, value: Number(x.value) })));
      setFeed((rEv.result?.rows ?? []) as EventRow[]);

      // fetch extra charts in parallel
      if (extraCharts.length) {
        const extras = await Promise.all(
          extraCharts.map(cfg =>
            fetch('api/v1/query', {
              method: 'POST', headers: apiHeaders(),
              body: JSON.stringify({
                language: 'orbitql',
                query: { kind: 'timeseries', asset_id: assetId, namespace: cfg.ns, metric: cfg.metric, from, to, agg: 'avg', limit: 20000 },
              }),
            }).then(r => r.json()).then(j => ({ id: cfg.id, rows: (j.result?.rows ?? []).map((x: any) => ({ ts: x.ts, value: Number(x.value) })) }))
          )
        );
        const newExtra: Record<string, Row[]> = {};
        for (const e of extras) newExtra[e.id] = e.rows;
        setExtraRows(newExtra);
      }

    } catch (e: any) {
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
      data: {
        labels: [],
        datasets,
      },
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
              font: { size: 10, weight: '600' },
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
              font: { size: 10, weight: '600' },
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
              font: { size: 10, weight: '700' },
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

  const lastCpu: Record<string, number> = {};
  for (const r of cpuRows) lastCpu[r.series] = r.value;
  const lastDisk: Record<string, number> = {};
  for (const r of diskRows) lastDisk[r.series] = r.value;
  const lastNet: Record<string, number> = {};
  for (const r of netRows) lastNet[r.series] = r.value;
  const fmtN = (v: any, d = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—');
  const suriLast = suriRows.length ? suriRows[suriRows.length - 1].value : null;

  const dbColor  = health?.db === 'ok' ? '#47ff9a' : health?.db === 'error' ? '#ff4d6d' : '#ffd36a';
  const apiColor = health?.ok ? '#47ff9a' : '#ffd36a';

  const kpis = [
    { label: 'CPU Load',          value: `${fmtN(lastCpu['load1'])} • ${fmtN(lastCpu['load5'])} • ${fmtN(lastCpu['load15'])}`, hint: 'load1 • load5 • load15' },
    { label: 'Disk Queue',        value: `${fmtN(lastDisk['aqu-sz'])} • ${fmtN(lastDisk['%util'])}`,                             hint: 'aqu-sz • %util' },
    { label: 'Net Traffic',       value: `${fmtN(lastNet['RX Mbps'])} • ${fmtN(lastNet['TX Mbps'])}`,                            hint: 'RX Mbps • TX Mbps' },
    { label: 'Suricata Alerts',   value: fmtN(suriLast, 0),                                                                       hint: 'últimos 5 min' },
    { label: 'API',               value: health?.ok ? 'online' : '…',                                                             hint: '/api/v1/health' },
    { label: 'Postgres',          value: health?.db ?? '…',                                                                        hint: 'database' },
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
              Dashboard espacial • métricas contínuas (Nagios/Wazuh) • <a href="#" onClick={(e) => { e.preventDefault(); setTab('sources'); }} style={{ color: '#55f3ff', textDecoration: 'none' }}>fontes</a>
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
            <button className="orbit-pill" style={{ cursor: 'pointer', border: '1px solid rgba(140,160,255,.28)', background: 'rgba(85,243,255,.08)' }}
              onClick={() => setChartLayout(l => l === 'side' ? 'below' : 'side')}
              title="Alternar layout dos gráficos">
              {chartLayout === 'side' ? '⊟ lado' : '⊞ abaixo'}
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="orbit-kpi-strip">
          {kpis.map((k) => (
            <div key={k.label} className="orbit-kpi">
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
              <div className="kpi-hint">{k.hint}</div>
            </div>
          ))}
        </div>

        {/* Charts + feed */}
        <div className={chartLayout === 'below' ? 'orbit-home-below' : 'orbit-home-main'} style={{ padding: '0 16px 16px' }}>
          {/* Charts section */}
          <div>
            {/* Add-chart bar */}
            {(() => {
              const visibleFixed = 4 - hiddenFixed.length;
              const total = visibleFixed + extraCharts.length;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'rgba(233,238,255,.45)', letterSpacing: '.2px' }}>
                    {total}/6 gráficos
                  </span>
                  {total < 6 && !showAddChart && (
                    <button className="orbit-badge" style={{ cursor: 'pointer', background: 'rgba(85,243,255,.10)', borderColor: 'rgba(85,243,255,.3)', color: '#55f3ff' }}
                      onClick={() => setShowAddChart(true)}>+ gráfico</button>
                  )}
                  {hiddenFixed.length > 0 && (
                    <button className="orbit-badge" style={{ cursor: 'pointer', background: 'rgba(155,124,255,.10)', borderColor: 'rgba(155,124,255,.3)', color: '#9b7cff' }}
                      onClick={() => setHiddenFixed([])}>↺ restaurar ({hiddenFixed.length})</button>
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
            <div className={`orbit-charts-grid${chartLayout === 'below' ? ' orbit-charts-grid--wide' : ''}`}>
              {!hiddenFixed.includes('cpu') && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">CPU Load</div>
                  <button className="orbit-chart-close" onClick={() => setHiddenFixed(h => [...h, 'cpu'])} title="Remover gráfico">×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={cpuRef} /></div>
                </div>
              )}
              {!hiddenFixed.includes('disk') && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">Disk Queue</div>
                  <button className="orbit-chart-close" onClick={() => setHiddenFixed(h => [...h, 'disk'])} title="Remover gráfico">×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={diskRef} /></div>
                </div>
              )}
              {!hiddenFixed.includes('net') && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">Net Traffic</div>
                  <button className="orbit-chart-close" onClick={() => setHiddenFixed(h => [...h, 'net'])} title="Remover gráfico">×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={netRef} /></div>
                </div>
              )}
              {!hiddenFixed.includes('suri') && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">Suricata Alerts</div>
                  <button className="orbit-chart-close" onClick={() => setHiddenFixed(h => [...h, 'suri'])} title="Remover gráfico">×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={suriRef} /></div>
                </div>
              )}
              {extraCharts[0] && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">{extraCharts[0].label}</div>
                  <button className="orbit-chart-close" title="Remover gráfico"
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
                  <button className="orbit-chart-close" title="Remover gráfico"
                    onClick={() => {
                      setExtraCharts(prev => prev.filter((_, i) => i !== 1));
                      setExtraRows(prev => { const n = { ...prev }; delete n[extraCharts[1].id]; return n; });
                      extra2Chart.current?.destroy(); extra2Chart.current = null;
                    }}>×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={extra2Ref} /></div>
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
                {[...new Set([...feed.map(e => e.namespace), 'nagios', 'wazuh'])].sort().map(ns => {
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
                const visible = feed.filter(e => feedNs.includes(e.namespace));
                if (visible.length === 0) return (
                  <div style={{ color: 'rgba(233,238,255,.45)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                    Nenhum evento no período
                  </div>
                );
                return visible.slice(0, 30).map((e, idx) => (
                  <div key={idx} className="orbit-feed-row">
                    <SevBadge sev={e.severity} />
                    <NsBadge ns={e.namespace} />
                    <div style={{ flex: 1 }}>
                      <strong style={{ display: 'block' }}>{e.title}</strong>
                      <div style={{ fontSize: 12, color: 'rgba(233,238,255,.65)', marginTop: 4, lineHeight: 1.3 }}>{e.message || ''}</div>
                      <div style={{ fontSize: 12, color: 'rgba(233,238,255,.45)', marginTop: 6 }}>{fmtTs(e.ts)}</div>
                    </div>
                  </div>
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
  const [assetId, setAssetId] = React.useState('');
  const [from, setFrom]       = React.useState(() => relativeFrom(24));
  const [to, setTo]           = React.useState(() => new Date().toISOString());
  const [rows, setRows]       = React.useState<CorrelationRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr]         = React.useState<string | null>(null);

  async function run() {
    setLoading(true); setErr(null);
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
        <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 4 }}>Correlações Evento × Métrica</div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
          Anomalias métricas detectadas automaticamente em torno de eventos medium/high/critical.
          z-score ≥ 2σ ou variação relativa ≥ 50%.
        </div>
        <div style={{ ...S.grid4, marginBottom: 10 }}>
          <label style={S.label}>
            Asset
            <select style={S.select} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">— Todos —</option>
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
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Ações</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 2 }}>
              <button style={S.btn} onClick={run} disabled={loading}>{loading ? '…' : 'Buscar'}</button>
              <span style={{ color: '#64748b', fontSize: 12 }}>{rows.length} correlações</span>
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
          Nenhuma correlação encontrada. O worker executa a cada 5 min e requer métricas no
          namespace do mesmo asset_id dos eventos.
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ ...S.card, padding: 0, overflow: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                {['Evento (ts)', 'Asset', 'Métrica', 'Baseline avg', 'Peak', 'z-score', 'Δ rel', 'Detectado em'].map((h) => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{fmtTs(r.event_ts)}</td>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{r.asset_id}</td>
                  <td style={{ ...S.td }}>
                    <span style={{ color: '#94a3b8', fontSize: 11 }}>{r.metric_ns}/</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.metric}</span>
                  </td>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{fmtNum(r.baseline_avg)}</td>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, color: '#f0abfc' }}>{fmtNum(r.peak_value)}</td>
                  <td style={S.td}><ZScore z={r.z_score} /></td>
                  <td style={S.td}><RelChange r={r.rel_change} /></td>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>{fmtTs(r.detected_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
        <div style={{ ...S.grid3 }}>
          <div style={S.card}>
            <div style={{ fontWeight: 900 }}>Nagios</div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>Serviços, eventos e métricas (perfdata)</div>
            <div style={{ marginTop: 10 }}>
              <button style={S.btn} onClick={() => setTab('nagios')}>Open Nagios</button>
            </div>
          </div>
          <div style={S.card}>
            <div style={{ fontWeight: 900 }}>Wazuh</div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>Planned connector</div>
            <div style={{ marginTop: 10 }}>
              <button style={{ ...S.btn, opacity: 0.55, cursor: 'not-allowed' }} disabled>Coming soon</button>
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

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

export function App() {
  const [tab, setTab]       = React.useState<Tab>('home');
  const [assets, setAssets] = React.useState<AssetOpt[]>([]);

  React.useEffect(() => {
    fetch('api/v1/catalog/assets?limit=500', { headers: apiGetHeaders() })
      .then((r) => r.json())
      .then((j) => setAssets((j?.assets ?? []).map((a: any) => ({ asset_id: a.asset_id, name: a.name ?? a.asset_id }))))
      .catch(() => {});
  }, []);

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <span style={S.logo}>◎ Orbit</span>
        <div style={S.tabBar}>
          <TabBtn active={tab === 'home'}         onClick={() => setTab('home')}>Home</TabBtn>
          <TabBtn active={tab === 'sources'}      onClick={() => setTab('sources')}>Fontes</TabBtn>
          <TabBtn active={tab === 'nagios'}       onClick={() => setTab('nagios')}>Nagios</TabBtn>
          <TabBtn active={tab === 'events'}       onClick={() => setTab('events')}>Eventos</TabBtn>
          <TabBtn active={tab === 'metrics'}      onClick={() => setTab('metrics')}>Métricas</TabBtn>
          <TabBtn active={tab === 'correlations'} onClick={() => setTab('correlations')}>Correlações</TabBtn>
        </div>
        <HealthBadge />
      </div>

      {/* Body */}
      <div style={S.body}>
        <ApiKeyBanner />
        {tab === 'home'         && <HomeTab         assets={assets} setTab={setTab} />}
        {tab === 'sources'      && <SourcesTab      setTab={setTab} />}
        {tab === 'nagios'       && <NagiosTab        assets={assets} />}
        {tab === 'events'       && <EventsTab        assets={assets} />}
        {tab === 'metrics'      && <MetricsTab       assets={assets} />}
        {tab === 'correlations' && <CorrelationsTab  assets={assets} />}
      </div>
    </div>
  );
}
