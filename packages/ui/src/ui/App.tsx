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
type Tab        = 'home' | 'dashboards' | 'src-nagios' | 'src-wazuh' | 'src-fortigate' | 'src-n8n' | 'events' | 'metrics' | 'correlations' | 'admin';

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
};
const NS_BG: Record<string, string> = {
  nagios:    '#0c1a3a',
  wazuh:     '#1e1040',
  fortigate: '#431407',
  n8n:       '#052e16',
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

// ─── TOP BAR ──────────────────────────────────────────────────────────────────

function TopBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const [fontesDdOpen, setFontesDdOpen] = React.useState(false);
  const [gearDdOpen,   setGearDdOpen]   = React.useState(false);
  const [apiKey, setApiKey] = React.useState(() => localStorage.getItem('orbit_api_key') ?? '');

  // Close dropdowns on outside click
  React.useEffect(() => {
    function handle(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-dd="fontes"]')) setFontesDdOpen(false);
      if (!t.closest('[data-dd="gear"]'))   setGearDdOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function navTabBtn(t: Tab, label: string) {
    const active = tab === t;
    return (
      <button
        key={t}
        onClick={() => setTab(t)}
        style={{
          background: 'transparent',
          border: 'none',
          borderBottom: `2px solid ${active ? '#55f3ff' : 'transparent'}`,
          color: active ? '#55f3ff' : 'rgba(233,238,255,0.65)',
          padding: '0 14px',
          height: 50,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: active ? 700 : 500,
          transition: 'all 0.15s',
          whiteSpace: 'nowrap' as const,
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

  return (
    <div style={S.topbar}>
      {/* Logo */}
      <span style={{ fontSize: 15, fontWeight: 800, color: '#55f3ff', letterSpacing: '0.2px', marginRight: 8, whiteSpace: 'nowrap' }}>
        ◎ Orbit
      </span>

      {/* Divider */}
      <div style={{ width: 1, height: 22, background: 'rgba(140,160,255,0.18)', marginRight: 8 }} />

      {/* Nav tabs */}
      <nav style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
        {navTabBtn('home', 'Home')}

        {/* Fontes dropdown */}
        <div data-dd="fontes" style={{ position: 'relative' }}>
          <button
            onClick={() => setFontesDdOpen(x => !x)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${isFontesActive ? '#55f3ff' : 'transparent'}`,
              color: isFontesActive ? '#55f3ff' : 'rgba(233,238,255,0.65)',
              padding: '0 14px',
              height: 50,
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
            Fontes
            <span style={{ fontSize: 10, opacity: 0.7 }}>{fontesDdOpen ? '▲' : '▼'}</span>
          </button>
          {fontesDdOpen && (
            <div style={ddBase}>
              {(['src-nagios', 'src-wazuh', 'src-fortigate', 'src-n8n'] as Tab[]).map((t, i) => {
                const labels  = ['Nagios', 'Wazuh', 'Fortigate', 'n8n'];
                const colors  = [NS_COLOR.nagios, NS_COLOR.wazuh, NS_COLOR.fortigate, NS_COLOR.n8n];
                const active  = tab === t;
                return (
                  <button
                    key={t}
                    onClick={() => { setTab(t); setFontesDdOpen(false); }}
                    style={{
                      ...ddBtn,
                      background: active ? 'rgba(85,243,255,0.07)' : 'transparent',
                      color: active ? '#e9eeff' : 'rgba(233,238,255,0.75)',
                      fontWeight: active ? 700 : 400,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors[i], flexShrink: 0 }} />
                    {labels[i]}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {navTabBtn('events',       'Eventos')}
        {navTabBtn('metrics',      'Métricas')}
        {navTabBtn('correlations', 'Correlações')}
        {navTabBtn('dashboards',   '⊞ Dashboards')}
      </nav>

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 8 }}>
        <HealthBadge />

        {/* User indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: apiKey ? '#4ade80' : '#fbbf24',
            display: 'inline-block',
          }} />
          <span style={{ color: apiKey ? '#4ade80' : '#fbbf24', fontWeight: 600 }}>
            {apiKey ? 'admin' : 'sem auth'}
          </span>
        </div>

        {/* Gear dropdown */}
        <div data-dd="gear" style={{ position: 'relative' }}>
          <button
            onClick={() => setGearDdOpen(x => !x)}
            title="Configurações"
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
                ⚙ Administração
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
    </div>
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
            <span style={{ color: 'rgba(140,160,255,.5)' }}>{open ? '▲ fechar' : '▶ ver log'}</span>
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
          <button className="orbit-chart-close" onClick={onClose} title="Remover gráfico">×</button>
        )}
        <div className="orbit-chart-canvas-wrap">
          {/* canvas always in DOM so Chart.js can attach on mount */}
          <canvas ref={canvasRef} style={{ display: isEmpty ? 'none' : 'block' }} />
          {isEmpty && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12 }}>
              Sem dados no período
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...S.card, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>EPS — Eventos por segundo</span>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>bucket: {bucketLabel}{loading ? ' · carregando…' : ''}</span>
      </div>
      <div style={{ position: 'relative', height: 160 }}>
        <canvas ref={canvasRef} style={{ display: isEmpty ? 'none' : 'block', width: '100%', height: '100%' }} />
        {isEmpty && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', color: '#64748b', fontSize: 12 }}>
            Sem dados no período
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
      {defaultNs === 'wazuh' && (
        <EpsChart namespace="wazuh" from={from} to={to} />
      )}
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
              <option value="n8n">n8n</option>
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
  const [feedNs, setFeedNs] = React.useState<string[]>(['nagios', 'wazuh', 'fortigate', 'n8n']);

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
              Dashboard espacial • métricas contínuas (Nagios/Wazuh) • <a href="#" onClick={(e) => { e.preventDefault(); setTab('src-nagios'); }} style={{ color: '#55f3ff', textDecoration: 'none' }}>fontes</a>
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
            <div key={k.label} className="orbit-kpi">
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
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
                {[...new Set([...feed.map(e => eventSource(e)), 'nagios', 'wazuh', 'fortigate', 'n8n'])].sort().map(ns => {
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
                    Nenhum evento no período
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
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>Administração</div>
        <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13 }}>Configurações de segurança e acesso à API.</div>
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Proteção da API</div>
        {checking ? (
          <div style={{ color: '#64748b', fontSize: 13 }}>Verificando…</div>
        ) : apiProtected === null ? (
          <div style={{ color: '#f87171', fontSize: 13 }}>Não foi possível verificar o status da API.</div>
        ) : apiProtected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
            <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 13 }}>API protegida</span>
            <span style={{ color: '#64748b', fontSize: 12 }}>— ORBIT_API_KEY configurada no servidor</span>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f87171', display: 'inline-block' }} />
              <span style={{ color: '#f87171', fontWeight: 700, fontSize: 13 }}>API aberta</span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>— sem autenticação</span>
            </div>
            <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.7 }}>
              Qualquer requisição pode ler e ingerir dados sem autenticação.<br />
              Para proteger, defina{' '}
              <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4 }}>ORBIT_API_KEY</code>
              {' '}no servidor orbit-core e reinicie o serviço.
            </div>
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>API Key (client)</div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
          Chave enviada nas requisições desta UI via header <code style={codeStyle}>X-Api-Key</code>.
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
          <button onClick={saveKey} style={S.btnSm}>{saved ? 'Salvo ✓' : 'Salvar'}</button>
        </div>
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Configurar autenticação no servidor</div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12, lineHeight: 1.7 }}>
          A autenticação é controlada pela variável de ambiente <code style={codeStyle}>ORBIT_API_KEY</code> no processo da API.
          Se não definida, a API aceita qualquer requisição sem autenticação.
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
          Todos os connectors suportam <code style={codeStyle}>ORBIT_API_KEY</code> via variável de ambiente.
          Quando definida, o header <code style={codeStyle}>X-Api-Key</code> é enviado automaticamente em cada requisição.
        </div>

        <div style={{ fontWeight: 600, fontSize: 12, color: 'rgba(233,238,255,0.65)', marginBottom: 6 }}>Nagios / Wazuh / n8n</div>
        <pre style={preStyle}>{`export ORBIT_API=http://seu-servidor:3000
export ORBIT_API_KEY=sua-chave-aqui
python3 ship_events.py`}</pre>

        <div style={{ fontWeight: 600, fontSize: 12, color: 'rgba(233,238,255,0.65)', margin: '12px 0 6px' }}>Fortigate</div>
        <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.7 }}>
          Usa o conector Wazuh (<code style={codeStyle}>ship_events.py</code>) — mesma configuração acima.
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
        <button onClick={save} style={S.btnSm}>{saved ? 'Salvo ✓' : 'Salvar'}</button>
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
        <div style={{ ...S.grid3 }}>
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 900 }}>Nagios</div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, letterSpacing: '.05em' }}>ATIVO</span>
            </div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>Serviços, eventos e métricas (perfdata)</div>
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
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, letterSpacing: '.05em' }}>ATIVO</span>
            </div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>Alertas de segurança, regras e logs de auditoria via conector passivo</div>
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
              <button style={S.btn} onClick={() => setTab('events')}>Ver Eventos</button>
            </div>
          </div>
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 900 }}>Fortigate</div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, letterSpacing: '.05em' }}>ATIVO</span>
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
              <button style={S.btn} onClick={() => setTab('events')}>Ver Eventos</button>
            </div>
          </div>
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 900 }}>n8n</div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, letterSpacing: '.05em' }}>ATIVO</span>
            </div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>Falhas e execuções travadas de workflows (Error Trigger + polling)</div>
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
              <button style={S.btn} onClick={() => setTab('events')}>Ver Eventos</button>
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
        chart.data.labels = rows.map(r => {
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
            Sem dados no período
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
    if (assets.length === 0) { setIsEmpty(true); return; }
    setLoading(true);

    // Build proper timeseries_multi query.
    // The AI may generate simplified format {namespace, metric, group_by} — convert to {series:[...]}.
    const wq = widget.query as Record<string, unknown>;
    let q: Record<string, unknown>;
    if (wq.series) {
      // Already proper format
      q = { ...wq, from, to };
    } else {
      // Simplified format: build series from available assets
      const ns     = (wq.namespace as string) ?? '';
      const metric = (wq.metric    as string) ?? '';
      q = {
        kind: 'timeseries_multi',
        from, to,
        series: assets.slice(0, 20).map(a => ({
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

        chart.data.labels = allTs.map(ts => {
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
  }, [widget.id, from, to]);

  return (
    <div className="orbit-chart-box" style={{ gridColumn: `span ${widget.layout.w}` }}>
      <div className="orbit-chart-tag">{widget.title}{loading ? ' · …' : ''}</div>
      <div className="orbit-chart-canvas-wrap">
        <canvas ref={canvasRef} style={{ display: isEmpty ? 'none' : 'block' }} />
        {isEmpty && !loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12 }}>
            Sem dados no período
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
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [widget.id, from, to]);

  return (
    <div className="orbit-chart-box" style={{ gridColumn: `span ${widget.layout.w}`, height: 'auto', minHeight: 180 }}>
      <div className="orbit-chart-tag">{widget.title}{loading ? ' · …' : ''}</div>
      <div style={{ overflowY: 'auto', maxHeight: 280, paddingTop: 8 }}>
        {events.length === 0 && !loading && (
          <div style={{ color: '#64748b', fontSize: 12, padding: '12px 0' }}>Sem eventos no período</div>
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
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [widget.id, from, to]);

  const display = loading ? '…' : value === null ? '—' : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(2);

  return (
    <div className="orbit-chart-box" style={{ gridColumn: `span ${widget.layout.w}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
      <div className="orbit-chart-tag">{widget.title}</div>
      <div style={{ fontSize: 42, fontWeight: 900, color: '#55f3ff', letterSpacing: '-0.02em', marginTop: 16 }}>{display}</div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{(widget.query.metric as string) ?? ''}</div>
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
  metric: string;
  assetId: string;
  severities: string;
  span: 1 | 2;
};

const WIDGET_KINDS = ['timeseries', 'timeseries_multi', 'events', 'eps', 'kpi'];
const TIME_PRESETS = ['60m', '6h', '24h', '7d', '30d'];

function buildWidgetToSpec(w: BuildWidget): WidgetSpec {
  let query: Record<string, unknown> = {};

  if (w.kind === 'eps') {
    query = { kind: 'event_count', namespace: w.namespace };
  } else if (w.kind === 'events') {
    query = { kind: 'events', namespace: w.namespace, limit: 20 };
    if (w.assetId)    query.asset_id   = w.assetId;
    if (w.severities) query.severities = w.severities.split(',').map(s => s.trim()).filter(Boolean);
  } else if (w.kind === 'timeseries_multi') {
    query = { kind: 'timeseries_multi', namespace: w.namespace, metric: w.metric, group_by: ['asset_id'] };
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
      .catch(() => {})
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
      .catch(() => {});
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
      .catch(() => {});
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
    if (!confirm('Deletar este dashboard?')) return;
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
              Painéis personalizados com qualquer fonte de dados.
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
              ▶ Rotação
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
          Nenhum dashboard salvo ainda.<br />
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
            ⏹ Parar rotação
          </button>
        )}
      </div>

      {/* Rotation indicator */}
      {rotating && (
        <div style={{ marginBottom: 14, background: 'rgba(85,243,255,0.06)', border: '1px solid rgba(85,243,255,.18)', borderRadius: 10, padding: '8px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#55f3ff', marginBottom: 6 }}>
            <span>▶ Rotação ativa</span>
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
      span:       (w.layout.w as 1 | 2) ?? 1,
    }));
  });

  // Add widget form
  const [newKind,  setNewKind]  = React.useState('timeseries');
  const [newTitle, setNewTitle] = React.useState('');
  const [newNs,    setNewNs]    = React.useState('');
  const [newMetric,setNewMetric] = React.useState('');
  const [newAsset, setNewAsset] = React.useState('');
  const [newSev,   setNewSev]   = React.useState('');
  const [newSpan,  setNewSpan]  = React.useState<1 | 2>(1);

  // Catalog
  const [nsOpts,     setNsOpts]     = React.useState<string[]>([]);
  const [metricOpts, setMetricOpts] = React.useState<MetricOpt[]>([]);
  React.useEffect(() => {
    // Distinct event namespaces
    fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ query: { kind: 'events', from: relativeFrom(720), to: new Date().toISOString(), limit: 1 } }) })
      .catch(() => {});
    // Metrics catalog (all assets)
    if (assets.length) {
      const promises = assets.slice(0, 5).map(a =>
        fetch(`api/v1/catalog/metrics?asset_id=${encodeURIComponent(a.asset_id)}&limit=200`, { headers: apiGetHeaders() })
          .then(r => r.json())
          .then(j => (j?.metrics ?? []) as MetricOpt[])
          .catch(() => [] as MetricOpt[])
      );
      Promise.all(promises).then(results => {
        const merged = results.flat();
        const seen = new Set<string>();
        const deduped = merged.filter(m => {
          const k = `${m.namespace}:${m.metric}`;
          if (seen.has(k)) return false;
          seen.add(k); return true;
        });
        setMetricOpts(deduped);
        const namespaces = Array.from(new Set(deduped.map(m => m.namespace)));
        setNsOpts(namespaces);
      });
    }
  }, [assets.length]);

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
      setAiError('Configure a Anthropic API Key em Admin → AI Agent antes de usar.');
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
        span:       (w.layout.w as 1 | 2),
      })));
    } catch (e: any) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  }

  function addWidget() {
    if (!newTitle.trim()) return;
    const w: BuildWidget = {
      id:         `w-${Date.now()}`,
      title:      newTitle.trim(),
      kind:       newKind,
      namespace:  newNs,
      metric:     newMetric,
      assetId:    newAsset,
      severities: newSev,
      span:       newSpan,
    };
    setWidgets(prev => [...prev, w]);
    setNewTitle('');
  }

  function removeWidget(id: string) {
    setWidgets(prev => prev.filter(w => w.id !== id));
  }

  async function save() {
    if (!name.trim()) { setSaveErr('Nome do dashboard é obrigatório.'); return; }
    if (widgets.length === 0) { setSaveErr('Adicione pelo menos 1 widget.'); return; }

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
          Descrição
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Opcional" style={{ ...S.input, minWidth: 220 }} />
        </label>
        <label style={S.label}>
          Time preset
          <select value={preset} onChange={e => setPreset(e.target.value)} style={S.select}>
            {TIME_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <button onClick={save} disabled={saving} style={S.btn}>{saving ? 'Salvando…' : 'Salvar'}</button>
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
            placeholder="Descreva o dashboard que deseja criar… ex: quero monitorar CPU e memória dos servidores nagios e ver o EPS do wazuh"
            style={{ ...S.input, flex: 1, minHeight: 64, resize: 'vertical' as const }}
          />
          <button
            onClick={generateWithAI}
            disabled={aiLoading || !aiPrompt.trim()}
            style={{ ...S.btn, whiteSpace: 'nowrap' }}
          >
            {aiLoading ? '…gerando' : '⚡ Gerar com IA'}
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
            Título
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="ex: CPU Usage" style={{ ...S.input, width: 160 }} />
          </label>
          <label style={S.label}>
            Namespace
            <select value={newNs} onChange={e => setNewNs(e.target.value)} style={S.select}>
              <option value="">— qualquer —</option>
              {nsOpts.map(n => <option key={n} value={n}>{n}</option>)}
              <option value="nagios">nagios</option>
              <option value="wazuh">wazuh</option>
              <option value="n8n">n8n</option>
            </select>
          </label>
          {(newKind === 'timeseries' || newKind === 'timeseries_multi' || newKind === 'kpi') && (
            <label style={S.label}>
              Métrica
              <select value={newMetric} onChange={e => setNewMetric(e.target.value)} style={S.select}>
                <option value="">— selecione —</option>
                {filteredMetrics.map(m => (
                  <option key={`${m.namespace}:${m.metric}`} value={m.metric}>{m.metric}</option>
                ))}
              </select>
            </label>
          )}
          {(newKind === 'timeseries' || newKind === 'events') && (
            <label style={S.label}>
              Asset
              <select value={newAsset} onChange={e => setNewAsset(e.target.value)} style={S.select}>
                <option value="">— todos —</option>
                {assets.map(a => <option key={a.asset_id} value={a.asset_id}>{a.name ?? a.asset_id}</option>)}
              </select>
            </label>
          )}
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
          <div style={{ color: '#64748b', fontSize: 13 }}>Nenhum widget adicionado ainda.</div>
        )}
        {widgets.map(w => (
          <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(140,160,255,.10)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.10)', color: '#55f3ff', fontWeight: 700 }}>{w.kind}</span>
            <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{w.title}</span>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {[w.namespace, w.metric, w.assetId].filter(Boolean).join(' · ')}
            </span>
            <span style={{ fontSize: 11, color: '#64748b' }}>span:{w.span}</span>
            <button onClick={() => removeWidget(w.id)} style={{ ...S.btnSm, borderColor: 'rgba(248,113,113,.35)', color: '#f87171', padding: '4px 8px' }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

export function App() {
  const [tab, setTab]         = React.useState<Tab>('home');
  const [assets, setAssets]   = React.useState<AssetOpt[]>([]);
  const [needsKey, setNeedsKey] = React.useState(false);

  React.useEffect(() => {
    fetch('api/v1/catalog/assets?limit=500', { headers: apiGetHeaders() })
      .then((r) => { if (r.status === 401) { setNeedsKey(true); return null; } return r.json(); })
      .then((j) => { if (j) { setNeedsKey(false); setAssets((j?.assets ?? []).map((a: any) => ({ asset_id: a.asset_id, name: a.name ?? a.asset_id }))); } })
      .catch(() => {});
  }, [tab]);

  return (
    <div style={S.root}>
      <TopBar tab={tab} setTab={setTab} />
      <div style={{ flex: 1, minWidth: 0, padding: '22px 24px' }}>
        {needsKey && tab !== 'admin' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', marginBottom: 18, background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.35)', borderRadius: 12, fontSize: 13, color: '#fbbf24' }}>
            <span style={{ fontSize: 18 }}>⚠</span>
            <span>API protegida por chave. Configure a <strong>API Key</strong> em</span>
            <button onClick={() => setTab('admin')} style={{ background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.4)', borderRadius: 8, color: '#fbbf24', padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>⚙ Admin</button>
            <span>para carregar os dados.</span>
          </div>
        )}
        {tab === 'home'          && <HomeTab        assets={assets} setTab={setTab} />}
        {tab === 'dashboards'    && <DashboardsTab  assets={assets} />}
        {tab === 'src-nagios'    && <NagiosTab      assets={assets} />}
        {tab === 'src-wazuh'     && <EventsTab      key="src-wazuh"     assets={assets} defaultNs="wazuh" />}
        {tab === 'src-fortigate' && <EventsTab      key="src-fortigate" assets={assets} defaultNs="wazuh" />}
        {tab === 'src-n8n'       && <EventsTab      key="src-n8n"       assets={assets} defaultNs="n8n"   />}
        {tab === 'events'        && <EventsTab      key="events"        assets={assets} />}
        {tab === 'metrics'       && <MetricsTab     assets={assets} />}
        {tab === 'correlations'  && <CorrelationsTab assets={assets} />}
        {tab === 'admin'         && <AdminTab setTab={setTab} />}
      </div>
    </div>
  );
}
