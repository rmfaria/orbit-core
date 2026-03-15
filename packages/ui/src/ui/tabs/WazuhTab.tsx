import React from 'react';
import { Chart } from 'chart.js';
import { t } from '../i18n';
import { S, AssetOpt, EventRow, SEV_COLOR, SEV_BG, apiHeaders, apiGetHeaders, relativeFrom, useIsMobile } from '../shared';
import { SevBadge, FeedRow, TimeRangePicker } from '../components';

// ─── WAZUH DASHBOARD TAB ──────────────────────────────────────────────────────

type WzAgent = {
  id: string; name: string; ip: string; status: string;
  os_name: string; os_version: string; wazuh_version: string;
  groups: string[]; node_name: string;
};
type WzSca = { agent_id: string; policy_name: string; score: number; passed: number; failed: number; total: number };
type WzHw = { agent_id: string; cpu_name: string; cpu_cores: number; ram_mb: number; os: string; hostname: string };
type WzVuln = { ts: string; agent: string; severity: string; cve: string; title: string; cvss: number | null; package_name: string | null; package_version: string | null };
type WzVulnAgent = { agent: string; total: number; critical: number; high: number; medium: number; low: number };

// Wazuh theme constants
/** Truncate IPv6 addresses to the first 4 groups so they don't overflow cards. */
function shortIp(ip: string): string {
  if (!ip || !ip.includes(':')) return ip;
  const parts = ip.split(':');
  if (parts.length <= 4) return ip;
  return parts.slice(0, 4).join(':') + ':\u2026';
}

const WZ = {
  accent:   '#a78bfa',
  accentBg: 'rgba(167,139,250,0.08)',
  glow:     '0 0 30px rgba(167,139,250,0.15)',
  panel: {
    background: 'linear-gradient(135deg, rgba(12,18,40,0.72), rgba(20,14,50,0.55))',
    border: '1px solid rgba(167,139,250,0.14)',
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
    backdropFilter: 'blur(16px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(167,139,250,0.08)',
  } as React.CSSProperties,
  panelFlush: {
    background: 'linear-gradient(135deg, rgba(12,18,40,0.72), rgba(20,14,50,0.55))',
    border: '1px solid rgba(167,139,250,0.14)',
    borderRadius: 18,
    padding: 0,
    marginBottom: 16,
    backdropFilter: 'blur(16px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(167,139,250,0.08)',
    overflow: 'hidden' as const,
  } as React.CSSProperties,
};

/** Circular gauge for SCA scores */
function ScaGauge({ score, size = 72 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score));
  const offset = c - (pct / 100) * c;
  const color = pct >= 70 ? '#4ade80' : pct >= 40 ? '#fbbf24' : '#f87171';
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(140,160,255,0.08)" strokeWidth={5} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.3s' }} />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize={size * 0.22} fontWeight={800}
        style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}>
        {pct}%
      </text>
    </svg>
  );
}

