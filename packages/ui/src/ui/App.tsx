import React from 'react';

// ─── types ────────────────────────────────────────────────────────────────────

type Row        = { ts: string; value: number };
type EventRow   = { ts: string; asset_id: string; namespace: string; kind: string; severity: string; title: string; message: string };
type AssetOpt   = { asset_id: string; name: string };
type MetricOpt  = { namespace: string; metric: string; last_ts?: string };
type Tab        = 'metrics' | 'events' | 'nagios';

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
  const w = canvas.width;
  const h = canvas.height;
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

// ─── styles (inline, no deps) ─────────────────────────────────────────────────

const S = {
  root: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    background: '#0f172a',
    minHeight: '100vh',
    color: '#e2e8f0',
  } as React.CSSProperties,
  header: {
    background: '#1e293b',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    height: 52,
  } as React.CSSProperties,
  logo: { fontSize: 18, fontWeight: 700, color: '#63b3ed', marginRight: 8 } as React.CSSProperties,
  tabBar: {
    display: 'flex',
    gap: 0,
    marginLeft: 16,
  } as React.CSSProperties,
  body: { padding: '20px 24px', maxWidth: 1100 } as React.CSSProperties,
  card: {
    background: '#1e293b',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
  } as React.CSSProperties,
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#94a3b8' } as React.CSSProperties,
  select: {
    background: '#0f172a',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6,
    color: '#e2e8f0',
    padding: '5px 8px',
    fontSize: 13,
  } as React.CSSProperties,
  input: {
    background: '#0f172a',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6,
    color: '#e2e8f0',
    padding: '5px 8px',
    fontSize: 13,
    fontFamily: 'inherit',
  } as React.CSSProperties,
  btn: {
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '7px 16px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  } as React.CSSProperties,
  btnSm: {
    background: 'rgba(255,255,255,0.07)',
    color: '#e2e8f0',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 5,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
  } as React.CSSProperties,
  grid4: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(4, 1fr)' } as React.CSSProperties,
  grid3: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, 1fr)' } as React.CSSProperties,
  grid2: { display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' } as React.CSSProperties,
  row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const } as React.CSSProperties,
  err: { color: '#f87171', fontSize: 13, marginTop: 6 } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 } as React.CSSProperties,
  th: {
    textAlign: 'left' as const,
    padding: '8px 10px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    color: '#94a3b8',
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  } as React.CSSProperties,
  td: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)' } as React.CSSProperties,
};

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
        color: active ? '#63b3ed' : '#94a3b8',
        padding: '14px 18px 12px',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        transition: 'color 0.15s',
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

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

export function App() {
  const [tab, setTab]       = React.useState<Tab>('nagios');
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
          <TabBtn active={tab === 'nagios'}  onClick={() => setTab('nagios')}>Serviços Nagios</TabBtn>
          <TabBtn active={tab === 'events'}  onClick={() => setTab('events')}>Eventos</TabBtn>
          <TabBtn active={tab === 'metrics'} onClick={() => setTab('metrics')}>Métricas</TabBtn>
        </div>
        <HealthBadge />
      </div>

      {/* Body */}
      <div style={S.body}>
        <ApiKeyBanner />
        {tab === 'nagios'  && <NagiosTab  assets={assets} />}
        {tab === 'events'  && <EventsTab  assets={assets} />}
        {tab === 'metrics' && <MetricsTab assets={assets} />}
      </div>
    </div>
  );
}
