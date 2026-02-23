import React from 'react';

type Row = { ts: string; value: number };

function drawChart(canvas: HTMLCanvasElement, rows: Row[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, w, h);

  // padding
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 28;

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + ((h - padT - padB) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
  }

  if (!rows.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '14px system-ui';
    ctx.fillText('No data', padL, padT + 18);
    return;
  }

  const vals = rows.map((r) => r.value);
  let vmin = Math.min(...vals);
  let vmax = Math.max(...vals);
  if (vmin === vmax) {
    vmin -= 1;
    vmax += 1;
  }

  const x0 = padL;
  const x1 = w - padR;
  const y0 = padT;
  const y1 = h - padB;

  const toX = (i: number) => x0 + ((x1 - x0) * i) / Math.max(1, rows.length - 1);
  const toY = (v: number) => y1 - ((y1 - y0) * (v - vmin)) / (vmax - vmin);

  // line
  ctx.strokeStyle = 'rgba(99, 179, 237, 0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  rows.forEach((r, i) => {
    const x = toX(i);
    const y = toY(r.value);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // y labels
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '12px system-ui';
  ctx.fillText(vmax.toFixed(2), 8, y0 + 10);
  ctx.fillText(vmin.toFixed(2), 8, y1);

  // x labels (first/last)
  const t0 = new Date(rows[0].ts);
  const t1 = new Date(rows[rows.length - 1].ts);
  const fmt = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  ctx.fillText(fmt(t0), x0, h - 10);
  ctx.fillText(fmt(t1), x1 - 40, h - 10);
}

export function App() {
  const [health, setHealth] = React.useState<any>(null);
  const [healthError, setHealthError] = React.useState<string | null>(null);

  const [assetId, setAssetId] = React.useState('');
  const [namespace, setNamespace] = React.useState('');
  const [metric, setMetric] = React.useState('');

  const [assetOptions, setAssetOptions] = React.useState<Array<{ asset_id: string; name: string }>>([]);
  const [metricOptions, setMetricOptions] = React.useState<Array<{ namespace: string; metric: string; last_ts?: string }>>([]);
  const [bucketSec, setBucketSec] = React.useState(60);

  const [from, setFrom] = React.useState(() => new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString());
  const [to, setTo] = React.useState(() => new Date().toISOString());

  const [rows, setRows] = React.useState<Row[]>([]);
  const [queryError, setQueryError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    fetch('api/v1/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setHealthError(String(e)));

    // load initial catalog (assets)
    fetch('api/v1/catalog/assets?limit=200')
      .then((r) => r.json())
      .then((j) => {
        const assets = (j?.assets ?? []) as Array<any>;
        const opts = assets.map((a) => ({ asset_id: a.asset_id, name: a.name ?? a.asset_id }));
        setAssetOptions(opts);
        if (!assetId && opts.length) setAssetId(opts[0].asset_id);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  React.useEffect(() => {
    if (!assetId) return;
    fetch(`api/v1/catalog/metrics?asset_id=${encodeURIComponent(assetId)}&limit=500`)
      .then((r) => r.json())
      .then((j) => {
        const ms = (j?.metrics ?? []) as Array<any>;
        setMetricOptions(ms);
        if (!namespace && ms.length) setNamespace(ms[0].namespace);
        if (!metric && ms.length) setMetric(ms[0].metric);
      })
      .catch(() => {
        setMetricOptions([]);
      });
  }, [assetId]);

  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    // ensure crisp on high-DPI
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const cssW = 920;
    const cssH = 320;
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    c.width = cssW * dpr;
    c.height = cssH * dpr;
    const ctx = c.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawChart(c, rows);
  }, [rows]);

  async function runQuery() {
    if (!assetId || !namespace || !metric) {
      setQueryError('Selecione asset/namespace/metric');
      return;
    }

    setLoading(true);
    setQueryError(null);
    try {
      const body = {
        language: 'orbitql',
        query: {
          kind: 'timeseries',
          asset_id: assetId,
          namespace,
          metric,
          from,
          to,
          bucket_sec: bucketSec
        }
      };
      const r = await fetch('api/v1/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      const out: Row[] = (j?.result?.rows ?? []).map((x: any) => ({
        ts: x.ts,
        value: Number(x.value)
      }));
      setRows(out);
    } catch (e: any) {
      setQueryError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <h1>Orbit UI</h1>
      <p>
        Query runner (MVP). Endpoint: <code>/api/v1/query</code> • Doc PDF:{' '}
        <a href="docs/orbit-core-architecture.pdf" target="_blank" rel="noreferrer">
          orbit-core-architecture.pdf
        </a>
      </p>

      <h2>Health</h2>
      {healthError ? <pre>{healthError}</pre> : <pre>{JSON.stringify(health, null, 2)}</pre>}

      <h2>Timeseries</h2>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr 160px' }}>
        <label>
          Asset
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)} style={{ width: '100%' }}>
            {assetOptions.map((a) => (
              <option key={a.asset_id} value={a.asset_id}>
                {a.asset_id} — {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Namespace
          <select value={namespace} onChange={(e) => setNamespace(e.target.value)} style={{ width: '100%' }}>
            {Array.from(new Set(metricOptions.map((m) => m.namespace))).map((ns) => (
              <option key={ns} value={ns}>
                {ns}
              </option>
            ))}
          </select>
        </label>
        <label>
          Metric
          <select value={metric} onChange={(e) => setMetric(e.target.value)} style={{ width: '100%' }}>
            {metricOptions
              .filter((m) => (namespace ? m.namespace === namespace : true))
              .map((m) => (
                <option key={`${m.namespace}:${m.metric}`} value={m.metric}>
                  {m.metric}
                </option>
              ))}
          </select>
        </label>
        <label>
          Bucket (sec)
          <input
            type="number"
            value={bucketSec}
            onChange={(e) => setBucketSec(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </label>
        <label style={{ gridColumn: '1 / span 2' }}>
          From (ISO)
          <input value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label style={{ gridColumn: '3 / span 2' }}>
          To (ISO)
          <input value={to} onChange={(e) => setTo(e.target.value)} style={{ width: '100%' }} />
        </label>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={runQuery} disabled={loading}>
          {loading ? 'Running…' : 'Run query'}
        </button>
        <span style={{ color: 'rgba(0,0,0,0.65)' }}>{rows.length} points</span>
      </div>

      {queryError ? <pre style={{ color: 'crimson' }}>{queryError}</pre> : null}

      <div style={{ marginTop: 12, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)' }}>
        <canvas ref={canvasRef} />
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>Raw rows</summary>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(rows.slice(0, 200), null, 2)}</pre>
      </details>
    </div>
  );
}
