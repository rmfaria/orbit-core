import React from 'react';
import { t } from '../i18n';
import { S, Row, MultiRow, AssetOpt, MetricOpt, apiHeaders, apiGetHeaders, relativeFrom } from '../shared';
import { drawChart, drawMultiChart } from '../canvas';
import { TimeRangePicker } from '../components';

export function MetricsTab({ assets }: { assets: AssetOpt[] }) {
  const [assetId, setAssetId]       = React.useState(assets[0]?.asset_id ?? '');
  const [namespace, setNamespace]   = React.useState('');
  const [metric, setMetric]         = React.useState('');
  const [metric2, setMetric2]       = React.useState('');  // optional second metric for comparison
  const [service, setService]       = React.useState('');
  const [metricOpts, setMetricOpts] = React.useState<MetricOpt[]>([]);
  const [serviceOpts, setServiceOpts] = React.useState<string[]>([]);
  const [bucketSec, setBucketSec]   = React.useState(300);
  const [from, setFrom]             = React.useState(() => relativeFrom(24));
  const [to, setTo]                 = React.useState(() => new Date().toISOString());
  const [rows, setRows]             = React.useState<Row[]>([]);
  const [multiRows, setMultiRows]   = React.useState<MultiRow[]>([]);
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

  // Draw chart whenever data changes; setupCanvas handles DPR + sizing internally
  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (multiRows.length > 0) drawMultiChart(c, multiRows);
    else drawChart(c, rows);
  }, [rows, multiRows]);

  async function run() {
    if (!assetId || !namespace || !metric) { setErr(t('metrics_no_asset')); return; }
    setLoading(true); setErr(null);
    try {
      if (metric2) {
        // Multi-series: compare two metrics on the same chart
        const body: any = {
          query: {
            kind: 'timeseries_multi',
            from, to,
            bucket_sec: bucketSec,
            series: [
              { asset_id: assetId, namespace, metric, label: metric, ...(service ? { dimensions: { service } } : {}) },
              { asset_id: assetId, namespace, metric: metric2, label: metric2 },
            ]
          }
        };
        const r = await fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
        setMultiRows((j?.result?.rows ?? []).map((x: any) => ({ ts: x.ts, series: x.series, value: Number(x.value) })));
        setRows([]);
      } else {
        // Single metric
        const body: any = {
          query: {
            kind: 'timeseries',
            asset_id: assetId, namespace, metric, from, to,
            bucket_sec: bucketSec,
            ...(service ? { dimensions: { service } } : {})
          }
        };
        const r = await fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
        setRows((j?.result?.rows ?? []).map((x: any) => ({ ts: x.ts, value: Number(x.value) })));
        setMultiRows([]);
      }
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Auto-run when asset/namespace/metric/from/to change
  React.useEffect(() => {
    if (assetId && namespace && metric) run();
  }, [assetId, namespace, metric, metric2, from, to]);

  const namespaces = Array.from(new Set(metricOpts.map((m) => m.namespace)));
  const filteredMetrics = metricOpts.filter((m) => !namespace || m.namespace === namespace);

  return (
    <div>
      <div style={S.card}>
        <div className="orbit-grid-4" style={{ marginBottom: 10 }}>
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
            Compare with
            <select style={S.select} value={metric2} onChange={(e) => setMetric2(e.target.value)}>
              <option value="">— none —</option>
              {filteredMetrics.filter(m => m.metric !== metric).map((m) => (
                <option key={`cmp:${m.metric}`} value={m.metric}>{m.metric}</option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ marginBottom: 10 }}>
          <TimeRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} bucketSec={bucketSec} setBucketSec={setBucketSec} />
        </div>
        <div style={S.row}>
          <button style={S.btn} onClick={run} disabled={loading}>{loading ? 'Running…' : 'Run query'}</button>
          <span style={{ color: '#64748b', fontSize: 12 }}>{metric2 ? multiRows.length : rows.length} pontos</span>
        </div>
        {err && <div style={S.err}>{err}</div>}
      </div>

      <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 280 }} />
      </div>

      {(rows.length > 0 || multiRows.length > 0) && (
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
