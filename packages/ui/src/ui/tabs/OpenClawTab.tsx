import React from 'react';
import { Chart } from 'chart.js';
import { t } from '../i18n';
import { S, AssetOpt, EventRow, apiHeaders, apiGetHeaders, relativeFrom, visibleInterval, useIsMobile, fmtTs } from '../shared';
import { SevBadge } from '../components';

// ─── OPENCLAW SALES DASHBOARD ────────────────────────────────────────────────

const OC = {
  accent:   '#ff5dd6',
  purple:   '#9b7cff',
  cyan:     '#55f3ff',
  green:    '#4ade80',
  amber:    '#fbbf24',
  red:      '#f87171',
  panel: {
    background: 'linear-gradient(135deg, rgba(45,10,36,0.55), rgba(12,18,40,0.65))',
    border: '1px solid rgba(255,93,214,0.16)',
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
    backdropFilter: 'blur(16px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,93,214,0.06)',
  } as React.CSSProperties,
};

// ── Metric types ─────────────────────────────────────────────────────────────

type MetricRow = { ts: string; value: number };
type MetricSeries = { metric: string; rows: MetricRow[] };

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, unit, color, icon, delta }: {
  label: string; value: string; unit?: string; color: string; icon: string; delta?: { value: string; positive: boolean } | null;
}) {
  return (
    <div style={{
      background: 'rgba(8,12,28,0.65)',
      border: `1px solid ${color}30`,
      borderRadius: 16,
      padding: '16px 18px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: -10, right: -10, fontSize: 36, opacity: 0.07 }}>{icon}</div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: `${color}aa`, textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 900, color }}>{value}</span>
        {unit && <span style={{ fontSize: 12, color: 'rgba(233,238,255,0.45)' }}>{unit}</span>}
      </div>
      {delta && (
        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: delta.positive ? OC.green : OC.red }}>
          {delta.positive ? '▲' : '▼'} {delta.value}
        </div>
      )}
    </div>
  );
}

// ── Funnel Bar ───────────────────────────────────────────────────────────────

function FunnelBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e9eeff' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color }}>{count}</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${Math.min(100, pct)}%`,
          background: `linear-gradient(90deg, ${color}, ${color}88)`,
          borderRadius: 999, transition: 'width 0.6s ease',
          boxShadow: `0 0 12px ${color}40`,
        }} />
      </div>
    </div>
  );
}

// ── Mini Sparkline (SVG) ─────────────────────────────────────────────────────

