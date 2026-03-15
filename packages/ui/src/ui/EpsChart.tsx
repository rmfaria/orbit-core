/**
 * orbit-core — EPS Chart component (shared across tabs)
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Chart } from 'chart.js';
import { t } from './i18n';
import { S, Row, apiHeaders } from './shared';
import { makeNeLineChart } from './chartHelpers';

export function EpsChart({ namespace, from, to, variant = 'card', onClose }: { namespace: string; from: string; to: string; variant?: 'card' | 'chart-box'; onClose?: () => void }) {
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
          <button className="orbit-chart-close" onClick={onClose} title={t('chart_remove')}>×</button>
        )}
        <div className="orbit-chart-canvas-wrap">
          {/* canvas always in DOM so Chart.js can attach on mount */}
          <canvas ref={canvasRef} style={{ display: isEmpty ? 'none' : 'block' }} />
          {isEmpty && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12 }}>
              {t('events_no_data')}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...S.card, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>EPS — Events per second</span>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>bucket: {bucketLabel}{loading ? t('events_loading') : ''}</span>
      </div>
      <div style={{ position: 'relative', height: 160 }}>
        <canvas ref={canvasRef} style={{ display: isEmpty ? 'none' : 'block', width: '100%', height: '100%' }} />
        {isEmpty && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', color: '#64748b', fontSize: 12 }}>
            {t('events_no_data')}
          </div>
        )}
      </div>
    </div>
  );
}
