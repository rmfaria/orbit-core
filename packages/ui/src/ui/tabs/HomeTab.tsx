import React from 'react';
import { Chart } from 'chart.js';
import { t } from '../i18n';
import { S, Tab, AssetOpt, EventRow, NS_COLOR, NS_BG, Row, MultiRow, MetricOpt, apiHeaders, apiGetHeaders, relativeFrom, visibleInterval, eventSource } from '../shared';
import { FeedRow } from '../components';
import { makeNeLineChart, glowGradient } from '../chartHelpers';
import { HomeSysIndicators, SysData } from './SystemTab';
import { EpsChart } from '../EpsChart';

export function HomeTab({ assets, setTab }: { assets: AssetOpt[]; setTab: (t: Tab) => void }) {
  const [health, setHealth] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [sysData, setSysData] = React.useState<SysData | null>(null);

  // Poll /api/v1/system every 10s — shared between indicators and KPIs
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

  const [assetId, setAssetId] = React.useState('');
  const [from, setFrom] = React.useState(() => relativeFrom(1));
  const [to, setTo] = React.useState(() => new Date().toISOString());

  const [cpuRows, setCpuRows] = React.useState<MultiRow[]>([]);
  const [diskRows, setDiskRows] = React.useState<MultiRow[]>([]);
  const [netRows, setNetRows] = React.useState<MultiRow[]>([]);
  const [suriRows, setSuriRows] = React.useState<Row[]>([]);
  const [feed, setFeed] = React.useState<EventRow[]>([]);
  // selected namespaces for the consolidated feed
  const [feedNs, setFeedNs] = React.useState<string[]>(['nagios', 'wazuh', 'fortigate', 'n8n', 'otel', 'suricata', 'openclaw']);

  // Layout: 'side' = charts left + feed right; 'cols1/2/3' = stacked with N charts per row
  const [chartLayout, setChartLayout] = React.useState<'side' | 'cols1' | 'cols2' | 'cols3'>('side');

  // Extra charts (up to 2, for a max total of 6)
  type ExtraChartCfg = { id: string; ns: string; metric: string; label: string; asset: string };
  const [extraCharts, setExtraCharts] = React.useState<ExtraChartCfg[]>([]);
  const [extraRows, setExtraRows] = React.useState<Record<string, Row[]>>({});

  // Add-chart picker state
  const [showAddChart, setShowAddChart] = React.useState(false);
  const [addAsset, setAddAsset] = React.useState('');
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
  const pulseAbortRef = React.useRef<AbortController | null>(null);

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

  // load available metrics for the add-chart picker (based on picker's own asset selector)
  const pickerAsset = addAsset || assetId;
  React.useEffect(() => {
    if (!pickerAsset) return;
    fetch(`api/v1/catalog/metrics?asset_id=${encodeURIComponent(pickerAsset)}`, { headers: apiGetHeaders() })
      .then(r => r.json())
      .then(j => {
        const opts: MetricOpt[] = j.metrics ?? [];
        setMetricOpts(opts);
        if (opts.length) { setAddNs(opts[0].namespace); setAddMetric(opts[0].metric); }
        else { setAddNs(''); setAddMetric(''); }
      })
      .catch(e => console.error("[orbit]", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerAsset]);

  async function runPulse() {
    if (!assetId) return;

    // Cancel any in-flight request from a previous pulse.
    pulseAbortRef.current?.abort();
    const ctrl = new AbortController();
    pulseAbortRef.current = ctrl;
    const signal = ctrl.signal;

    setErr(null);
    try {
      const q = (query: object) => ({
        method: 'POST' as const,
        headers: apiHeaders(),
        body: JSON.stringify({ language: 'orbitql', query }),
        signal,
      });

      // LIMIT reasoning: backend auto-selects rollup table.
      // Widest range is 24h → hourly rollup → 24 pts/series × 3 series = 72 rows max.
      // 2000 is ample headroom for any zoom level.
      const LIMIT = 2000;

      const evNsList = ['nagios', 'wazuh', 'otel', 'n8n', 'suricata'];

      // Fire ALL queries in a single round-trip (metrics + events together).
      const [rCpu, rDisk, rNet, rSuri, ...evResults] = await Promise.all([
        fetch('api/v1/query', q({ kind: 'timeseries_multi', from, to, agg: 'avg', limit: LIMIT,
          series: [
            { asset_id: assetId, namespace: 'nagios', metric: 'load1',  dimensions: { service: 'CPU Load' }, label: 'load1'  },
            { asset_id: assetId, namespace: 'nagios', metric: 'load5',  dimensions: { service: 'CPU Load' }, label: 'load5'  },
            { asset_id: assetId, namespace: 'nagios', metric: 'load15', dimensions: { service: 'CPU Load' }, label: 'load15' },
          ],
        })).then(r => r.json()),
        fetch('api/v1/query', q({ kind: 'timeseries_multi', from, to, agg: 'avg', limit: LIMIT,
          series: [
            { asset_id: assetId, namespace: 'nagios', metric: 'aqu',  dimensions: { service: 'Disk_Queue_sda' }, label: 'aqu-sz' },
            { asset_id: assetId, namespace: 'nagios', metric: 'util', dimensions: { service: 'Disk_Queue_sda' }, label: '%util'  },
          ],
        })).then(r => r.json()),
        fetch('api/v1/query', q({ kind: 'timeseries_multi', from, to, agg: 'avg', limit: LIMIT,
          series: [
            { asset_id: assetId, namespace: 'nagios', metric: 'rx_mbps', dimensions: { service: 'Network_Traffic_eth0' }, label: 'RX Mbps' },
            { asset_id: assetId, namespace: 'nagios', metric: 'tx_mbps', dimensions: { service: 'Network_Traffic_eth0' }, label: 'TX Mbps' },
          ],
        })).then(r => r.json()),
        fetch('api/v1/query', q({ kind: 'timeseries', asset_id: assetId, namespace: 'nagios',
          metric: 'alerts', from, to, agg: 'sum',
          dimensions: { service: 'Suricata_Alerts_5m' }, limit: LIMIT,
        })).then(r => r.json()),
        // Events: 40 per namespace so low-volume sources (otel, n8n) always appear.
        ...evNsList.map(ns =>
          fetch('api/v1/query', q({ kind: 'events', namespace: ns, from, to, limit: 40 }))
            .then(r => r.json()).then(j => (j.result?.rows ?? []) as EventRow[])
        ),
        // Extra user-added charts (each uses its own asset).
        ...extraCharts.map(cfg =>
          fetch('api/v1/query', q({ kind: 'timeseries', asset_id: cfg.asset,
            namespace: cfg.ns, metric: cfg.metric, from, to, agg: 'avg', limit: LIMIT,
          })).then(r => r.json()).then(j => ({ id: cfg.id, rows: (j.result?.rows ?? []).map((x: any) => ({ ts: x.ts, value: Number(x.value) })) }))
        ),
      ]);

      // Bail if a newer pulse has already started.
      if (signal.aborted) return;

      if (!rCpu.ok)  throw new Error(rCpu.error  ?? JSON.stringify(rCpu));
      if (!rDisk.ok) throw new Error(rDisk.error ?? JSON.stringify(rDisk));
      if (!rNet.ok)  throw new Error(rNet.error  ?? JSON.stringify(rNet));
      if (!rSuri.ok) throw new Error(rSuri.error ?? JSON.stringify(rSuri));

      // Separate the mixed evResults + extraCharts results back out.
      const evRows    = evResults.slice(0, evNsList.length) as EventRow[][];
      const extraData = evResults.slice(evNsList.length) as Array<{ id: string; rows: Row[] }>;

      const mergedEvents = (evRows as EventRow[][]).flat().sort((a, b) =>
        new Date(b.ts).getTime() - new Date(a.ts).getTime()
      );

      setCpuRows( (rCpu.result?.rows  ?? []).map((x: any) => ({ ts: x.ts, series: x.series, value: Number(x.value) })));
      setDiskRows((rDisk.result?.rows ?? []).map((x: any) => ({ ts: x.ts, series: x.series, value: Number(x.value) })));
      setNetRows( (rNet.result?.rows  ?? []).map((x: any) => ({ ts: x.ts, series: x.series, value: Number(x.value) })));
      setSuriRows((rSuri.result?.rows ?? []).map((x: any) => ({ ts: x.ts, value: Number(x.value) })));
      setFeed(mergedEvents.slice(0, 200));

      if (extraData.length) {
        const newExtra: Record<string, Row[]> = {};
        for (const e of extraData) if (e?.id) newExtra[e.id] = e.rows;
        setExtraRows(newExtra);
      }

    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setErr(String(e));
    }
  }

  React.useEffect(() => {
    if (!assetId) return;
    runPulse();
    const stop = visibleInterval(() => {
      setTo(new Date().toISOString());
    }, 30_000);
    return () => stop();
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

  const lastCpu  = React.useMemo(() => { const m: Record<string,number> = {}; for (const r of cpuRows)  m[r.series] = r.value; return m; }, [cpuRows]);
  const lastDisk = React.useMemo(() => { const m: Record<string,number> = {}; for (const r of diskRows) m[r.series] = r.value; return m; }, [diskRows]);
  const lastNet  = React.useMemo(() => { const m: Record<string,number> = {}; for (const r of netRows)  m[r.series] = r.value; return m; }, [netRows]);
  const fmtN = (v: any, d = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—');
  const suriLast = suriRows.length ? suriRows[suriRows.length - 1].value : null;

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
    { label: 'CPU Load',        value: sysCpu ? `${sysCpu.load[0].toFixed(2)} · ${sysCpu.load[1].toFixed(2)} · ${sysCpu.load[2].toFixed(2)}` : '…', hint: 'load1 · load5 · load15', color: sysCpuColor },
    { label: t('sys_memory'),   value: sysMem ? `${sysMem.percent}% · ${sysMem.used_mb}/${sysMem.total_mb} MB` : '…',                                hint: 'used · total',            color: sysMemColor },
    { label: t('sys_disk'),     value: sysDisk ? `${sysDisk.percent}% · ${sysDisk.used_gb}/${sysDisk.total_gb} GB` : '…',                            hint: 'used · total',            color: sysDiskColor },
    { label: t('sys_network'),  value: sysNet ? `↓ ${toMbps(sysNet.rx_per_sec)} · ↑ ${toMbps(sysNet.tx_per_sec)} Mbps` : '…',                       hint: sysNet?.name ?? 'eth0',    color: sysNetColor },
    { label: 'API',             value: health?.ok ? 'online' : '…',                                                                                  hint: '/api/v1/health',          color: apiColor },
    { label: 'Postgres',        value: health?.db ?? '…',                                                                                            hint: 'database',                color: dbColor },
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
              {t('home_subtitle')}<a href="#" onClick={(e) => { e.preventDefault(); setTab('src-nagios'); }} style={{ color: '#55f3ff', textDecoration: 'none' }}>{t('home_subtitle_link')}</a>
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
            <div key={k.label} className="orbit-kpi" style={{ '--kpi-color': k.color } as React.CSSProperties}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value" style={{ color: k.color }}>{k.value}</div>
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
                    {total}/6 charts
                  </span>
                  {total < 6 && !showAddChart && (
                    <button className="orbit-badge" style={{ cursor: 'pointer', background: 'rgba(85,243,255,.10)', borderColor: 'rgba(85,243,255,.3)', color: '#55f3ff' }}
                      onClick={() => setShowAddChart(true)}>{t('home_add_chart')}</button>
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
                <select className="orbit-pill" value={addAsset || assetId}
                  onChange={e => { setAddAsset(e.target.value); setAddNs(''); setAddMetric(''); }}
                  style={{ padding: '4px 8px' }}>
                  {assets.map(a => <option key={a.asset_id} value={a.asset_id}>{a.asset_id}</option>)}
                </select>
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
                    const chartAsset = addAsset || assetId;
                    const id = `${chartAsset}:${addNs}:${addMetric}:${Date.now()}`;
                    const label = addLabel || addMetric;
                    setExtraCharts(prev => [...prev, { id, ns: addNs, metric: addMetric, label, asset: chartAsset }]);
                    setShowAddChart(false);
                    setAddLabel('');
                    setAddAsset('');
                  }}>Adicionar</button>
                <button className="orbit-badge" style={{ cursor: 'pointer' }}
                  onClick={() => { setShowAddChart(false); setAddAsset(''); }}>Cancelar</button>
              </div>
            )}

            {/* Charts grid */}
            <div className={`orbit-charts-grid${chartLayout === 'cols1' ? ' orbit-charts-grid--1' : chartLayout === 'cols2' ? ' orbit-charts-grid--2' : chartLayout === 'cols3' ? ' orbit-charts-grid--3' : ''}`}>
              {!hiddenFixed.includes('cpu') && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">CPU Load</div>
                  <button className="orbit-chart-close" onClick={() => setHiddenFixed(h => [...h, 'cpu'])} title={t('chart_remove')}>×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={cpuRef} /></div>
                </div>
              )}
              {!hiddenFixed.includes('disk') && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">Disk Queue</div>
                  <button className="orbit-chart-close" onClick={() => setHiddenFixed(h => [...h, 'disk'])} title={t('chart_remove')}>×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={diskRef} /></div>
                </div>
              )}
              {!hiddenFixed.includes('net') && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">Net Traffic</div>
                  <button className="orbit-chart-close" onClick={() => setHiddenFixed(h => [...h, 'net'])} title={t('chart_remove')}>×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={netRef} /></div>
                </div>
              )}
              {!hiddenFixed.includes('suri') && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">Suricata Alerts</div>
                  <button className="orbit-chart-close" onClick={() => setHiddenFixed(h => [...h, 'suri'])} title={t('chart_remove')}>×</button>
                  <div className="orbit-chart-canvas-wrap"><canvas ref={suriRef} /></div>
                </div>
              )}
              {extraCharts[0] && (
                <div className="orbit-chart-box">
                  <div className="orbit-chart-tag">{extraCharts[0].label}{extraCharts[0].asset !== assetId ? ` · ${extraCharts[0].asset}` : ''}</div>
                  <button className="orbit-chart-close" title={t('chart_remove')}
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
                  <div className="orbit-chart-tag">{extraCharts[1].label}{extraCharts[1].asset !== assetId ? ` · ${extraCharts[1].asset}` : ''}</div>
                  <button className="orbit-chart-close" title={t('chart_remove')}
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
                {[...new Set([...feed.map(e => eventSource(e)), 'nagios', 'wazuh', 'fortigate', 'n8n', 'otel', 'suricata', 'openclaw'])].sort().map(ns => {
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
                    {t('home_no_events')}
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
