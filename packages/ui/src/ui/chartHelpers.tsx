import React from 'react';
import { Chart } from 'chart.js';
import { apiGetHeaders, visibleInterval } from './shared';

export function HealthBadge() {
  const [health, setHealth] = React.useState<any>(null);

  React.useEffect(() => {
    function poll() {
      fetch('api/v1/health', { headers: apiGetHeaders() })
        .then((r) => r.json())
        .then(setHealth)
        .catch(() => setHealth(null));
    }
    poll();
    const stop = visibleInterval(poll, 30_000);
    return () => stop();
  }, []);

  const dbOk = health?.db === 'ok';
  const color = health ? (dbOk ? '#4ade80' : '#f87171') : '#94a3b8';
  const label = health ? (dbOk ? 'ok' : `db: ${health.db}`) : '…';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color, marginLeft: 'auto' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
      API {label}
      {health?.version && <span style={{ color: '#475569', marginLeft: 4 }}>v{health.version}</span>}
    </div>
  );
}

// ─── SHARED CHART HELPERS ────────────────────────────────────────────────────

export function glowGradient(ctx: CanvasRenderingContext2D, colorA: string, colorB: string) {
  const g = ctx.createLinearGradient(0, 0, 0, 320);
  g.addColorStop(0, colorA);
  g.addColorStop(1, colorB);
  return g;
}

export function makeNeLineChart(canvas: HTMLCanvasElement, datasetCount: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const colors = ['rgba(85,243,255,.95)','rgba(155,124,255,.95)','rgba(255,93,214,.85)','rgba(255,211,106,.90)'];

  const datasets = Array.from({ length: datasetCount }).map((_, i) => ({
    label: `s${i+1}`,
    data: [] as number[],
    borderColor: colors[i % colors.length],
    backgroundColor: i === 0 ? glowGradient(ctx,'rgba(85,243,255,.22)','rgba(85,243,255,0)') : 'rgba(0,0,0,0)',
    tension: 0.38,
    fill: i === 0,
    pointRadius: 0,
    borderWidth: 2,
  }));

  const chart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 450 },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          border: { display: false },
          grid: { color: 'rgba(140,160,255,.05)', drawTicks: false },
          ticks: {
            color: 'rgba(233,238,255,.50)',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 7,
            padding: 6,
            font: { size: 10, weight: 600 },
          },
        },
        y: {
          border: { display: false },
          grid: { color: 'rgba(140,160,255,.07)', drawTicks: false },
          ticks: {
            color: 'rgba(233,238,255,.50)',
            autoSkip: true,
            maxTicksLimit: 5,
            padding: 6,
            font: { size: 10, weight: 600 },
          },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: 'rgba(233,238,255,.72)',
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: 'rectRounded',
            padding: 14,
            font: { size: 10, weight: 700 },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(3,6,18,.92)',
          borderColor: 'rgba(140,160,255,.25)',
          borderWidth: 1,
          titleColor: 'rgba(233,238,255,.9)',
          bodyColor: 'rgba(233,238,255,.75)',
        },
      },
    },
    plugins: [{
      id: 'neGlow',
      beforeDatasetsDraw(c) {
        const { ctx } = c;
        ctx.save();
        ctx.shadowColor = 'rgba(85,243,255,.28)';
        ctx.shadowBlur = 18;
      },
      afterDatasetsDraw(c) {
        c.ctx.restore();
      },
    }]
  });

  return chart;
}
