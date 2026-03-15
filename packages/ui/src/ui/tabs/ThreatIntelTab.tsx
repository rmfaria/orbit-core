import React from 'react';
import { Chart } from 'chart.js';
import { t } from '../i18n';
import { S, AssetOpt, SEV_COLOR, apiGetHeaders, fmtTs, relativeFrom, useIsMobile } from '../shared';
import { SevBadge, TimeRangePicker } from '../components';

// ─── Types ──────────────────────────────────────────────────────────────────

type ThreatLevel = 'high' | 'medium' | 'low' | 'undefined' | 'unknown';

type Indicator = {
  id: number;
  source: string;
  source_id: string;
  type: string;
  value: string;
  threat_level: ThreatLevel;
  tags: string[];
  event_info: string | null;
  comment: string | null;
  attributes: Record<string, any>;
  first_seen: string;
  last_seen: string;
  expires_at: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type IndicatorStats = {
  total: number;
  active: number;
  high: number;
  medium: number;
  low: number;
  types: number;
  sources: number;
  oldest: string | null;
  newest: string | null;
  by_type: { type: string; count: number }[];
};

type Match = {
  id: number;
  event_id: number;
  indicator_id: number;
  matched_field: string;
  matched_value: string;
  indicator_type: string;
  threat_level: string;
  detected_at: string;
  asset_id: string;
  namespace: string;
  kind: string;
  event_severity: string;
  event_title: string;
  event_ts: string;
  indicator_value: string;
  tags: string[];
  indicator_event_info: string | null;
};

type MatchSummary = {
  summary: {
    total_matches: number;
    events_matched: number;
    indicators_triggered: number;
    assets_affected: number;
    high_matches: number;
    medium_matches: number;
  };
  by_type: { indicator_type: string; threat_level: string; count: number }[];
  by_asset: { asset_id: string; match_count: number; unique_indicators: number; last_match: string }[];
  timeline: { bucket: string; match_count: number; high_count: number }[];
};

// ─── Theme ──────────────────────────────────────────────────────────────────

const TI = {
  accent: '#e879f9',        // fuchsia-400
  accentBg: 'rgba(232,121,249,0.08)',
  accentBorder: 'rgba(232,121,249,0.25)',
  high: '#f87171',
  medium: '#fbbf24',
  low: '#4ade80',
  panel: {
    background: 'rgba(12,18,40,0.55)',
    border: '1px solid rgba(232,121,249,0.18)',
    borderRadius: 16,
    padding: '18px 20px',
    marginBottom: 14,
  } as React.CSSProperties,
};

const THREAT_COLOR: Record<string, string> = {
  high: '#f87171',
  medium: '#fbbf24',
  low: '#4ade80',
  undefined: '#94a3b8',
  unknown: '#64748b',
};

function ThreatBadge({ level }: { level: string }) {
  const color = THREAT_COLOR[level] ?? '#64748b';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, background: `${color}22`, color,
      textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {level}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 99,
      fontSize: 10, fontWeight: 700, background: 'rgba(232,121,249,0.12)',
      color: TI.accent, border: `1px solid ${TI.accentBorder}`,
      textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
    }}>
      {type}
    </span>
  );
}

function TagPill({ tag }: { tag: string }) {
  const isTlp = tag.startsWith('tlp:');
  const tlpColor = isTlp
    ? tag.includes('red') ? '#f87171' : tag.includes('amber') ? '#fbbf24' : tag.includes('green') ? '#4ade80' : '#60a5fa'
    : 'rgba(233,238,255,0.45)';
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 6,
      fontSize: 10, background: `${tlpColor}18`, color: tlpColor,
      border: `1px solid ${tlpColor}30`, whiteSpace: 'nowrap',
    }}>
      {tag}
    </span>
  );
}

// ─── Views ──────────────────────────────────────────────────────────────────

const VIEWS = ['overview', 'indicators', 'matches', 'timeline'] as const;
type View = typeof VIEWS[number];

