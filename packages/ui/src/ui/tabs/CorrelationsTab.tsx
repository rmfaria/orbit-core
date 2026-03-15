import React from 'react';
import { Chart } from 'chart.js';
import { t } from '../i18n';
import { S, AssetOpt, CorrelationRow, apiHeaders, apiGetHeaders, fmtTs, relativeFrom, useIsMobile } from '../shared';
import { TimeRangePicker } from '../components';

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

// ─── Correlation summary types ───────────────────────────────────────────────
type CorrSummary = {
  kpis: { total: number; affected_assets: number; namespaces: number; avg_z: number; max_z: number; avg_rel: number; critical_count: number; high_count: number; total_assets: number; total_sources: number };
  by_namespace: { metric_ns: string; anomaly_count: number; avg_z: number; max_z: number; avg_rel: number; asset_count: number; metric_count: number; event_count: number; severe_events: number }[];
  by_asset: { asset_id: string; name: string; anomaly_count: number; avg_z: number; max_z: number; namespace_count: number; critical_count: number; last_anomaly: string; event_count: number; sources: string[]; crit_events: number; high_events: number; last_event: string }[];
  timeline: { bucket: string; event_count: number; severe_count: number; anomaly_count: number }[];
  top_anomalies: { asset_id: string; metric_ns: string; metric: string; z_score: number; rel_change: number; peak_value: number; baseline_avg: number; event_ts: string; detected_at: string }[];
  event_sources: { namespace: string; asset_count: number; event_count: number }[];
};

const CORR_VIEWS = ['overview', 'asset_map', 'timeline', 'details'] as const;
type CorrView = typeof CORR_VIEWS[number];

const CORR_NS_COLORS: Record<string, string> = {};
const CORR_NS_PALETTE = ['#55f3ff', '#a78bfa', '#f87171', '#4ade80', '#fbbf24', '#fb923c', '#ec4899', '#38bdf8', '#a3e635', '#f0abfc'];
let corrNsIdx = 0;
function corrNsColor(ns: string): string {
  if (!CORR_NS_COLORS[ns]) CORR_NS_COLORS[ns] = CORR_NS_PALETTE[corrNsIdx++ % CORR_NS_PALETTE.length];
  return CORR_NS_COLORS[ns];
}