export function WazuhTab({ assets }: { assets: AssetOpt[] }) {
  const isMobile = useIsMobile();
  const [from, setFrom] = React.useState(() => relativeFrom(24));
  const [to, setTo] = React.useState(() => new Date().toISOString());
  const [loading, setLoading] = React.useState(false);
  const [tab, setSubTab] = React.useState<'overview' | 'agents' | 'sca' | 'mitre' | 'vulns' | 'events'>('overview');

  const [agents, setAgents] = React.useState<WzAgent[]>([]);
  const [sca, setSca] = React.useState<WzSca[]>([]);
  const [hw, setHw] = React.useState<WzHw[]>([]);
  const [mitre, setMitre] = React.useState<{ techniques: number; tactics: number; groups: number; software: number } | null>(null);
  const [events, setEvents] = React.useState<EventRow[]>([]);
  const [sevCounts, setSevCounts] = React.useState<Record<string, number>>({});
  const [vulnTop, setVulnTop] = React.useState<WzVuln[]>([]);
  const [vulnByAgent, setVulnByAgent] = React.useState<WzVulnAgent[]>([]);
  const [expandedAgent, setExpandedAgent] = React.useState<string | null>(null);
  const [expandedEvent, setExpandedEvent] = React.useState<number | null>(null);

  const epsCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const epsChartRef = React.useRef<Chart | null>(null);

  async function loadData() {
    setLoading(true);
    try {
      const url = `api/v1/wazuh/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const r = await fetch(url, { headers: apiGetHeaders() });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error ?? 'Unknown error');

      const agentList: WzAgent[] = (d.agents ?? []).map((a: any) => ({
        id: a.id ?? '', name: a.name ?? '', ip: a.ip ?? '',
        status: a.status ?? 'unknown',
        os_name: a.os_name ?? '', os_version: a.os_version ?? '',
        wazuh_version: a.wazuh_version ?? '',
        groups: a.groups ?? [], node_name: a.node_name ?? '',
      }));
      agentList.sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (b.status === 'active' && a.status !== 'active') return 1;
        return a.name.localeCompare(b.name);
      });
      setAgents(agentList);
      setSca((d.sca ?? []).map((s: any) => ({ agent_id: s.agent_id ?? '', policy_name: s.policy_name ?? '', score: s.score ?? 0, passed: s.passed ?? 0, failed: s.failed ?? 0, total: s.total ?? 0 })));
      setHw((d.hardware ?? []).map((h: any) => ({ agent_id: h.agent_id ?? '', cpu_name: h.cpu_name ?? '', cpu_cores: h.cpu_cores ?? 0, ram_mb: h.ram_mb ?? 0, os: h.os ?? '', hostname: h.hostname ?? '' })));
      setMitre(d.mitre ?? null);
      setEvents(d.events ?? []);
      setSevCounts(d.severity_counts ?? {});
      const vd = d.vulnerabilities ?? {};
      setVulnTop((vd.top ?? []).map((v: any) => ({ ts: v.ts ?? '', agent: v.agent ?? '', severity: v.severity ?? '', cve: v.cve ?? '', title: v.title ?? '', cvss: v.cvss ?? null, package_name: v.package_name ?? null, package_version: v.package_version ?? null })));
      setVulnByAgent(vd.by_agent ?? []);

      // EPS stacked area chart — per-category breakdown
      const epsData = d.eps ?? { buckets: [], categories: [] };
      const epsBuckets: any[] = epsData.buckets ?? [];
      const epsCategories: string[] = epsData.categories ?? [];
      if (epsChartRef.current && epsBuckets.length) {
        const chart = epsChartRef.current;
        chart.data.labels = epsBuckets.map((b: any) => { const dt = new Date(b.ts); return `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`; });
        const EPS_CAT_COLORS: Record<string, string> = {
          agent: '#4ade80', sca: '#fbbf24', syscollector: '#60a5fa', vulnerability: '#f87171',
          mitre: '#e879f9', fim: '#fb923c', rootcheck: '#a78bfa', syscheck: '#38bdf8',
          virustotal: '#34d399', osquery: '#818cf8', docker: '#22d3ee', audit: '#f472b6',
        };
        const fallbackColors = ['#94a3b8','#c084fc','#86efac','#fca5a1','#7dd3fc','#d4d4d8','#fde68a','#a5b4fc'];
        let fallbackIdx = 0;
        const catColor = (cat: string) => EPS_CAT_COLORS[cat] ?? fallbackColors[fallbackIdx++ % fallbackColors.length];
        // Total line
        const datasets: any[] = [{
          label: 'Total',
          data: epsBuckets.map((b: any) => b.total ?? 0),
          borderColor: 'rgba(167,139,250,0.85)',
          backgroundColor: 'transparent',
          tension: 0.35, fill: false, pointRadius: 0, borderWidth: 2.5, borderDash: [6, 3],
          order: 0,
        }];
        // Per-category stacked areas
        for (const cat of epsCategories) {
          const color = catColor(cat);
          datasets.push({
            label: cat,
            data: epsBuckets.map((b: any) => b[cat] ?? 0),
            borderColor: color,
            backgroundColor: color + '28',
            tension: 0.35, fill: true, pointRadius: 0, borderWidth: 1.5,
            stack: 'eps',
            order: 1,
          });
        }
        chart.data.datasets = datasets;
        chart.update('none');
      }
    } catch (e) { console.error('[wazuh-tab]', e); } finally { setLoading(false); }
  }

  React.useEffect(() => {
    if (!epsCanvasRef.current) return;
    const ctx = epsCanvasRef.current.getContext('2d');
    if (!ctx) return;
    const grad = ctx.createLinearGradient(0, 0, 0, 200);
    grad.addColorStop(0, 'rgba(167,139,250,0.28)');
    grad.addColorStop(1, 'rgba(167,139,250,0)');
    epsChartRef.current = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { border: { display: false }, grid: { color: 'rgba(167,139,250,0.04)' }, ticks: { color: 'rgba(233,238,255,.45)', maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 10 } } },
          y: { stacked: true, border: { display: false }, grid: { color: 'rgba(167,139,250,0.06)' }, ticks: { color: 'rgba(233,238,255,.45)', maxTicksLimit: 5, font: { size: 10 } } },
        },
        plugins: {
          legend: { display: true, position: 'bottom' as const, labels: { color: 'rgba(233,238,255,0.65)', boxWidth: 10, boxHeight: 10, padding: 10, font: { size: 10 }, usePointStyle: true, pointStyle: 'rectRounded' } },
          tooltip: { backgroundColor: 'rgba(10,6,30,.92)', borderColor: 'rgba(167,139,250,.3)', borderWidth: 1, titleColor: '#c4b5fd', bodyColor: '#e2e8f0' },
        },
      },
      plugins: [{ id: 'wzGlow', beforeDatasetsDraw(c) { c.ctx.save(); c.ctx.shadowColor = 'rgba(167,139,250,.35)'; c.ctx.shadowBlur = 14; }, afterDatasetsDraw(c) { c.ctx.restore(); } }],
    });
    return () => { epsChartRef.current?.destroy(); epsChartRef.current = null; };
  }, []);

  React.useEffect(() => { loadData(); }, []);

  const activeCount = agents.filter(a => a.status === 'active').length;
  const disconnectedCount = agents.filter(a => a.status !== 'active').length;
  const avgSca = sca.length ? Math.round(sca.reduce((s, x) => s + x.score, 0) / sca.length) : 0;
  const totalEvents = Object.values(sevCounts).reduce((a, b) => a + b, 0);

  // Map agent_id → agent name for SCA display
  const agentNameMap = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) {
      if (a.id) m.set(a.id, a.name || a.id);
      if (a.name) m.set(a.name, a.name);
    }
    return m;
  }, [agents]);
  const resolveAgentName = (id: string) => agentNameMap.get(id) || id;

  const subtabs: Array<{ key: typeof tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'agents',   label: 'Agents' },
    { key: 'sca',      label: 'Compliance' },
    { key: 'vulns',    label: 'Vulnerabilities' },
    { key: 'mitre',    label: 'MITRE ATT&CK' },
    { key: 'events',   label: 'Events' },
  ];

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: isMobile ? 30 : 36, height: isMobile ? 30 : 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(167,139,250,0.3)',
            fontSize: isMobile ? 15 : 18, fontWeight: 900, color: '#fff',
          }}>W</div>
          <div>
            <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 800, color: '#e9eeff', letterSpacing: '-0.01em' }}>Wazuh SIEM</div>
            {!isMobile && <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>Security Information & Event Management</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <TimeRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <button onClick={() => { loadData(); }} disabled={loading} style={{
            ...S.btn,
            background: 'linear-gradient(135deg, rgba(167,139,250,0.25), rgba(124,58,237,0.25))',
            border: '1px solid rgba(167,139,250,0.35)',
            padding: '8px 14px',
          }}>{loading ? '...' : 'Refresh'}</button>
        </div>
      </div>

      {/* ── KPI Strip ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Agents', value: agents.length, color: '#a78bfa', glow: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.25)' },
          { label: 'Active', value: activeCount, color: '#4ade80', glow: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.25)' },
          { label: 'Disconnected', value: disconnectedCount, color: disconnectedCount > 0 ? '#fbbf24' : '#64748b', glow: disconnectedCount > 0 ? 'rgba(251,191,36,0.08)' : 'transparent', border: disconnectedCount > 0 ? 'rgba(251,191,36,0.2)' : 'rgba(140,160,255,0.12)' },
          { label: 'SCA Avg', value: `${avgSca}%`, color: avgSca >= 70 ? '#4ade80' : avgSca >= 40 ? '#fbbf24' : '#f87171', glow: 'rgba(74,222,128,0.08)', border: avgSca >= 70 ? 'rgba(74,222,128,0.2)' : 'rgba(251,191,36,0.2)' },
          { label: 'Events', value: totalEvents, color: '#60a5fa', glow: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.2)' },
        ].map(({ label, value, color, glow, border }) => (
          <div key={label} style={{
            background: `linear-gradient(135deg, ${glow}, rgba(12,18,40,0.5))`,
            border: `1px solid ${border}`,
            borderRadius: 14,
            padding: '16px 18px',
            position: 'relative' as const,
            overflow: 'hidden' as const,
          }}>
            <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: `radial-gradient(circle, ${color}08, transparent)` }} />
            <div style={{ fontSize: 10, color: 'rgba(233,238,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Severity mini-bar ─────────────────────────────────────────── */}
      {totalEvents > 0 && (
        <div style={{ ...WZ.panel, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>Severity</span>
          <div style={{ flex: 1, display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', background: 'rgba(140,160,255,0.06)' }}>
            {['critical', 'high', 'medium', 'low', 'info'].map(sev => {
              const n = sevCounts[sev] ?? 0;
              if (!n) return null;
              return <div key={sev} style={{ width: `${(n / totalEvents) * 100}%`, background: SEV_COLOR[sev], transition: 'width 0.5s' }} title={`${sev}: ${n}`} />;
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            {['critical', 'high', 'medium', 'low', 'info'].map(sev => {
              const n = sevCounts[sev] ?? 0;
              if (!n) return null;
              return (
                <span key={sev} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: SEV_COLOR[sev] }} />
                  <span style={{ color: SEV_COLOR[sev], fontWeight: 700 }}>{n}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Sub-tabs ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid rgba(167,139,250,0.12)', paddingBottom: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {subtabs.map(st => {
          const active = tab === st.key;
          return (
            <button key={st.key} onClick={() => setSubTab(st.key)} style={{
              padding: isMobile ? '8px 12px' : '10px 18px',
              fontSize: isMobile ? 12 : 13,
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              border: 'none',
              borderBottom: active ? '2px solid #a78bfa' : '2px solid transparent',
              background: 'transparent',
              color: active ? '#c4b5fd' : 'rgba(233,238,255,0.5)',
              transition: 'all 0.15s',
              marginBottom: -1,
              whiteSpace: 'nowrap',
            }}>{st.label}</button>
          );
        })}
      </div>

      {/* ══════════ OVERVIEW ══════════ */}
      {tab === 'overview' && (
        <div>
          {/* EPS Chart */}
          <div style={{ ...WZ.panel, padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 3, height: 16, borderRadius: 2, background: '#a78bfa' }} />
                <span style={{ fontWeight: 700, fontSize: 14, color: '#e9eeff' }}>Event Throughput</span>
              </div>
              <span style={{ fontSize: 11, color: '#475569' }}>events/sec by category</span>
            </div>
            <div style={{ position: 'relative', height: isMobile ? 180 : 240 }}>
              <canvas ref={epsCanvasRef} style={{ width: '100%', height: '100%' }} />
            </div>
          </div>

          {/* Grid: Agents + SCA + MITRE */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Agents grid */}
            <div style={WZ.panel}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ width: 3, height: 16, borderRadius: 2, background: '#4ade80' }} />
                <span style={{ fontWeight: 700, fontSize: 14 }}>Agent Fleet</span>
                <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>{agents.length} total</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 6 }}>
                {agents.slice(0, 48).map(a => {
                  const isActive = a.status === 'active';
                  return (
                    <div key={a.id || a.name} style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '7px 10px', borderRadius: 10,
                      background: isActive ? 'rgba(74,222,128,0.06)' : 'rgba(100,116,139,0.06)',
                      border: `1px solid ${isActive ? 'rgba(74,222,128,0.18)' : 'rgba(100,116,139,0.12)'}`,
                      transition: 'all 0.2s',
                    }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: isActive ? '#4ade80' : '#64748b',
                        boxShadow: isActive ? '0 0 8px rgba(74,222,128,0.6)' : 'none',
                      }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                        <div style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace' }}>{shortIp(a.ip) || a.id}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {agents.length > 48 && <div style={{ fontSize: 11, color: '#475569', marginTop: 8, textAlign: 'center' }}>+{agents.length - 48} more agents</div>}
            </div>

            {/* SCA Overview with gauges */}
            <div style={WZ.panel}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ width: 3, height: 16, borderRadius: 2, background: '#fbbf24' }} />
                <span style={{ fontWeight: 700, fontSize: 14 }}>SCA Compliance</span>
                <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>{sca.length} policies</span>
              </div>
              {sca.length === 0 && <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', padding: 20 }}>No SCA data</div>}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? '120px' : '130px'}, 1fr))`, gap: 10 }}>
                {sca.slice(0, 12).map((s, i) => (
                  <div key={i} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '14px 10px 10px', borderRadius: 12,
                    background: 'rgba(140,160,255,0.03)',
                    border: '1px solid rgba(140,160,255,0.08)',
                    textAlign: 'center',
                  }}>
                    <ScaGauge score={s.score} size={56} />
                    <div style={{ marginTop: 8, width: '100%', minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={resolveAgentName(s.agent_id)}>{resolveAgentName(s.agent_id)}</div>
                      <div style={{ fontSize: 9, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }} title={s.policy_name}>{s.policy_name}</div>
                      <div style={{ fontSize: 9, color: '#475569', marginTop: 4, display: 'flex', justifyContent: 'center', gap: 6 }}>
                        <span><span style={{ color: '#4ade80', fontWeight: 700 }}>{s.passed}</span> <span style={{ color: '#475569' }}>pass</span></span>
                        <span><span style={{ color: '#f87171', fontWeight: 700 }}>{s.failed}</span> <span style={{ color: '#475569' }}>fail</span></span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {sca.length > 12 && <div style={{ fontSize: 11, color: '#475569', marginTop: 8, textAlign: 'center' }}>+{sca.length - 12} more policies</div>}
            </div>
          </div>

          {/* MITRE banner */}
          {mitre && (
            <div style={{ ...WZ.panel, padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 3, height: 16, borderRadius: 2, background: '#60a5fa' }} />
                <span style={{ fontWeight: 700, fontSize: 14 }}>MITRE ATT&CK</span>
              </div>
              {[
                { n: mitre.techniques, l: 'Techniques', c: '#a78bfa' },
                { n: mitre.tactics, l: 'Tactics', c: '#60a5fa' },
                { n: mitre.groups, l: 'Groups', c: '#fb923c' },
                { n: mitre.software, l: 'Software', c: '#4ade80' },
              ].map(({ n, l, c }) => (
                <div key={l} style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: c }}>{n}</span>
                  <span style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</span>
                </div>
              ))}
            </div>
          )}

          {/* Recent Events */}
          <div style={WZ.panel}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 3, height: 16, borderRadius: 2, background: '#f87171' }} />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Recent Events</span>
              <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>{events.length} events</span>
            </div>
            {events.length === 0 && <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', padding: 20 }}>No events in selected range</div>}
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {events.slice(0, 40).map((e, i) => <FeedRow key={i} e={e} />)}
            </div>
          </div>
        </div>
      )}

      {/* ══════════ AGENTS ══════════ */}
      {tab === 'agents' && (
        <div style={{ ...WZ.panelFlush, maxHeight: 'calc(100vh - 300px)', overflow: 'auto' }}>
          <table style={{ ...S.table, tableLayout: 'fixed', minWidth: 700 }}>
            <colgroup>
              <col style={{ width: 50 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'rgba(10,6,30,0.95)', backdropFilter: 'blur(8px)' }}>
              <tr>
                {['ID', 'Status', 'Name', 'IP', 'OS', 'Version', 'Groups'].map(h => (
                  <th key={h} style={{ ...S.th, borderColor: 'rgba(167,139,250,0.12)', color: '#94a3b8' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 && (
                <tr><td colSpan={7} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 32 }}>{loading ? 'Loading...' : 'No agent data'}</td></tr>
              )}
              {agents.map((a, i) => {
                const isExp = expandedAgent === a.id;
                const isActive = a.status === 'active';
                const statusColor = isActive ? '#4ade80' : '#fbbf24';
                const hwInfo = hw.find(h => h.agent_id === a.id || h.agent_id === a.name);
                const scaInfo = sca.filter(s => s.agent_id === a.id || s.agent_id === a.name);
                return (
                  <React.Fragment key={a.id || i}>
                    <tr onClick={() => setExpandedAgent(isExp ? null : a.id)} style={{
                      cursor: 'pointer',
                      background: isExp ? 'rgba(167,139,250,0.06)' : i % 2 ? 'rgba(255,255,255,0.012)' : 'transparent',
                      transition: 'background 0.15s',
                    }}>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: '#64748b', borderColor: 'rgba(167,139,250,0.06)' }}>{a.id}</td>
                      <td style={{ ...S.td, borderColor: 'rgba(167,139,250,0.06)' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '3px 10px', borderRadius: 99, fontSize: 10, fontWeight: 700,
                          background: `${statusColor}15`, color: statusColor,
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, boxShadow: isActive ? `0 0 6px ${statusColor}` : 'none' }} />
                          {a.status}
                        </span>
                      </td>
                      <td style={{ ...S.td, fontWeight: 600, borderColor: 'rgba(167,139,250,0.06)' }}>{a.name}</td>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: '#94a3b8', borderColor: 'rgba(167,139,250,0.06)' }}>{shortIp(a.ip)}</td>
                      <td style={{ ...S.td, fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderColor: 'rgba(167,139,250,0.06)' }} title={`${a.os_name} ${a.os_version}`}>{a.os_name} {a.os_version}</td>
                      <td style={{ ...S.td, fontSize: 11, color: '#64748b', borderColor: 'rgba(167,139,250,0.06)' }}>{a.wazuh_version}</td>
                      <td style={{ ...S.td, fontSize: 11, color: '#64748b', borderColor: 'rgba(167,139,250,0.06)' }}>{Array.isArray(a.groups) ? a.groups.join(', ') : ''}</td>
                    </tr>
                    {isExp && (
                      <tr style={{ background: 'rgba(167,139,250,0.04)' }}>
                        <td colSpan={7} style={{ padding: '16px 20px', borderBottom: '1px solid rgba(167,139,250,0.08)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20 }}>
                            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(140,160,255,0.03)', border: '1px solid rgba(140,160,255,0.08)' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Hardware</div>
                              {hwInfo ? (
                                <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                                  {[
                                    ['CPU', hwInfo.cpu_name || '—'],
                                    ['Cores', String(hwInfo.cpu_cores || '—')],
                                    ['RAM', hwInfo.ram_mb ? `${hwInfo.ram_mb.toLocaleString()} MB` : '—'],
                                    ['OS', hwInfo.os || '—'],
                                    ['Hostname', hwInfo.hostname || '—'],
                                  ].map(([k, v]) => (
                                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span style={{ color: '#475569' }}>{k}</span>
                                      <span style={{ color: '#cbd5e1', fontFamily: 'monospace', fontSize: 11 }}>{v}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : <span style={{ fontSize: 11, color: '#475569' }}>No hardware data</span>}
                            </div>
                            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(140,160,255,0.03)', border: '1px solid rgba(140,160,255,0.08)' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>SCA Compliance</div>
                              {scaInfo.length > 0 ? scaInfo.map((s, j) => (
                                <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                                  <ScaGauge score={s.score} size={40} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.policy_name.slice(0, 45)}</div>
                                    <div style={{ fontSize: 10, color: '#475569' }}>{s.passed} passed / {s.failed} failed</div>
                                  </div>
                                </div>
                              )) : <span style={{ fontSize: 11, color: '#475569' }}>No SCA data</span>}
                            </div>
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

      {/* ══════════ SCA ══════════ */}
      {tab === 'sca' && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {sca.length === 0 && <div style={{ ...WZ.panel, color: '#475569', textAlign: 'center' }}>No SCA data available</div>}
          {sca.map((s, i) => {
            const color = s.score >= 70 ? '#4ade80' : s.score >= 40 ? '#fbbf24' : '#f87171';
            return (
              <div key={i} style={{
                ...WZ.panel,
                borderColor: `${color}20`,
                display: 'flex', gap: 16, alignItems: 'center',
              }}>
                <ScaGauge score={s.score} size={80} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>{resolveAgentName(s.agent_id)}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, fontFamily: 'monospace' }}>{s.agent_id !== resolveAgentName(s.agent_id) ? s.agent_id : ''}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.policy_name}</div>
                  <div style={{ height: 6, borderRadius: 99, background: 'rgba(140,160,255,0.08)', overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', borderRadius: 99, background: `linear-gradient(90deg, ${color}, ${color}88)`, width: `${s.score}%`, transition: 'width 0.5s' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 14, fontSize: 11 }}>
                    <span style={{ color: '#4ade80', fontWeight: 600 }}>{s.passed} <span style={{ color: '#475569', fontWeight: 400 }}>pass</span></span>
                    <span style={{ color: '#f87171', fontWeight: 600 }}>{s.failed} <span style={{ color: '#475569', fontWeight: 400 }}>fail</span></span>
                    <span style={{ color: '#64748b' }}>{s.total} total</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════ VULNERABILITIES ══════════ */}
      {tab === 'vulns' && (() => {
        const totalVulns = vulnByAgent.reduce((s, v) => s + v.total, 0);
        const totalCrit = vulnByAgent.reduce((s, v) => s + v.critical, 0);
        const totalHigh = vulnByAgent.reduce((s, v) => s + v.high, 0);
        const totalMed = vulnByAgent.reduce((s, v) => s + v.medium, 0);
        const totalLow = vulnByAgent.reduce((s, v) => s + v.low, 0);
        const sevColor = (sev: string) => ({ critical: '#ef4444', high: '#f97316', medium: '#fbbf24', low: '#60a5fa', info: '#94a3b8' }[sev] || '#94a3b8');
        return (
          <div>
            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
              {[
                { label: 'Total', value: totalVulns, color: '#a78bfa' },
                { label: 'Critical', value: totalCrit, color: '#ef4444' },
                { label: 'High', value: totalHigh, color: '#f97316' },
                { label: 'Medium', value: totalMed, color: '#fbbf24' },
                { label: 'Low', value: totalLow, color: '#60a5fa' },
              ].map(k => (
                <div key={k.label} style={{
                  ...WZ.panel, padding: '16px 14px', textAlign: 'center',
                  borderColor: `${k.color}20`,
                }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: k.color, lineHeight: 1, marginBottom: 4 }}>{k.value.toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: 'rgba(233,238,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>{k.label}</div>
                </div>
              ))}
            </div>

            {/* Vulns by agent */}
            {vulnByAgent.length > 0 && (
              <div style={{ ...WZ.panelFlush, marginBottom: 16 }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(167,139,250,0.1)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 3, height: 16, borderRadius: 2, background: '#f97316' }} />
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Vulnerabilities by Agent</span>
                  <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>{vulnByAgent.length} agents</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(167,139,250,0.1)' }}>
                        {['Agent', 'Total', 'Critical', 'High', 'Medium', 'Low'].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Agent' ? 'left' : 'center', fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {vulnByAgent.map((v, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(167,139,250,0.05)' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 600, color: '#e2e8f0' }}>{resolveAgentName(v.agent)}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#a78bfa' }}>{v.total}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: v.critical > 0 ? '#ef4444' : '#334155' }}>{v.critical}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: v.high > 0 ? '#f97316' : '#334155' }}>{v.high}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: v.medium > 0 ? '#fbbf24' : '#334155' }}>{v.medium}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: v.low > 0 ? '#60a5fa' : '#334155' }}>{v.low}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Top vulnerabilities table */}
            {vulnTop.length > 0 && (
              <div style={WZ.panelFlush}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(167,139,250,0.1)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 3, height: 16, borderRadius: 2, background: '#ef4444' }} />
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Top Vulnerabilities</span>
                  <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>sorted by severity</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(167,139,250,0.1)' }}>
                        {['Severity', 'CVE', 'Agent', 'Affected Package', 'CVSS'].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {vulnTop.map((v, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(167,139,250,0.05)' }}>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                              background: `${sevColor(v.severity)}18`, color: sevColor(v.severity), textTransform: 'uppercase',
                            }}>{v.severity}</span>
                          </td>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, color: '#e2e8f0', fontWeight: 600 }}>{v.cve}</td>
                          <td style={{ padding: '10px 14px', color: '#94a3b8' }}>{resolveAgentName(v.agent)}</td>
                          <td style={{ padding: '10px 14px', color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>
                            {v.package_name ? `${v.package_name}${v.package_version ? ` ${v.package_version}` : ''}` : '-'}
                          </td>
                          <td style={{ padding: '10px 14px', fontWeight: 700, color: v.cvss && parseFloat(String(v.cvss)) >= 7 ? '#f97316' : '#94a3b8' }}>{v.cvss ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {totalVulns === 0 && <div style={{ ...WZ.panel, color: '#475569', textAlign: 'center' }}>No vulnerability data available</div>}
          </div>
        );
      })()}

      {/* ══════════ MITRE ══════════ */}
      {tab === 'mitre' && (
        <div>
          {!mitre ? (
            <div style={{ ...WZ.panel, color: '#475569', textAlign: 'center' }}>No MITRE ATT&CK data available</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
                {[
                  { label: 'Techniques', value: mitre.techniques, color: '#a78bfa', gradient: 'linear-gradient(135deg, rgba(167,139,250,0.12), rgba(124,58,237,0.06))' },
                  { label: 'Tactics', value: mitre.tactics, color: '#60a5fa', gradient: 'linear-gradient(135deg, rgba(96,165,250,0.12), rgba(37,99,235,0.06))' },
                  { label: 'Threat Groups', value: mitre.groups, color: '#fb923c', gradient: 'linear-gradient(135deg, rgba(251,146,60,0.12), rgba(234,88,12,0.06))' },
                  { label: 'Software', value: mitre.software, color: '#4ade80', gradient: 'linear-gradient(135deg, rgba(74,222,128,0.12), rgba(22,163,74,0.06))' },
                ].map(({ label, value, color, gradient }) => (
                  <div key={label} style={{
                    ...WZ.panel,
                    background: gradient,
                    borderColor: `${color}20`,
                    textAlign: 'center',
                    padding: '28px 16px',
                  }}>
                    <div style={{ fontSize: 42, fontWeight: 800, color, lineHeight: 1, marginBottom: 8, letterSpacing: '-0.03em' }}>{value}</div>
                    <div style={{ fontSize: 11, color: 'rgba(233,238,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>{label}</div>
                  </div>
                ))}
              </div>

              <div style={WZ.panel}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ width: 3, height: 16, borderRadius: 2, background: '#60a5fa' }} />
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Coverage Summary</span>
                </div>
                <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7, margin: 0 }}>
                  Wazuh detection rules provide coverage for <strong style={{ color: '#c4b5fd' }}>{mitre.techniques}</strong> MITRE ATT&CK techniques
                  across <strong style={{ color: '#60a5fa' }}>{mitre.tactics}</strong> tactical categories.
                  The rule set includes signatures for <strong style={{ color: '#fb923c' }}>{mitre.groups}</strong> known threat groups
                  and <strong style={{ color: '#4ade80' }}>{mitre.software}</strong> malicious software families documented in the ATT&CK knowledge base.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════ EVENTS ══════════ */}
      {tab === 'events' && (
        <div style={{ ...WZ.panelFlush, maxHeight: 'calc(100vh - 300px)', overflow: 'auto' }}>
          <table style={{ ...S.table, tableLayout: 'fixed', minWidth: 580 }}>
            <colgroup>
              <col style={{ width: 86 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '14%' }} />
              <col />
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'rgba(10,6,30,0.95)', backdropFilter: 'blur(8px)' }}>
              <tr>
                {['Time', 'Severity', 'Asset', 'Kind', 'Title'].map(h => (
                  <th key={h} style={{ ...S.th, borderColor: 'rgba(167,139,250,0.12)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr><td colSpan={5} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 32 }}>{loading ? 'Loading...' : 'No events'}</td></tr>
              )}
              {events.map((ev, i) => {
                const isExp = expandedEvent === i;
                const d = new Date(ev.ts);
                const ts = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                return (
                  <React.Fragment key={i}>
                    <tr onClick={() => setExpandedEvent(isExp ? null : i)} style={{
                      cursor: 'pointer',
                      background: isExp ? 'rgba(167,139,250,0.06)' : i % 2 ? 'rgba(255,255,255,0.012)' : 'transparent',
                      transition: 'background 0.15s',
                    }}>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: '#64748b', borderColor: 'rgba(167,139,250,0.06)' }}>{ts}</td>
                      <td style={{ ...S.td, borderColor: 'rgba(167,139,250,0.06)' }}><SevBadge sev={ev.severity} /></td>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderColor: 'rgba(167,139,250,0.06)' }}>{ev.asset_id}</td>
                      <td style={{ ...S.td, fontSize: 11, color: '#94a3b8', borderColor: 'rgba(167,139,250,0.06)' }}>{ev.kind}</td>
                      <td style={{ ...S.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderColor: 'rgba(167,139,250,0.06)' }} title={ev.title}>{ev.title}</td>
                    </tr>
                    {isExp && ev.message && (
                      <tr style={{ background: 'rgba(167,139,250,0.03)' }}>
                        <td colSpan={5} style={{ padding: '12px 16px', borderBottom: '1px solid rgba(167,139,250,0.06)' }}>
                          <pre style={{
                            margin: 0, fontSize: 12, color: 'rgba(233,238,255,0.80)',
                            lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            maxHeight: 220, overflowY: 'auto',
                            background: 'rgba(4,7,19,0.6)', border: '1px solid rgba(167,139,250,0.08)',
                            borderRadius: 8, padding: '10px 12px',
                          }}>{ev.message}</pre>
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