function Sparkline({ data, color, width = 120, height = 32 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`sp-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#sp-${color.replace('#','')})`}
      />
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export function OpenClawTab({ assets }: { assets: AssetOpt[] }) {
  const isMobile = useIsMobile();
  const [metrics, setMetrics] = React.useState<MetricSeries[]>([]);
  const [events, setEvents] = React.useState<EventRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [pipeline, setPipeline] = React.useState<Record<string, number>>({});

  // Chart refs
  const mrrCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const mrrChartRef = React.useRef<Chart | null>(null);
  const pipeCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const pipeChartRef = React.useRef<Chart | null>(null);

  // Load data
  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        // Fetch metrics (30 days)
        const metricsToFetch = ['mrr', 'pipeline_value', 'conversion_rate', 'deals_open', 'leads_new', 'avg_deal_size', 'churn_rate', 'nps_score'];
        const metricResults: MetricSeries[] = [];
        for (const m of metricsToFetch) {
          const r = await fetch('api/v1/query', {
            method: 'POST', headers: apiHeaders(),
            body: JSON.stringify({ query: { kind: 'timeseries', from: relativeFrom(24 * 30), to: new Date().toISOString(), namespace: 'openclaw', metric: m, asset_id: 'global' } }),
          });
          const j = await r.json();
          if (j.ok) metricResults.push({ metric: m, rows: j.result?.rows ?? [] });
        }
        if (!cancelled) setMetrics(metricResults);

        // Fetch events (72h)
        const evR = await fetch('api/v1/query', {
          method: 'POST', headers: apiHeaders(),
          body: JSON.stringify({ query: { kind: 'events', from: relativeFrom(72), to: new Date().toISOString(), namespace: 'openclaw', limit: 500 } }),
        });
        const evJ = await evR.json();
        if (!cancelled && evJ.ok) {
          const rows: EventRow[] = evJ.result?.rows ?? [];
          setEvents(rows);
          // Count pipeline stages
          const counts: Record<string, number> = {};
          for (const e of rows) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
          setPipeline(counts);
        }
      } catch { /* silent */ } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const stop = visibleInterval(load, 60_000);
    return () => { cancelled = true; stop(); };
  }, []);

  // MRR Chart
  React.useEffect(() => {
    const c = mrrCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    mrrChartRef.current = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { border: { display: false }, grid: { color: 'rgba(255,93,214,.04)' }, ticks: { color: 'rgba(233,238,255,.45)', maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 10, weight: 600 as const } } },
          y: { border: { display: false }, grid: { color: 'rgba(255,93,214,.06)' }, ticks: { color: 'rgba(233,238,255,.45)', font: { size: 10 }, callback: (v: any) => `R$ ${(v / 1000).toFixed(0)}k` }, beginAtZero: false },
        },
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: 'rgba(3,6,18,.92)', borderColor: 'rgba(255,93,214,.30)', borderWidth: 1, titleColor: 'rgba(233,238,255,.9)', bodyColor: 'rgba(233,238,255,.75)', callbacks: { label: (ctx: any) => `R$ ${ctx.raw?.toLocaleString() ?? 0}` } },
        },
      },
      plugins: [{
        id: 'mrrGlow',
        beforeDatasetsDraw(c) { c.ctx.save(); c.ctx.shadowColor = 'rgba(255,93,214,.25)'; c.ctx.shadowBlur = 16; },
        afterDatasetsDraw(c) { c.ctx.restore(); },
      }],
    });
    return () => { mrrChartRef.current?.destroy(); mrrChartRef.current = null; };
  }, []);

  // Pipeline Chart (bar)
  React.useEffect(() => {
    const c = pipeCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    pipeChartRef.current = new Chart(ctx, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 400 },
        indexAxis: 'y',
        scales: {
          x: { border: { display: false }, grid: { color: 'rgba(255,93,214,.04)' }, ticks: { color: 'rgba(233,238,255,.45)', font: { size: 10 } } },
          y: { border: { display: false }, grid: { display: false }, ticks: { color: 'rgba(233,238,255,.70)', font: { size: 11, weight: 700 as const } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: 'rgba(3,6,18,.92)', borderColor: 'rgba(255,93,214,.30)', borderWidth: 1 },
        },
      },
    });
    return () => { pipeChartRef.current?.destroy(); pipeChartRef.current = null; };
  }, []);

  // Update MRR chart
  React.useEffect(() => {
    const chart = mrrChartRef.current;
    const mrrSeries = metrics.find(m => m.metric === 'mrr');
    if (!chart || !mrrSeries || !mrrSeries.rows.length) return;
    const fmt = (ts: string) => { const d = new Date(ts); return `${d.getDate()}/${d.getMonth() + 1}`; };
    const grad = chart.ctx.createLinearGradient(0, 0, 0, 220);
    grad.addColorStop(0, 'rgba(255,93,214,0.30)');
    grad.addColorStop(1, 'rgba(255,93,214,0)');
    chart.data.labels = mrrSeries.rows.map(r => fmt(r.ts));
    chart.data.datasets = [{
      label: 'MRR', data: mrrSeries.rows.map(r => r.value),
      borderColor: '#ff5dd6', backgroundColor: grad,
      tension: 0.4, fill: true, pointRadius: 3, pointBackgroundColor: '#ff5dd6', borderWidth: 2.5,
    }];
    chart.update('none');
  }, [metrics]);

  // Update pipeline chart
  React.useEffect(() => {
    const chart = pipeChartRef.current;
    if (!chart || Object.keys(pipeline).length === 0) return;
    const stageOrder = ['lead_created', 'lead_qualified', 'proposal_sent', 'negotiation', 'contract_signed', 'deal_won', 'deal_lost'];
    const stageLabels: Record<string, string> = {
      lead_created: 'Leads', lead_qualified: 'Qualified', proposal_sent: 'Proposals',
      negotiation: 'Negotiation', contract_signed: 'Contracts', deal_won: 'Won', deal_lost: 'Lost',
    };
    const stageColors: Record<string, string> = {
      lead_created: '#55f3ff', lead_qualified: '#60a5fa', proposal_sent: '#9b7cff',
      negotiation: '#fbbf24', contract_signed: '#4ade80', deal_won: '#4ade80', deal_lost: '#f87171',
    };
    const sorted = stageOrder.filter(s => pipeline[s]);
    chart.data.labels = sorted.map(s => stageLabels[s] ?? s);
    chart.data.datasets = [{
      data: sorted.map(s => pipeline[s] ?? 0),
      backgroundColor: sorted.map(s => (stageColors[s] ?? '#ff5dd6') + '55'),
      borderColor: sorted.map(s => stageColors[s] ?? '#ff5dd6'),
      borderWidth: 1.5, borderRadius: 6,
    }];
    chart.update('none');
  }, [pipeline]);

  // Helper: get latest value from metric series
  function latest(metric: string): number | null {
    const s = metrics.find(m => m.metric === metric);
    if (!s || !s.rows.length) return null;
    return s.rows[s.rows.length - 1].value;
  }
  function allValues(metric: string): number[] {
    return metrics.find(m => m.metric === metric)?.rows.map(r => r.value) ?? [];
  }
  function delta(metric: string): { value: string; positive: boolean } | null {
    const vals = allValues(metric);
    if (vals.length < 2) return null;
    const cur = vals[vals.length - 1];
    const prev = vals[vals.length - 2];
    if (prev === 0) return null;
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    return { value: `${Math.abs(pct).toFixed(1)}%`, positive: pct >= 0 };
  }

  const totalEvents = events.length;
  const stageOrder = ['lead_created', 'lead_qualified', 'proposal_sent', 'negotiation', 'contract_signed', 'deal_won', 'deal_lost'];
  const stageLabels: Record<string, string> = {
    lead_created: 'Leads Created', lead_qualified: 'Qualified', proposal_sent: 'Proposals Sent',
    negotiation: 'In Negotiation', contract_signed: 'Contracts', deal_won: 'Deals Won', deal_lost: 'Deals Lost',
  };
  const stageColors: Record<string, string> = {
    lead_created: OC.cyan, lead_qualified: '#60a5fa', proposal_sent: OC.purple,
    negotiation: OC.amber, contract_signed: OC.green, deal_won: OC.green, deal_lost: OC.red,
  };

  if (loading && metrics.length === 0) {
    return <div style={{ padding: 40, color: 'rgba(233,238,255,0.4)', textAlign: 'center' }}>Loading OpenClaw dashboard…</div>;
  }

  return (
    <div style={{ padding: isMobile ? '14px 10px 24px' : '20px 24px 40px', maxWidth: 1400 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 24 }}>🦀</span>
        <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, color: OC.accent }}>OpenClaw</div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 999,
          background: 'rgba(255,93,214,0.10)', border: '1px solid rgba(255,93,214,0.30)', color: OC.accent,
          letterSpacing: '0.5px',
        }}>SALES DASHBOARD</span>
        <span style={{ fontSize: 11, color: 'rgba(233,238,255,0.35)', marginLeft: 'auto' }}>auto-refresh 60s</span>
      </div>

      {/* KPI Row */}
      <div className="orbit-grid-4" style={{ gap: 12, marginBottom: 16 }}>
        <KpiCard
          label="MRR" icon="💰"
          value={latest('mrr') !== null ? `R$ ${(latest('mrr')! / 1000).toFixed(1)}k` : '—'}
          color={OC.accent} delta={delta('mrr')}
        />
        <KpiCard
          label="Pipeline" icon="📊"
          value={latest('pipeline_value') !== null ? `R$ ${(latest('pipeline_value')! / 1000).toFixed(0)}k` : '—'}
          color={OC.purple} delta={delta('pipeline_value')}
        />
        <KpiCard
          label="Conversion" icon="🎯"
          value={latest('conversion_rate') !== null ? `${latest('conversion_rate')!.toFixed(1)}` : '—'}
          unit="%" color={OC.green} delta={delta('conversion_rate')}
        />
        <KpiCard
          label="NPS Score" icon="⭐"
          value={latest('nps_score') !== null ? `${latest('nps_score')!.toFixed(0)}` : '—'}
          color={OC.cyan} delta={delta('nps_score')}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="orbit-grid-4" style={{ gap: 12, marginBottom: 16 }}>
        <KpiCard
          label="Open Deals" icon="📝"
          value={latest('deals_open') !== null ? `${latest('deals_open')!.toFixed(0)}` : '—'}
          color={OC.amber} delta={delta('deals_open')}
        />
        <KpiCard
          label="New Leads" icon="🧲"
          value={latest('leads_new') !== null ? `${latest('leads_new')!.toFixed(0)}` : '—'}
          color={OC.cyan} delta={delta('leads_new')}
        />
        <KpiCard
          label="Avg Deal Size" icon="💎"
          value={latest('avg_deal_size') !== null ? `R$ ${(latest('avg_deal_size')! / 1000).toFixed(0)}k` : '—'}
          color={OC.purple} delta={delta('avg_deal_size')}
        />
        <KpiCard
          label="Churn Rate" icon="📉"
          value={latest('churn_rate') !== null ? `${latest('churn_rate')!.toFixed(1)}` : '—'}
          unit="%" color={OC.red} delta={delta('churn_rate')}
        />
      </div>

      {/* Charts Row: MRR + Pipeline */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 14, marginBottom: 16 }}>

        {/* MRR Chart */}
        <div style={OC.panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#e9eeff' }}>MRR Evolution</div>
            <span style={{ fontSize: 10, color: 'rgba(233,238,255,0.35)' }}>30 days</span>
          </div>
          <div style={{ position: 'relative', height: 220 }}>
            <canvas ref={mrrCanvasRef} style={{ width: '100%', height: '100%' }} />
          </div>
        </div>

        {/* Pipeline Funnel Chart */}
        <div style={OC.panel}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#e9eeff', marginBottom: 12 }}>Pipeline Funnel</div>
          <div style={{ position: 'relative', height: 220 }}>
            <canvas ref={pipeCanvasRef} style={{ width: '100%', height: '100%' }} />
          </div>
        </div>
      </div>

      {/* Sparklines Row */}
      <div style={OC.panel}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#e9eeff', marginBottom: 14 }}>Trends — 30 days</div>
        <div className="orbit-grid-4" style={{ gap: 14 }}>
          {[
            { metric: 'pipeline_value', label: 'Pipeline Value', color: OC.purple, fmt: (v: number) => `R$ ${(v / 1000).toFixed(0)}k` },
            { metric: 'conversion_rate', label: 'Conversion Rate', color: OC.green, fmt: (v: number) => `${v.toFixed(1)}%` },
            { metric: 'leads_new', label: 'New Leads', color: OC.cyan, fmt: (v: number) => `${v.toFixed(0)}` },
            { metric: 'deals_open', label: 'Open Deals', color: OC.amber, fmt: (v: number) => `${v.toFixed(0)}` },
          ].map(({ metric, label, color, fmt }) => {
            const vals = allValues(metric);
            const last = vals.length > 0 ? vals[vals.length - 1] : null;
            return (
              <div key={metric} style={{ background: 'rgba(3,6,18,0.5)', borderRadius: 12, padding: '12px 14px', border: `1px solid ${color}20` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(233,238,255,0.55)' }}>{label}</span>
                  <span style={{ fontSize: 14, fontWeight: 900, color }}>{last !== null ? fmt(last) : '—'}</span>
                </div>
                <Sparkline data={vals} color={color} width={200} height={36} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom: Pipeline Stages + Recent Events */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 2fr', gap: 14 }}>

        {/* Pipeline Stages */}
        <div style={OC.panel}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#e9eeff', marginBottom: 14 }}>Stage Breakdown</div>
          {stageOrder.filter(s => pipeline[s]).map(stage => (
            <FunnelBar
              key={stage}
              label={stageLabels[stage] ?? stage}
              count={pipeline[stage] ?? 0}
              total={totalEvents}
              color={stageColors[stage] ?? OC.accent}
            />
          ))}
          {Object.keys(pipeline).length === 0 && (
            <div style={{ color: 'rgba(233,238,255,0.35)', fontSize: 12 }}>No pipeline data</div>
          )}
        </div>

        {/* Recent Events Feed */}
        <div style={OC.panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#e9eeff' }}>Recent Activity</div>
            <span style={{ fontSize: 10, color: 'rgba(233,238,255,0.35)' }}>{events.length} events (72h)</span>
          </div>
          <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {events.slice(0, 30).map((ev, i) => (
              <div key={i} style={{
                background: 'rgba(3,6,18,0.5)',
                border: '1px solid rgba(255,93,214,0.08)',
                borderRadius: 10,
                padding: '8px 12px',
                display: 'flex', gap: 10, alignItems: 'center',
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: stageColors[ev.kind] ?? OC.accent,
                  boxShadow: `0 0 6px ${stageColors[ev.kind] ?? OC.accent}60`,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e9eeff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ev.title}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(233,238,255,0.40)', marginTop: 2 }}>
                    {ev.asset_id} · {fmtTs(ev.ts)}
                  </div>
                </div>
                <SevBadge sev={ev.severity} />
              </div>
            ))}
            {events.length === 0 && (
              <div style={{ color: 'rgba(233,238,255,0.35)', fontSize: 12, textAlign: 'center', padding: 20 }}>No events yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