export function CorrelationsTab({ assets }: { assets: AssetOpt[] }) {
  const isMobile = useIsMobile();
  const [view, setView]               = React.useState<CorrView>('overview');
  const [assetId, setAssetId]         = React.useState('');
  const [from, setFrom]               = React.useState(() => relativeFrom(24));
  const [to, setTo]                   = React.useState(() => new Date().toISOString());
  const [rows, setRows]               = React.useState<CorrelationRow[]>([]);
  const [summary, setSummary]         = React.useState<CorrSummary | null>(null);
  const [loading, setLoading]         = React.useState(false);
  const [err, setErr]                 = React.useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = React.useState<number | null>(null);

  // Radar chart refs
  const radarRef  = React.useRef<HTMLCanvasElement | null>(null);
  const radarChart = React.useRef<Chart | null>(null);
  // Timeline chart refs
  const timelineRef  = React.useRef<HTMLCanvasElement | null>(null);
  const timelineChart = React.useRef<Chart | null>(null);

  async function fetchAll() {
    setLoading(true); setErr(null); setExpandedIdx(null);
    try {
      const qp = new URLSearchParams({ from, to, limit: '500' });
      if (assetId) qp.set('asset_id', assetId);
      const sq = new URLSearchParams({ from, to });

      const [rCorr, rSum] = await Promise.all([
        fetch(`api/v1/correlations?${qp}`, { headers: apiGetHeaders() }),
        fetch(`api/v1/correlations/summary?${sq}`, { headers: apiGetHeaders() }),
      ]);
      const [jCorr, jSum] = await Promise.all([rCorr.json(), rSum.json()]);
      if (!jCorr.ok) throw new Error(jCorr.error ?? JSON.stringify(jCorr));
      if (!jSum.ok) throw new Error(jSum.error ?? JSON.stringify(jSum));
      setRows(jCorr.correlations ?? []);
      setSummary(jSum as CorrSummary);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { fetchAll(); }, []);

  // ── Radar chart ──
  React.useEffect(() => {
    const c = radarRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    radarChart.current = new Chart(ctx, {
      type: 'radar',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 400 },
        scales: {
          r: {
            beginAtZero: true,
            grid: { color: 'rgba(140,160,255,.12)' },
            angleLines: { color: 'rgba(140,160,255,.10)' },
            pointLabels: { color: 'rgba(233,238,255,.80)', font: { size: 11, weight: 700 as const } },
            ticks: { color: 'rgba(233,238,255,.45)', backdropColor: 'transparent', font: { size: 9 } },
          },
        },
        plugins: {
          legend: { position: 'bottom' as const, labels: { color: 'rgba(233,238,255,.72)', boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', padding: 14, font: { size: 10, weight: 700 as const } } },
          tooltip: { backgroundColor: 'rgba(3,6,18,.92)', borderColor: 'rgba(140,160,255,.25)', borderWidth: 1, titleColor: 'rgba(233,238,255,.9)', bodyColor: 'rgba(233,238,255,.75)' },
        },
      },
    });
    return () => { radarChart.current?.destroy(); radarChart.current = null; };
  }, []);

  // Update radar data when summary changes
  React.useEffect(() => {
    const chart = radarChart.current;
    if (!chart || !summary || !summary.by_namespace.length) return;
    const ns = summary.by_namespace;
    (chart.data.labels as string[]) = ns.map(n => n.metric_ns);
    // Normalize event counts to fit radar scale alongside anomalies/z-scores
    const maxEvt = Math.max(...ns.map(n => n.event_count), 1);
    const maxAnomaly = Math.max(...ns.map(n => n.anomaly_count), 1);
    const scale = maxAnomaly > 0 ? maxAnomaly / maxEvt : 1;
    chart.data.datasets = [
      {
        label: 'Events (scaled)',
        data: ns.map(n => +(n.event_count * scale).toFixed(1)),
        borderColor: 'rgba(74,222,128,.70)',
        backgroundColor: 'rgba(74,222,128,.08)',
        pointBackgroundColor: 'rgba(74,222,128,.90)',
        pointBorderColor: 'rgba(74,222,128,.90)',
        pointRadius: 3, borderWidth: 1.5,
      },
      {
        label: t('corr_total_anomalies'),
        data: ns.map(n => n.anomaly_count),
        borderColor: 'rgba(85,243,255,.85)',
        backgroundColor: 'rgba(85,243,255,.12)',
        pointBackgroundColor: 'rgba(85,243,255,.95)',
        pointBorderColor: 'rgba(85,243,255,.95)',
        pointRadius: 4, borderWidth: 2,
      },
      {
        label: 'Severe Events',
        data: ns.map(n => n.severe_events),
        borderColor: 'rgba(248,113,113,.80)',
        backgroundColor: 'rgba(248,113,113,.10)',
        pointBackgroundColor: 'rgba(248,113,113,.90)',
        pointBorderColor: 'rgba(248,113,113,.90)',
        pointRadius: 3, borderWidth: 1.5,
      },
      {
        label: t('corr_affected_assets'),
        data: ns.map(n => n.asset_count),
        borderColor: 'rgba(167,139,250,.75)',
        backgroundColor: 'rgba(167,139,250,.08)',
        pointBackgroundColor: 'rgba(167,139,250,.90)',
        pointBorderColor: 'rgba(167,139,250,.90)',
        pointRadius: 3, borderWidth: 1.5,
      },
    ];
    chart.update('none');
  }, [summary]);

  // ── Timeline chart — create/destroy when view changes ──
  React.useEffect(() => {
    if (view !== 'timeline') return;
    const c = timelineRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const chart = new Chart(ctx, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            border: { display: false },
            grid: { color: 'rgba(140,160,255,.05)', drawTicks: false },
            ticks: { color: 'rgba(233,238,255,.50)', maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 10, weight: 600 as const } },
          },
          y: {
            border: { display: false },
            grid: { color: 'rgba(140,160,255,.07)', drawTicks: false },
            ticks: { color: 'rgba(233,238,255,.50)', font: { size: 10, weight: 600 as const } },
            beginAtZero: true,
          },
        },
        plugins: {
          legend: { position: 'bottom' as const, labels: { color: 'rgba(233,238,255,.72)', boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', padding: 12, font: { size: 10, weight: 700 as const } } },
          tooltip: { backgroundColor: 'rgba(3,6,18,.92)', borderColor: 'rgba(140,160,255,.25)', borderWidth: 1, titleColor: 'rgba(233,238,255,.9)', bodyColor: 'rgba(233,238,255,.75)' },
        },
      },
    });
    timelineChart.current = chart;

    // Populate immediately if data is available
    if (summary && summary.timeline.length) {
      const tl = summary.timeline;
      (chart.data.labels as string[]) = tl.map(t => { const d = new Date(t.bucket); return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}h`; });
      chart.data.datasets = [
        { label: 'Events', data: tl.map(t => t.event_count), backgroundColor: 'rgba(85,243,255,.30)', borderColor: 'rgba(85,243,255,.65)', borderWidth: 1, borderRadius: 3 },
        { label: 'Severe', data: tl.map(t => t.severe_count), backgroundColor: 'rgba(248,113,113,.45)', borderColor: 'rgba(248,113,113,.80)', borderWidth: 1, borderRadius: 3 },
        { label: t('corr_anomalies'), data: tl.map(t => t.anomaly_count), backgroundColor: 'rgba(167,139,250,.50)', borderColor: 'rgba(167,139,250,.85)', borderWidth: 1, borderRadius: 3 },
      ];
      chart.update('none');
    }

    return () => { chart.destroy(); timelineChart.current = null; };
  }, [view, summary]);

  const fmtNum = (n: number | null) =>
    n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(3);

  const k = summary?.kpis;

  // Health score: 100 - normalized penalty from anomalies
  function healthScore(anomalyCount: number, avgZ: number, criticalCount: number): number {
    const penalty = Math.min(100, anomalyCount * 2 + avgZ * 8 + criticalCount * 15);
    return Math.max(0, Math.round(100 - penalty));
  }

  function healthColor(score: number): string {
    if (score >= 80) return '#4ade80';
    if (score >= 50) return '#fbbf24';
    return '#f87171';
  }

  const viewLabels: Record<CorrView, string> = {
    overview: t('corr_overview'),
    asset_map: t('corr_asset_map'),
    timeline: t('corr_timeline'),
    details: t('corr_details'),
  };

  return (
    <div>
      {/* Header */}
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 4, color: '#e9eeff' }}>{t('corr_title')}</div>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>
              {t('corr_desc1')} {t('corr_desc2')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button style={S.btn} onClick={fetchAll} disabled={loading}>{loading ? '…' : t('search')}</button>
          </div>
        </div>

        {/* Sub-navigation tabs */}
        <div style={{ display: 'flex', gap: 4, marginTop: 14, overflowX: 'auto', paddingBottom: 2 }}>
          {CORR_VIEWS.map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '7px 16px',
                fontSize: 12,
                fontWeight: 700,
                borderRadius: 8,
                border: '1px solid',
                borderColor: view === v ? 'rgba(85,243,255,.35)' : 'rgba(140,160,255,.12)',
                background: view === v ? 'rgba(85,243,255,.10)' : 'rgba(12,18,40,.35)',
                color: view === v ? '#55f3ff' : 'rgba(233,238,255,.55)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all .15s',
              }}
            >
              {viewLabels[v]}
            </button>
          ))}
        </div>

        {/* Filters (compact) */}
        <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ ...S.label, flex: '0 0 auto' }}>
            Asset
            <select style={S.select} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">{t('all')}</option>
              {assets.map((a) => <option key={a.asset_id} value={a.asset_id}>{a.asset_id}</option>)}
            </select>
          </label>
          <div style={{ flex: 1, minWidth: 200 }}>
            <TimeRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
          </div>
        </div>
        {err && <div style={{ ...S.err, marginTop: 8 }}>{err}</div>}
      </div>

      {/* ── OVERVIEW ── */}
      {view === 'overview' && (
        <div>
          {/* KPI strip */}
          {k && (
            <div className="orbit-kpi-strip" style={{ padding: '0 0 14px' }}>
              {[
                { label: 'Assets', value: String(k.total_assets), color: 'rgba(85,243,255,.40)' },
                { label: 'Sources', value: String(k.total_sources), color: 'rgba(167,139,250,.40)' },
                { label: t('corr_total_anomalies'), value: String(k.total), color: 'rgba(248,113,113,.40)' },
                { label: t('corr_affected_assets'), value: String(k.affected_assets), color: 'rgba(251,191,36,.40)' },
                { label: t('corr_avg_zscore'), value: k.avg_z.toFixed(2) + 'σ', color: 'rgba(251,191,36,.40)' },
                { label: t('corr_critical'), value: String(k.critical_count), color: 'rgba(248,113,113,.50)' },
                { label: t('corr_high'), value: String(k.high_count), color: 'rgba(74,222,128,.40)' },
              ].map(kpi => (
                <div key={kpi.label} className="orbit-kpi" style={{ '--kpi-color': kpi.color } as React.CSSProperties}>
                  <div className="kpi-label">{kpi.label}</div>
                  <div className="kpi-value" style={{ color: '#e9eeff' }}>{kpi.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Radar + Top Anomalies side by side */}
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', alignItems: 'start' }}>
            {/* Radar chart */}
            <div className="orbit-panel">
              <div className="orbit-panel-head">
                <span className="orbit-panel-title">{t('corr_radar_title')}</span>
              </div>
              <div style={{ padding: 16, height: isMobile ? 260 : 320 }}>
                <canvas ref={radarRef} style={{ width: '100%', height: '100%' }} />
              </div>
            </div>

            {/* Top anomalies */}
            <div className="orbit-panel">
              <div className="orbit-panel-head">
                <span className="orbit-panel-title">{t('corr_top_anomalies')}</span>
              </div>
              <div style={{ padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(summary?.top_anomalies ?? []).map((a, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(140,160,255,.10)',
                    background: 'rgba(3,6,18,.40)',
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: a.z_score >= 4 ? 'rgba(248,113,113,.15)' : 'rgba(251,191,36,.12)',
                      border: `1px solid ${a.z_score >= 4 ? 'rgba(248,113,113,.30)' : 'rgba(251,191,36,.25)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800,
                      color: a.z_score >= 4 ? '#f87171' : '#fbbf24',
                    }}>
                      {i + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#e9eeff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.asset_id}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>
                        <span style={{ color: corrNsColor(a.metric_ns) }}>{a.metric_ns}</span>/{a.metric}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <ZScore z={a.z_score} />
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                        <RelChange r={a.rel_change} />
                      </div>
                    </div>
                  </div>
                ))}
                {(!summary?.top_anomalies?.length) && (
                  <div style={{ color: '#64748b', textAlign: 'center', padding: 24, fontSize: 13 }}>
                    {t('corr_no_data')}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Namespace breakdown cards */}
          {summary && summary.by_namespace.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: `repeat(auto-fill, minmax(min(240px, 100%), 1fr))` }}>
                {summary.by_namespace.map(ns => (
                  <div key={ns.metric_ns} style={{
                    padding: '14px 16px',
                    borderRadius: 14,
                    border: '1px solid rgba(140,160,255,.12)',
                    borderTop: `2px solid ${corrNsColor(ns.metric_ns)}`,
                    background: 'rgba(3,6,18,.45)',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: corrNsColor(ns.metric_ns), marginBottom: 8 }}>
                      {ns.metric_ns}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: 11 }}>
                      <div><span style={{ color: '#64748b' }}>events</span> <span style={{ color: '#4ade80', fontWeight: 700 }}>{ns.event_count >= 1000 ? `${(ns.event_count/1000).toFixed(1)}k` : ns.event_count}</span></div>
                      <div><span style={{ color: '#64748b' }}>assets</span> <span style={{ color: '#e9eeff', fontWeight: 700 }}>{ns.asset_count}</span></div>
                      <div><span style={{ color: '#64748b' }}>{t('corr_anomalies')}</span> <span style={{ color: '#55f3ff', fontWeight: 700 }}>{ns.anomaly_count}</span></div>
                      <div><span style={{ color: '#64748b' }}>severe</span> <span style={{ color: '#f87171', fontWeight: 700 }}>{ns.severe_events}</span></div>
                      <div><span style={{ color: '#64748b' }}>avg z</span> <span style={{ color: '#fbbf24', fontWeight: 700 }}>{ns.avg_z.toFixed(2)}σ</span></div>
                      <div><span style={{ color: '#64748b' }}>Δ avg</span> <span style={{ color: '#fb923c', fontWeight: 700 }}>{(ns.avg_rel * 100).toFixed(1)}%</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ASSET MAP ── */}
      {view === 'asset_map' && (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: `repeat(auto-fill, minmax(min(280px, 100%), 1fr))` }}>
          {(summary?.by_asset ?? []).map(a => {
            const score = healthScore(a.anomaly_count + a.crit_events, a.avg_z, a.critical_count + a.crit_events);
            const color = healthColor(score);
            const srcList = Array.isArray(a.sources) ? a.sources : [];
            return (
              <div key={a.asset_id} style={{
                padding: '16px 18px',
                borderRadius: 14,
                border: `1px solid ${score < 50 ? 'rgba(248,113,113,.20)' : score < 80 ? 'rgba(251,191,36,.18)' : 'rgba(140,160,255,.12)'}`,
                background: 'rgba(3,6,18,.45)',
                position: 'relative',
                overflow: 'hidden',
              }}>
                {/* Health indicator bar */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${color}, transparent)` }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#e9eeff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.asset_id}>
                      {a.name || a.asset_id}
                    </div>
                    {a.name && a.name !== a.asset_id && (
                      <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.asset_id}>{a.asset_id}</div>
                    )}
                    {/* Source tags */}
                    <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                      {srcList.map(s => (
                        <span key={s} style={{
                          fontSize: 9, padding: '2px 7px', borderRadius: 999,
                          background: `${corrNsColor(s)}18`,
                          border: `1px solid ${corrNsColor(s)}35`,
                          color: corrNsColor(s),
                          fontWeight: 700, letterSpacing: '.3px',
                        }}>{s}</span>
                      ))}
                    </div>
                  </div>
                  {/* Health score circle */}
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    border: `2px solid ${color}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column',
                    flexShrink: 0, marginLeft: 10,
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color, lineHeight: 1 }}>{score}</div>
                    <div style={{ fontSize: 7, color: 'rgba(233,238,255,.40)', letterSpacing: '.5px', textTransform: 'uppercase' }}>score</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, fontSize: 11 }}>
                  <div style={{ textAlign: 'center', padding: '5px 0', borderRadius: 8, background: 'rgba(74,222,128,.06)', border: '1px solid rgba(74,222,128,.10)' }}>
                    <div style={{ fontWeight: 800, color: '#4ade80' }}>{a.event_count >= 1000 ? `${(a.event_count/1000).toFixed(1)}k` : a.event_count}</div>
                    <div style={{ fontSize: 8, color: '#64748b' }}>events</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '5px 0', borderRadius: 8, background: 'rgba(85,243,255,.06)', border: '1px solid rgba(85,243,255,.10)' }}>
                    <div style={{ fontWeight: 800, color: '#55f3ff' }}>{a.anomaly_count}</div>
                    <div style={{ fontSize: 8, color: '#64748b' }}>{t('corr_anomalies')}</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '5px 0', borderRadius: 8, background: 'rgba(248,113,113,.06)', border: '1px solid rgba(248,113,113,.10)' }}>
                    <div style={{ fontWeight: 800, color: '#f87171' }}>{a.crit_events + a.critical_count}</div>
                    <div style={{ fontSize: 8, color: '#64748b' }}>critical</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '5px 0', borderRadius: 8, background: 'rgba(251,191,36,.06)', border: '1px solid rgba(251,191,36,.10)' }}>
                    <div style={{ fontWeight: 800, color: '#fbbf24' }}>{a.high_events}</div>
                    <div style={{ fontSize: 8, color: '#64748b' }}>high</div>
                  </div>
                </div>

                <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>
                  {a.last_event ? `${t('corr_last_seen')}: ${fmtTs(a.last_event)}` : a.last_anomaly ? `${t('corr_last_seen')}: ${fmtTs(a.last_anomaly)}` : ''}
                </div>
              </div>
            );
          })}
          {(!summary?.by_asset?.length) && (
            <div style={{ ...S.card, color: '#64748b', textAlign: 'center', padding: 32 }}>
              {t('corr_no_data')}
            </div>
          )}
        </div>
      )}

      {/* ── TIMELINE ── */}
      {view === 'timeline' && (
        <div className="orbit-panel">
          <div className="orbit-panel-head">
            <span className="orbit-panel-title">{t('corr_timeline')}</span>
            <span className="orbit-panel-meta">{summary?.timeline?.length ?? 0} buckets</span>
          </div>
          <div style={{ padding: 16, height: isMobile ? 200 : 280 }}>
            <canvas ref={timelineRef} style={{ width: '100%', height: '100%' }} />
          </div>
        </div>
      )}

      {/* ── DETAIL TABLE ── */}
      {view === 'details' && (
        <div>
          {rows.length === 0 && !loading && !err && (
            <div style={{ ...S.card, color: '#64748b', textAlign: 'center', padding: 32 }}>
              {t('corr_no_data')}
            </div>
          )}

          {rows.length > 0 && (
            <div style={{ ...S.card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 370px)', minHeight: 240 }}>
              <table style={{ ...S.table, tableLayout: 'fixed', minWidth: 560 }}>
                <colgroup>
                  <col style={{ width: 88 }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '22%' }} />
                  <col />
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
                          <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap', color: '#64748b' }}>
                            {fmtTs(r.event_ts)}
                          </td>
                          <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.asset_id}>
                            {r.asset_id}
                          </td>
                          <td style={{ ...S.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${r.metric_ns}/${r.metric}`}>
                            <span style={{ color: corrNsColor(r.metric_ns), fontSize: 10 }}>{r.metric_ns}/</span>
                            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.metric}</span>
                          </td>
                          <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                            <span style={{ color: '#94a3b8' }}>{fmtNum(r.baseline_avg)}</span>
                            <span style={{ color: '#475569', margin: '0 4px' }}>→</span>
                            <span style={{ color: '#f0abfc' }}>{fmtNum(r.peak_value)}</span>
                          </td>
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
      )}
    </div>
  );
}