const VIEW_LABELS: Record<View, string> = {
  overview: 'Overview',
  indicators: 'Indicators',
  matches: 'Matches',
  timeline: 'Timeline',
};

// ─── Component ──────────────────────────────────────────────────────────────

export function ThreatIntelTab({ assets }: { assets?: AssetOpt[] }) {
  const isMobile = useIsMobile();
  const [view, setView] = React.useState<View>('overview');
  const [from, setFrom] = React.useState(() => relativeFrom(24));
  const [to, setTo] = React.useState(() => new Date().toISOString());
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // Data
  const [stats, setStats] = React.useState<IndicatorStats | null>(null);
  const [indicators, setIndicators] = React.useState<Indicator[]>([]);
  const [indicatorTotal, setIndicatorTotal] = React.useState(0);
  const [matches, setMatches] = React.useState<Match[]>([]);
  const [matchTotal, setMatchTotal] = React.useState(0);
  const [matchSummary, setMatchSummary] = React.useState<MatchSummary | null>(null);

  // Filters
  const [filterType, setFilterType] = React.useState('');
  const [filterThreat, setFilterThreat] = React.useState('');
  const [filterValue, setFilterValue] = React.useState('');
  const [indicatorPage, setIndicatorPage] = React.useState(0);
  const [matchPage, setMatchPage] = React.useState(0);
  const [expandedMatch, setExpandedMatch] = React.useState<number | null>(null);
  const [expandedIndicator, setExpandedIndicator] = React.useState<number | null>(null);

  // Charts
  const timelineRef = React.useRef<HTMLCanvasElement | null>(null);
  const timelineChart = React.useRef<Chart | null>(null);
  const typeRef = React.useRef<HTMLCanvasElement | null>(null);
  const typeChart = React.useRef<Chart | null>(null);

  const PAGE_SIZE = 50;

  // ── Fetch ──────────────────────────────────────────────────────────────────

  async function fetchAll() {
    setLoading(true); setErr(null);
    try {
      const [rStats, rMatches] = await Promise.all([
        fetch('api/v1/threat-intel/stats', { headers: apiGetHeaders() }),
        fetch(`api/v1/threat-intel/matches/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: apiGetHeaders() }),
      ]);
      const [jStats, jMatches] = await Promise.all([rStats.json(), rMatches.json()]);
      if (!jStats.ok) throw new Error(jStats.error ?? 'Failed to load stats');
      if (!jMatches.ok) throw new Error(jMatches.error ?? 'Failed to load matches');
      setStats(jStats.stats);
      setMatchSummary(jMatches as MatchSummary);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchIndicators(page = 0) {
    setLoading(true); setErr(null);
    try {
      const qp = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (filterType) qp.set('type', filterType);
      if (filterThreat) qp.set('threat_level', filterThreat);
      if (filterValue) qp.set('value', filterValue);
      const r = await fetch(`api/v1/threat-intel/indicators?${qp}`, { headers: apiGetHeaders() });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? 'Failed');
      setIndicators(j.items);
      setIndicatorTotal(j.total);
      setIndicatorPage(page);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchMatches(page = 0) {
    setLoading(true); setErr(null);
    try {
      const qp = new URLSearchParams({
        from, to, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE),
      });
      if (filterThreat) qp.set('threat_level', filterThreat);
      if (filterType) qp.set('indicator_type', filterType);
      const r = await fetch(`api/v1/threat-intel/matches?${qp}`, { headers: apiGetHeaders() });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? 'Failed');
      setMatches(j.items);
      setMatchTotal(j.total);
      setMatchPage(page);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  React.useEffect(() => { fetchAll(); }, []);

  // Reload on view change
  React.useEffect(() => {
    if (view === 'indicators') fetchIndicators(0);
    else if (view === 'matches') fetchMatches(0);
    else if (view === 'overview' || view === 'timeline') fetchAll();
  }, [view, from, to]);

  // ── Charts ─────────────────────────────────────────────────────────────────

  // Timeline chart
  React.useEffect(() => {
    if (!timelineRef.current) return;
    const ctx = timelineRef.current.getContext('2d');
    if (!ctx) return;
    timelineChart.current = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: 'rgba(233,238,255,0.4)', maxTicksLimit: 12 }, grid: { color: 'rgba(140,160,255,0.08)' } },
          y: { ticks: { color: 'rgba(233,238,255,0.4)' }, grid: { color: 'rgba(140,160,255,0.08)' }, beginAtZero: true },
        },
        plugins: { legend: { labels: { color: '#e9eeff', boxWidth: 12 } } },
      },
    });
    return () => { timelineChart.current?.destroy(); timelineChart.current = null; };
  }, []);

  // Type doughnut chart
  React.useEffect(() => {
    if (!typeRef.current) return;
    const ctx = typeRef.current.getContext('2d');
    if (!ctx) return;
    typeChart.current = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { color: '#e9eeff', boxWidth: 10, font: { size: 11 } } } },
        cutout: '60%',
      },
    });
    return () => { typeChart.current?.destroy(); typeChart.current = null; };
  }, []);

  // Update charts when data changes
  React.useEffect(() => {
    if (timelineChart.current && matchSummary?.timeline?.length) {
      const chart = timelineChart.current;
      chart.data.labels = matchSummary.timeline.map(b => {
        const d = new Date(b.bucket);
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`;
      });
      chart.data.datasets = [
        {
          label: 'Total Matches',
          data: matchSummary.timeline.map(b => b.match_count),
          borderColor: TI.accent,
          backgroundColor: 'rgba(232,121,249,0.08)',
          fill: true, tension: 0.3, pointRadius: 2,
        },
        {
          label: 'High Threat',
          data: matchSummary.timeline.map(b => b.high_count),
          borderColor: '#f87171',
          backgroundColor: 'rgba(248,113,113,0.08)',
          fill: true, tension: 0.3, pointRadius: 2,
        },
      ];
      chart.update('none');
    }

    if (typeChart.current && stats?.by_type?.length) {
      const palette = ['#e879f9', '#f87171', '#fbbf24', '#4ade80', '#60a5fa', '#fb923c', '#a78bfa', '#38bdf8', '#f0abfc', '#a3e635'];
      const chart = typeChart.current;
      const top = stats.by_type.slice(0, 10);
      chart.data.labels = top.map(t => t.type);
      chart.data.datasets = [{
        data: top.map(t => parseInt(String(t.count))),
        backgroundColor: top.map((_, i) => palette[i % palette.length]),
        borderWidth: 0,
      }];
      chart.update('none');
    }
  }, [stats, matchSummary]);

  // ── KPI Card helper ────────────────────────────────────────────────────────

  function kpiCard(label: string, value: string | number, color: string) {
    return (
      <div style={{
        background: `linear-gradient(135deg, ${color}12, rgba(12,18,40,0.5))`,
        border: `1px solid ${color}40`,
        borderRadius: 14, padding: '16px 18px',
      }}>
        <div style={{ fontSize: 10, color: 'rgba(233,238,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {label}
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color, marginTop: 4 }}>
          {value}
        </div>
      </div>
    );
  }

  // ── Pagination helper ──────────────────────────────────────────────────────

  function paginator(total: number, page: number, onPage: (p: number) => void) {
    const pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) return null;
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 12, justifyContent: 'center' }}>
        <button disabled={page === 0} onClick={() => onPage(page - 1)} style={{ ...S.btnSm, opacity: page === 0 ? 0.4 : 1 }}>
          Prev
        </button>
        <span style={{ fontSize: 12, color: 'rgba(233,238,255,0.5)' }}>
          {page + 1} / {pages} ({total} total)
        </span>
        <button disabled={page >= pages - 1} onClick={() => onPage(page + 1)} style={{ ...S.btnSm, opacity: page >= pages - 1 ? 0.4 : 1 }}>
          Next
        </button>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: isMobile ? 20 : 24, fontWeight: 800, letterSpacing: '-0.02em' }}>
          <span style={{ color: TI.accent }}>Threat</span> Intelligence
        </h2>
        <div style={{ flex: 1 }} />
        <button onClick={() => fetchAll()} disabled={loading} style={{ ...S.btn, fontSize: 12, padding: '6px 14px' }}>
          {loading ? '...' : 'Refresh'}
        </button>
      </div>

      {/* Time range */}
      <div style={{ marginBottom: 16 }}>
        <TimeRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 18, borderBottom: '1px solid rgba(232,121,249,0.15)' }}>
        {VIEWS.map(v => {
          const active = view === v;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                background: active ? TI.accentBg : 'transparent',
                border: 'none',
                borderBottom: active ? `2px solid ${TI.accent}` : '2px solid transparent',
                color: active ? TI.accent : 'rgba(233,238,255,0.55)',
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                transition: 'all 0.15s',
              }}
            >
              {VIEW_LABELS[v]}
            </button>
          );
        })}
      </div>

      {err && <div style={{ ...S.err, marginBottom: 12 }}>{err}</div>}

      {/* ── Overview ──────────────────────────────────────────────────────── */}
      {view === 'overview' && stats && (
        <div>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: 12, marginBottom: 20 }}>
            {kpiCard('Total IoCs', stats.total ?? 0, TI.accent)}
            {kpiCard('Active', stats.active ?? 0, '#4ade80')}
            {kpiCard('High Threat', stats.high ?? 0, '#f87171')}
            {kpiCard('Medium', stats.medium ?? 0, '#fbbf24')}
            {kpiCard('IoC Types', stats.types ?? 0, '#60a5fa')}
            {kpiCard('Matches', matchSummary?.summary?.total_matches ?? 0, '#e879f9')}
          </div>

          {/* Severity bar */}
          {(stats.total ?? 0) > 0 && (
            <div style={{ ...TI.panel, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 11, color: 'rgba(233,238,255,0.5)', whiteSpace: 'nowrap' }}>Threat Level</span>
              <div style={{ flex: 1, display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden' }}>
                {(['high', 'medium', 'low'] as const).map(lvl => {
                  const n = stats[lvl] ?? 0;
                  if (!n) return null;
                  return <div key={lvl} style={{ width: `${(n / stats.total) * 100}%`, background: THREAT_COLOR[lvl] }} />;
                })}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {(['high', 'medium', 'low'] as const).map(lvl => {
                  const n = stats[lvl] ?? 0;
                  if (!n) return null;
                  return (
                    <span key={lvl} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: THREAT_COLOR[lvl] }} />
                      <span style={{ color: THREAT_COLOR[lvl], fontWeight: 700 }}>{n}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 14, marginBottom: 14 }}>
            {/* Match timeline */}
            <div style={TI.panel}>
              <div style={{ fontSize: 12, color: 'rgba(233,238,255,0.5)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Match Timeline
              </div>
              <div style={{ height: 220 }}>
                <canvas ref={timelineRef} />
              </div>
            </div>

            {/* Type distribution */}
            <div style={TI.panel}>
              <div style={{ fontSize: 12, color: 'rgba(233,238,255,0.5)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                IoC Types
              </div>
              <div style={{ height: 220 }}>
                <canvas ref={typeRef} />
              </div>
            </div>
          </div>

          {/* Affected assets */}
          {matchSummary && matchSummary.by_asset.length > 0 && (
            <div style={TI.panel}>
              <div style={{ fontSize: 12, color: 'rgba(233,238,255,0.5)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Affected Assets
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ ...S.table, minWidth: 600 }}>
                  <thead>
                    <tr>
                      {['Asset', 'Matches', 'Unique IoCs', 'Last Match'].map(h => (
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matchSummary.by_asset.slice(0, 15).map((a, i) => (
                      <tr key={i}>
                        <td style={{ ...S.td, fontWeight: 600, color: TI.accent }}>{a.asset_id}</td>
                        <td style={{ ...S.td, fontFamily: 'monospace', fontWeight: 700 }}>{a.match_count}</td>
                        <td style={S.td}>{a.unique_indicators}</td>
                        <td style={{ ...S.td, fontSize: 12, color: 'rgba(233,238,255,0.5)' }}>{a.last_match ? fmtTs(a.last_match) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Match types breakdown */}
          {matchSummary && matchSummary.by_type.length > 0 && (
            <div style={TI.panel}>
              <div style={{ fontSize: 12, color: 'rgba(233,238,255,0.5)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Match Breakdown by Type
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {matchSummary.by_type.map((t, i) => (
                  <div key={i} style={{
                    background: 'rgba(232,121,249,0.06)', border: '1px solid rgba(232,121,249,0.15)',
                    borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <TypeBadge type={t.indicator_type} />
                    <ThreatBadge level={t.threat_level} />
                    <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 14 }}>{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Indicators ────────────────────────────────────────────────────── */}
      {view === 'indicators' && (
        <div>
          {/* Filters */}
          <div style={{ ...TI.panel, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={S.label}>
              Type
              <input value={filterType} onChange={e => setFilterType(e.target.value)} placeholder="ip-src, domain..." style={{ ...S.input, width: 130 }} />
            </label>
            <label style={S.label}>
              Threat Level
              <select value={filterThreat} onChange={e => setFilterThreat(e.target.value)} style={S.select}>
                <option value="">All</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label style={S.label}>
              Value (search)
              <input value={filterValue} onChange={e => setFilterValue(e.target.value)} placeholder="IP, hash, domain..." style={{ ...S.input, width: 200 }} />
            </label>
            <button onClick={() => fetchIndicators(0)} disabled={loading} style={S.btn}>
              {loading ? '...' : 'Search'}
            </button>
          </div>

          {/* Table */}
          <div style={{ ...TI.panel, overflowX: 'auto' }}>
            <table style={{ ...S.table, minWidth: 800 }}>
              <thead>
                <tr>
                  {['Type', 'Value', 'Threat', 'Tags', 'Source', 'Event Info', 'Updated'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {indicators.map((ind, i) => {
                  const isExp = expandedIndicator === ind.id;
                  return (
                    <React.Fragment key={ind.id}>
                      <tr onClick={() => setExpandedIndicator(isExp ? null : ind.id)} style={{ cursor: 'pointer' }}>
                        <td style={S.td}><TypeBadge type={ind.type} /></td>
                        <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ind.value}
                        </td>
                        <td style={S.td}><ThreatBadge level={ind.threat_level} /></td>
                        <td style={S.td}>
                          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                            {ind.tags.slice(0, 3).map((tag, j) => <TagPill key={j} tag={tag} />)}
                            {ind.tags.length > 3 && <span style={{ fontSize: 10, color: 'rgba(233,238,255,0.4)' }}>+{ind.tags.length - 3}</span>}
                          </div>
                        </td>
                        <td style={{ ...S.td, fontSize: 11, color: 'rgba(233,238,255,0.5)' }}>{ind.source}</td>
                        <td style={{ ...S.td, fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ind.event_info ?? '—'}
                        </td>
                        <td style={{ ...S.td, fontSize: 11, color: 'rgba(233,238,255,0.45)' }}>{fmtTs(ind.updated_at)}</td>
                      </tr>
                      {isExp && (
                        <tr style={{ background: 'rgba(232,121,249,0.04)' }}>
                          <td colSpan={7} style={{ padding: '16px 20px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
                              <div>
                                <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.4)', marginBottom: 4 }}>FULL VALUE</div>
                                <div style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', color: TI.accent }}>{ind.value}</div>
                                {ind.comment && (
                                  <>
                                    <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.4)', marginTop: 10, marginBottom: 4 }}>COMMENT</div>
                                    <div style={{ fontSize: 12, color: 'rgba(233,238,255,0.7)' }}>{ind.comment}</div>
                                  </>
                                )}
                                <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.4)', marginTop: 10, marginBottom: 4 }}>TAGS</div>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {ind.tags.map((tag, j) => <TagPill key={j} tag={tag} />)}
                                  {ind.tags.length === 0 && <span style={{ fontSize: 11, color: '#64748b' }}>No tags</span>}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.4)', marginBottom: 4 }}>DETAILS</div>
                                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                  <div><span style={{ color: 'rgba(233,238,255,0.45)' }}>Source ID:</span> {ind.source_id}</div>
                                  <div><span style={{ color: 'rgba(233,238,255,0.45)' }}>First seen:</span> {fmtTs(ind.first_seen)}</div>
                                  <div><span style={{ color: 'rgba(233,238,255,0.45)' }}>Last seen:</span> {fmtTs(ind.last_seen)}</div>
                                  <div><span style={{ color: 'rgba(233,238,255,0.45)' }}>Expires:</span> {ind.expires_at ? fmtTs(ind.expires_at) : 'Never'}</div>
                                  <div><span style={{ color: 'rgba(233,238,255,0.45)' }}>Enabled:</span> {ind.enabled ? 'Yes' : 'No'}</div>
                                  {ind.attributes?.category && (
                                    <div><span style={{ color: 'rgba(233,238,255,0.45)' }}>Category:</span> {ind.attributes.category}</div>
                                  )}
                                  {ind.attributes?.org && (
                                    <div><span style={{ color: 'rgba(233,238,255,0.45)' }}>Org:</span> {ind.attributes.org}</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {indicators.length === 0 && !loading && (
                  <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: '#64748b', padding: 30 }}>No indicators found</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {paginator(indicatorTotal, indicatorPage, p => fetchIndicators(p))}
        </div>
      )}

      {/* ── Matches ───────────────────────────────────────────────────────── */}
      {view === 'matches' && (
        <div>
          {/* Filters */}
          <div style={{ ...TI.panel, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={S.label}>
              Indicator Type
              <input value={filterType} onChange={e => setFilterType(e.target.value)} placeholder="ip-src, domain..." style={{ ...S.input, width: 130 }} />
            </label>
            <label style={S.label}>
              Threat Level
              <select value={filterThreat} onChange={e => setFilterThreat(e.target.value)} style={S.select}>
                <option value="">All</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <button onClick={() => fetchMatches(0)} disabled={loading} style={S.btn}>
              {loading ? '...' : 'Search'}
            </button>
          </div>

          {/* Table */}
          <div style={{ ...TI.panel, overflowX: 'auto' }}>
            <table style={{ ...S.table, minWidth: 900 }}>
              <thead>
                <tr>
                  {['Detected', 'Asset', 'Matched Value', 'IoC Type', 'Threat', 'Event', 'Source'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matches.map((m, i) => {
                  const isExp = expandedMatch === m.id;
                  return (
                    <React.Fragment key={m.id}>
                      <tr onClick={() => setExpandedMatch(isExp ? null : m.id)} style={{ cursor: 'pointer' }}>
                        <td style={{ ...S.td, fontSize: 12, whiteSpace: 'nowrap' }}>{fmtTs(m.detected_at)}</td>
                        <td style={{ ...S.td, fontWeight: 600, color: TI.accent }}>{m.asset_id}</td>
                        <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.matched_value}
                        </td>
                        <td style={S.td}><TypeBadge type={m.indicator_type} /></td>
                        <td style={S.td}><ThreatBadge level={m.threat_level} /></td>
                        <td style={{ ...S.td, fontSize: 12, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.event_title}
                        </td>
                        <td style={{ ...S.td, fontSize: 11, color: 'rgba(233,238,255,0.5)' }}>{m.namespace}</td>
                      </tr>
                      {isExp && (
                        <tr style={{ background: 'rgba(232,121,249,0.04)' }}>
                          <td colSpan={7} style={{ padding: '16px 20px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
                              <div>
                                <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.4)', marginBottom: 4 }}>MATCHED IOC</div>
                                <div style={{ fontFamily: 'monospace', fontSize: 13, color: TI.accent, wordBreak: 'break-all' }}>{m.indicator_value}</div>
                                <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.4)', marginTop: 10, marginBottom: 4 }}>FIELD</div>
                                <div style={{ fontSize: 12, fontFamily: 'monospace' }}>{m.matched_field}</div>
                                {m.indicator_event_info && (
                                  <>
                                    <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.4)', marginTop: 10, marginBottom: 4 }}>MISP EVENT</div>
                                    <div style={{ fontSize: 12 }}>{m.indicator_event_info}</div>
                                  </>
                                )}
                                {m.tags?.length > 0 && (
                                  <>
                                    <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.4)', marginTop: 10, marginBottom: 4 }}>TAGS</div>
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                      {m.tags.map((tag, j) => <TagPill key={j} tag={tag} />)}
                                    </div>
                                  </>
                                )}
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.4)', marginBottom: 4 }}>ORIGINAL EVENT</div>
                                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                  <div><span style={{ color: 'rgba(233,238,255,0.45)' }}>Title:</span> {m.event_title}</div>
                                  <div><span style={{ color: 'rgba(233,238,255,0.45)' }}>Time:</span> {fmtTs(m.event_ts)}</div>
                                  <div><span style={{ color: 'rgba(233,238,255,0.45)' }}>Asset:</span> {m.asset_id}</div>
                                  <div><span style={{ color: 'rgba(233,238,255,0.45)' }}>Source:</span> {m.namespace}/{m.kind}</div>
                                  <div>
                                    <span style={{ color: 'rgba(233,238,255,0.45)' }}>Severity:</span>{' '}
                                    <SevBadge sev={m.event_severity} />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {matches.length === 0 && !loading && (
                  <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: '#64748b', padding: 30 }}>No IoC matches found in this period</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {paginator(matchTotal, matchPage, p => fetchMatches(p))}
        </div>
      )}

      {/* ── Timeline ──────────────────────────────────────────────────────── */}
      {view === 'timeline' && matchSummary && (
        <div>
          {/* Summary KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {kpiCard('Total Matches', matchSummary.summary.total_matches, TI.accent)}
            {kpiCard('Events Hit', matchSummary.summary.events_matched, '#60a5fa')}
            {kpiCard('IoCs Triggered', matchSummary.summary.indicators_triggered, '#fbbf24')}
            {kpiCard('Assets Affected', matchSummary.summary.assets_affected, '#f87171')}
          </div>

          {/* Large timeline */}
          <div style={{ ...TI.panel, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'rgba(233,238,255,0.5)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              IoC Match Activity
            </div>
            <div style={{ height: 300 }}>
              <canvas ref={el => {
                // Use shared ref for timeline view — already initialized above
                if (el && !timelineRef.current) timelineRef.current = el;
              }} />
            </div>
          </div>

          {/* Type breakdown table */}
          {matchSummary.by_type.length > 0 && (
            <div style={TI.panel}>
              <div style={{ fontSize: 12, color: 'rgba(233,238,255,0.5)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Match Breakdown
              </div>
              <table style={{ ...S.table }}>
                <thead>
                  <tr>
                    {['IoC Type', 'Threat Level', 'Count'].map(h => <th key={h} style={S.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {matchSummary.by_type.map((t, i) => (
                    <tr key={i}>
                      <td style={S.td}><TypeBadge type={t.indicator_type} /></td>
                      <td style={S.td}><ThreatBadge level={t.threat_level} /></td>
                      <td style={{ ...S.td, fontWeight: 700, fontFamily: 'monospace' }}>{t.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Loading overlay */}
      {loading && !stats && (
        <div style={{ textAlign: 'center', padding: 60, color: 'rgba(233,238,255,0.4)' }}>
          Loading threat intelligence data...
        </div>
      )}
    </div>
  );
}
