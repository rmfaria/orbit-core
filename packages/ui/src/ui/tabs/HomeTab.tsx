import React from 'react';
import { t } from '../i18n';
import { S, Tab, AssetOpt, EventRow, NS_COLOR, NS_BG, SEV_COLOR, SEV_BG, apiHeaders, apiGetHeaders, relativeFrom, isoToLocal, visibleInterval, eventSource } from '../shared';
import { FeedRow } from '../components';
import { SysData } from './SystemTab';

export function HomeTab({ assets, setTab }: { assets: AssetOpt[]; setTab: (t: Tab) => void }) {
  const [health, setHealth] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [sysData, setSysData] = React.useState<SysData | null>(null);

  // Poll /api/v1/system every 15s
  React.useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch('api/v1/system', { headers: apiGetHeaders() });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setSysData(d);
      } catch { /* silent */ }
    }
    poll();
    const stop = visibleInterval(poll, 15_000);
    return () => { cancelled = true; stop(); };
  }, []);

  const [from, setFrom] = React.useState(() => relativeFrom(1));
  const [to, setTo] = React.useState(() => new Date().toISOString());

  const ALL_NS  = ['nagios', 'wazuh', 'fortigate', 'misp', 'n8n', 'otel', 'suricata', 'openclaw'];
  const ALL_SEV = ['critical', 'high', 'medium', 'low', 'info'] as const;

  const [feed, setFeed] = React.useState<EventRow[]>([]);
  const [feedNs, setFeedNs] = React.useState<string[]>([...ALL_NS]);
  const [feedSev, setFeedSev] = React.useState<string[]>([...ALL_SEV]);
  const [search, setSearch] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const pulseAbortRef = React.useRef<AbortController | null>(null);
  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    fetch('api/v1/health', { headers: apiGetHeaders() })
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setErr(String(e)));
  }, []);

  async function runPulse(opts?: { searchTerm?: string }) {
    pulseAbortRef.current?.abort();
    const ctrl = new AbortController();
    pulseAbortRef.current = ctrl;
    const signal = ctrl.signal;

    const term = opts?.searchTerm ?? search;
    if (term) setSearching(true);
    setErr(null);
    try {
      const q = (query: object) => ({
        method: 'POST' as const,
        headers: apiHeaders(),
        body: JSON.stringify({ language: 'orbitql', query }),
        signal,
      });

      const activeNs = feedNs.length ? feedNs : ALL_NS;
      const activeSev = feedSev.length < ALL_SEV.length ? feedSev : undefined;
      const limit = term ? 200 : 40;

      const evResults = await Promise.all(
        activeNs.map(ns =>
          fetch('api/v1/query', q({
            kind: 'events', namespace: ns, from, to, limit,
            ...(activeSev ? { severities: activeSev } : {}),
            ...(term ? { search: term } : {}),
          }))
            .then(r => r.json()).then(j => (j.result?.rows ?? []) as EventRow[])
        ),
      );

      if (signal.aborted) return;

      const mergedEvents = evResults.flat().sort((a, b) =>
        new Date(b.ts).getTime() - new Date(a.ts).getTime()
      );
      setFeed(mergedEvents.slice(0, 500));
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setErr(String(e));
    } finally {
      setSearching(false);
    }
  }

  // Initial load + auto-refresh
  React.useEffect(() => {
    runPulse();
    const stop = visibleInterval(() => {
      setTo(new Date().toISOString());
    }, 30_000);
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when filters change
  React.useEffect(() => {
    runPulse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, feedNs, feedSev]);

  // Debounced search — re-fetches from API
  React.useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      runPulse({ searchTerm: search });
    }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const dbColor  = health?.db === 'ok' ? '#4ade80' : health?.db === 'error' ? '#f87171' : '#fbbf24';
  const apiColor = health?.ok ? '#4ade80' : '#fbbf24';

  // System-based KPIs (from /api/v1/system)
  const sysCpu = sysData?.cpu;
  const sysMem = sysData?.memory;
  const sysDisk = sysData?.disk;
  const sysNet = sysData ? (sysData.network.find((n: any) => n.name === 'eth0') ?? sysData.network[0] ?? null) : null;

  const sysLoadPct = sysCpu ? Math.min(100, (sysCpu.load[0] / sysCpu.count) * 100) : 0;
  const sysCpuColor = sysLoadPct > 80 ? '#ff5dd6' : sysLoadPct > 50 ? '#fbbf24' : '#55f3ff';
  const sysMemColor = sysMem ? (sysMem.percent > 85 ? '#ff5dd6' : sysMem.percent > 65 ? '#fbbf24' : '#a78bfa') : '#a78bfa';
  const sysDiskColor = sysDisk ? (sysDisk.percent > 85 ? '#ff5dd6' : sysDisk.percent > 65 ? '#fbbf24' : '#4ade80') : '#4ade80';
  const sysNetColor = '#38bdf8';

  const toMbps = (b: number) => (b / 1048576 * 8).toFixed(2);

  const kpis = [
    { label: 'CPU',      value: sysCpu ? `${sysCpu.load[0].toFixed(1)}` : '…', hint: `load1`, color: sysCpuColor },
    { label: 'Memory',   value: sysMem ? `${sysMem.percent}%` : '…',           hint: sysMem ? `${sysMem.used_mb}/${sysMem.total_mb} MB` : '', color: sysMemColor },
    { label: 'Disk',     value: sysDisk ? `${sysDisk.percent}%` : '…',         hint: sysDisk ? `${sysDisk.used_gb}/${sysDisk.total_gb} GB` : '', color: sysDiskColor },
    { label: 'Network',  value: sysNet ? `↓${toMbps(sysNet.rx_per_sec)} ↑${toMbps(sysNet.tx_per_sec)}` : '…', hint: 'Mbps', color: sysNetColor },
    { label: 'API',      value: health?.ok ? 'ok' : '…',                       hint: '', color: apiColor },
    { label: 'DB',       value: health?.db ?? '…',                              hint: '', color: dbColor },
  ];

  return (
    <div style={{ position: 'relative' }}>
      <div className="orbit-stars" />

      <div className="orbit-panel">
        {/* Header: brand + status + range */}
        <div className="orbit-panel-head">
          <div>
            <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '.4px' }}>◎ Orbit Core</div>
            <div style={{ color: 'rgba(233,238,255,.65)', fontSize: 12, marginTop: 4 }}>
              {t('home_subtitle')}<a href="#" onClick={(e) => { e.preventDefault(); setTab('src-nagios'); }} style={{ color: '#55f3ff', textDecoration: 'none' }}>{t('home_subtitle_link')}</a>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="orbit-pill" style={{ padding: '3px 4px', gap: 2 }}>
              {[['1h',1],['6h',6],['24h',24],['7d',168]].map(([lbl, h]) => {
                const active = from === relativeFrom(Number(h));
                return (
                  <button key={lbl} className="orbit-badge" style={{
                    cursor: 'pointer',
                    background: active ? 'rgba(85,243,255,.15)' : 'transparent',
                    color: active ? '#55f3ff' : undefined,
                  }}
                    onClick={() => { setFrom(relativeFrom(Number(h))); setTo(new Date().toISOString()); }}>{lbl}</button>
                );
              })}
            </div>
            <div className="orbit-pill">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: apiColor, display: 'inline-block' }} />
              <span>{health ? (health.ok ? 'live' : 'degraded') : 'connecting…'}</span>
            </div>
            <div className="orbit-pill">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dbColor, display: 'inline-block' }} />
              <span>db: {health?.db ?? '…'}</span>
            </div>
          </div>
        </div>

        {/* Slim KPI strip */}
        <div className="orbit-kpi-strip orbit-kpi-strip--slim">
          {kpis.map((k) => (
            <div key={k.label} className="orbit-kpi orbit-kpi--slim" style={{ '--kpi-color': k.color } as React.CSSProperties}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value" style={{ color: k.color }}>{k.value}</div>
              {k.hint && <div className="kpi-hint">{k.hint}</div>}
            </div>
          ))}
        </div>

        {/* Full-width Live Feed */}
        <div style={{ padding: '0 16px 16px' }}>
          <div className="orbit-panel" style={{ margin: 0 }}>
            <div className="orbit-panel-head" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div className="orbit-panel-title">Live Feed</div>
                  <div className="orbit-panel-meta">consolidated events by source</div>
                </div>
                <span className="orbit-badge" style={{ marginLeft: 4 }}>{searching ? 'searching…' : 'stream'}</span>
              </div>

              {/* Investigate search */}
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Investigate — deep search across all events..."
                  className="orbit-investigate"
                />
              </div>

              {/* Filters: source + severity on same line */}
              <div className="orbit-filters-row">
                <span className="orbit-filter-label">source</span>
                {ALL_NS.map(ns => {
                  const active = feedNs.includes(ns);
                  const color  = NS_COLOR[ns] ?? 'rgba(233,238,255,.55)';
                  const bg     = NS_BG[ns]    ?? 'rgba(30,40,80,.5)';
                  return (
                    <button key={ns} className="orbit-filter-pill" onClick={() =>
                      setFeedNs(prev => prev.includes(ns) ? prev.filter(x => x !== ns) : [...prev, ns])
                    } style={{
                      border: `1px solid ${active ? color : 'rgba(140,160,255,.2)'}`,
                      background: active ? bg : 'transparent',
                      color: active ? color : 'rgba(233,238,255,.35)',
                    }}>{ns}</button>
                  );
                })}
                <span className="orbit-filter-sep" />
                <span className="orbit-filter-label">severity</span>
                {ALL_SEV.map(sev => {
                  const active = feedSev.includes(sev);
                  const color  = SEV_COLOR[sev] ?? 'rgba(233,238,255,.55)';
                  const bg     = SEV_BG[sev]    ?? 'rgba(30,40,80,.5)';
                  return (
                    <button key={sev} className="orbit-filter-pill" onClick={() =>
                      setFeedSev(prev => prev.includes(sev) ? prev.filter(x => x !== sev) : [...prev, sev])
                    } style={{
                      border: `1px solid ${active ? color : 'rgba(140,160,255,.2)'}`,
                      background: active ? bg : 'transparent',
                      color: active ? color : 'rgba(233,238,255,.35)',
                    }}>{sev}</button>
                  );
                })}
                <span className="orbit-filter-sep" />
                <span className="orbit-filter-label">from</span>
                <input
                  type="datetime-local"
                  className="orbit-filter-datetime"
                  value={isoToLocal(from)}
                  onChange={e => { if (e.target.value) setFrom(new Date(e.target.value).toISOString()); }}
                />
                <span className="orbit-filter-label">to</span>
                <input
                  type="datetime-local"
                  className="orbit-filter-datetime"
                  value={isoToLocal(to)}
                  onChange={e => { if (e.target.value) setTo(new Date(e.target.value).toISOString()); }}
                />
              </div>
            </div>
            <div className="orbit-feed orbit-feed--full">
              {(() => {
                if (feed.length === 0) return (
                  <div style={{ color: 'rgba(233,238,255,.45)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                    {search ? `No results for "${search}"` : t('home_no_events')}
                  </div>
                );
                return feed.slice(0, 100).map((e, idx) => (
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
