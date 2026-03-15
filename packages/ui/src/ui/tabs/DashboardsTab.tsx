import React from 'react';
import { Chart } from 'chart.js';
import { t } from '../i18n';
import { S, Row, MultiRow, AssetOpt, MetricOpt, EventRow, apiHeaders, apiGetHeaders, relativeFrom } from '../shared';
import { FeedRow } from '../components';
import { EpsChart } from '../EpsChart';
import { makeNeLineChart } from '../chartHelpers';

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

export function DashboardsTab({ assets }: { assets: AssetOpt[] }) {
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 14 }}>
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
    const aiKey   = (localStorage.getItem('ai_api_key') ?? '').trim();
    const aiModel = (localStorage.getItem('ai_model') ?? 'claude-sonnet-4-6').trim();
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
      const text = await r.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Invalid response (HTTP ${r.status}): ${text.slice(0, 200)}`); }
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
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Meu Dashboard" style={{ ...S.input, minWidth: 120, flex: 1 }} />
        </label>
        <label style={S.label}>
          Description
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder={t('optional')} style={{ ...S.input, minWidth: 120, flex: 2 }} />
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
