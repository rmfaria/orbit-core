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

// ── Sales Scripts ────────────────────────────────────────────────────────────

type Channel = 'whatsapp' | 'email';

const SALES_SCRIPTS = [
  {
    id: 'first-contact',
    name: 'First Contact',
    icon: '👋',
    channels: ['whatsapp', 'email'] as Channel[],
    subject: 'Orbit Core — Security Observability for your team',
    body: `Hi {{name}},

I noticed {{company}} is growing fast and wanted to reach out.

Orbit Core is a self-hosted observability platform that unifies security alerts (Wazuh, Nagios, Suricata) with infrastructure metrics — all in one dashboard.

Key benefits:
• Real-time EPS monitoring across all sources
• Threat intelligence with MISP integration
• AI-powered correlation engine
• 100% self-hosted — your data never leaves your server

Would you be open to a 15-minute demo this week?

Best regards`,
  },
  {
    id: 'follow-up',
    name: 'Follow-up',
    icon: '🔄',
    channels: ['whatsapp', 'email'] as Channel[],
    subject: 'Re: Orbit Core — Quick follow-up',
    body: `Hi {{name}},

Just following up on my previous message about Orbit Core.

We recently shipped the Security Health Map — a hex-grid visualization showing per-asset security posture at a glance, with 65x faster queries.

Happy to schedule a quick call whenever works for you.

Best regards`,
  },
  {
    id: 'proposal',
    name: 'Proposal',
    icon: '📋',
    channels: ['email'] as Channel[],
    subject: 'Orbit Core — Commercial Proposal for {{company}}',
    body: `Hi {{name}},

Following our conversation, here is the commercial proposal for {{company}}.

Plan: Orbit Core Enterprise
• Unlimited assets and sources
• Priority support (SLA 4h)
• Custom connector development
• On-site deployment assistance

Investment: R$ {{value}}/month
Contract: 12 months

The platform is Apache-2.0 licensed — you own the code forever. The subscription covers support, updates, and custom development.

Looking forward to your feedback.

Best regards`,
  },
  {
    id: 'demo-invite',
    name: 'Demo Invite',
    icon: '🎬',
    channels: ['whatsapp', 'email'] as Channel[],
    subject: 'Orbit Core — Live Demo',
    body: `Hi {{name}},

I'd love to show you Orbit Core in action.

In 15 minutes, I'll walk you through:
• Unified event feed (Wazuh + Nagios + Suricata)
• Real-time EPS monitoring
• Threat Intelligence dashboard with MISP
• AI-powered smart dashboards

When works best for you?

Best regards`,
  },
  {
    id: 'closing',
    name: 'Closing',
    icon: '🤝',
    channels: ['whatsapp', 'email'] as Channel[],
    subject: 'Orbit Core — Ready to start?',
    body: `Hi {{name}},

Great news — everything is set for {{company}} to get started with Orbit Core.

Next steps:
1. Sign the contract (attached)
2. We deploy on your infrastructure (same day)
3. Connect your first sources (Wazuh, Nagios)
4. Training session for your team

Shall I send the contract over?

Best regards`,
  },
  {
    id: 'win-back',
    name: 'Win Back',
    icon: '💡',
    channels: ['whatsapp', 'email'] as Channel[],
    subject: 'Orbit Core — New features since we last talked',
    body: `Hi {{name}},

It's been a while since we last connected, and Orbit Core has evolved a lot:

• Security Health Map with hex-grid visualization
• MISP threat intelligence integration
• AI-generated dashboards
• OpenClaw sales pipeline tracking
• 65x faster queries

Would you like to take another look? Happy to do a quick 10-min update call.

Best regards`,
  },
];

function SendModal({ onClose, accounts }: { onClose: () => void; accounts: string[] }) {
  const [selectedScript, setSelectedScript] = React.useState(SALES_SCRIPTS[0].id);
  const [channel, setChannel] = React.useState<Channel>('whatsapp');
  const [recipientName, setRecipientName] = React.useState('');
  const [recipientContact, setRecipientContact] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [dealValue, setDealValue] = React.useState('');
  const [copied, setCopied] = React.useState(false);

  const script = SALES_SCRIPTS.find(s => s.id === selectedScript) ?? SALES_SCRIPTS[0];

  // Replace placeholders
  const filledBody = script.body
    .replace(/\{\{name\}\}/g, recipientName || '[Name]')
    .replace(/\{\{company\}\}/g, company || '[Company]')
    .replace(/\{\{value\}\}/g, dealValue || '[Value]');

  const filledSubject = script.subject
    .replace(/\{\{company\}\}/g, company || '[Company]');

  function handleSend() {
    if (channel === 'whatsapp') {
      const phone = recipientContact.replace(/\D/g, '');
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(filledBody)}`;
      window.open(url, '_blank');
    } else {
      const url = `mailto:${recipientContact}?subject=${encodeURIComponent(filledSubject)}&body=${encodeURIComponent(filledBody)}`;
      window.open(url, '_blank');
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(filledBody).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.70)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'linear-gradient(135deg, rgba(20,10,30,0.97), rgba(12,18,40,0.97))',
        border: '1px solid rgba(255,93,214,0.20)',
        borderRadius: 20, padding: 28, width: 720, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(255,93,214,0.08)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>📨</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: '#e9eeff' }}>Send Sales Script</span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'rgba(233,238,255,0.5)',
            fontSize: 22, cursor: 'pointer', padding: '0 4px', lineHeight: 1,
          }}>&times;</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* Left: Script selection + fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Script selector */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(233,238,255,0.45)', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 8 }}>Sales Script</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {SALES_SCRIPTS.map(s => (
                  <button key={s.id} onClick={() => setSelectedScript(s.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                    background: selectedScript === s.id ? 'rgba(255,93,214,0.12)' : 'rgba(3,6,18,0.5)',
                    border: selectedScript === s.id ? '1px solid rgba(255,93,214,0.35)' : '1px solid rgba(140,160,255,0.10)',
                    color: selectedScript === s.id ? '#ff5dd6' : 'rgba(233,238,255,0.7)',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}>
                    <span style={{ fontSize: 16 }}>{s.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      {s.channels.includes('whatsapp') && <span style={{ fontSize: 10, opacity: 0.5 }}>WA</span>}
                      {s.channels.includes('email') && <span style={{ fontSize: 10, opacity: 0.5 }}>Email</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Channel */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(233,238,255,0.45)', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 6 }}>Channel</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['whatsapp', 'email'] as const).filter(ch => script.channels.includes(ch)).map(ch => (
                  <button key={ch} onClick={() => setChannel(ch)} style={{
                    flex: 1, padding: '8px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                    background: channel === ch ? (ch === 'whatsapp' ? 'rgba(74,222,128,0.15)' : 'rgba(85,243,255,0.12)') : 'rgba(3,6,18,0.4)',
                    border: channel === ch ? `1px solid ${ch === 'whatsapp' ? 'rgba(74,222,128,0.4)' : 'rgba(85,243,255,0.35)'}` : '1px solid rgba(140,160,255,0.10)',
                    color: channel === ch ? (ch === 'whatsapp' ? '#4ade80' : '#55f3ff') : 'rgba(233,238,255,0.5)',
                  }}>
                    {ch === 'whatsapp' ? '📱 WhatsApp' : '✉️ Email'}
                  </button>
                ))}
              </div>
            </div>

            {/* Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(233,238,255,0.45)', marginBottom: 4 }}>Recipient Name</div>
                <input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="John Silva" style={S.input} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(233,238,255,0.45)', marginBottom: 4 }}>
                  {channel === 'whatsapp' ? 'Phone (with country code)' : 'Email'}
                </div>
                <input value={recipientContact} onChange={e => setRecipientContact(e.target.value)}
                  placeholder={channel === 'whatsapp' ? '+5511999999999' : 'john@company.com'} style={S.input} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(233,238,255,0.45)', marginBottom: 4 }}>Company</div>
                <select value={company} onChange={e => setCompany(e.target.value)} style={S.select}>
                  <option value="">Select account...</option>
                  {accounts.map(a => <option key={a} value={a}>{a}</option>)}
                  <option value="__custom">Other...</option>
                </select>
                {company === '__custom' && (
                  <input value="" onChange={e => setCompany(e.target.value)} placeholder="Company name" style={{ ...S.input, marginTop: 6 }} />
                )}
              </div>
              {script.body.includes('{{value}}') && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(233,238,255,0.45)', marginBottom: 4 }}>Deal Value (R$)</div>
                  <input value={dealValue} onChange={e => setDealValue(e.target.value)} placeholder="25,000" style={S.input} />
                </div>
              )}
            </div>
          </div>

          {/* Right: Preview */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(233,238,255,0.45)', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 8 }}>Preview</div>
            {channel === 'email' && (
              <div style={{
                background: 'rgba(3,6,18,0.5)', border: '1px solid rgba(140,160,255,0.10)',
                borderRadius: 10, padding: '8px 12px', marginBottom: 8,
                fontSize: 12, color: 'rgba(233,238,255,0.6)',
              }}>
                <strong style={{ color: 'rgba(233,238,255,0.35)', fontSize: 10 }}>Subject:</strong> {filledSubject}
              </div>
            )}
            <div style={{
              flex: 1, background: 'rgba(3,6,18,0.5)', border: '1px solid rgba(140,160,255,0.10)',
              borderRadius: 12, padding: 14,
              fontSize: 12, color: 'rgba(233,238,255,0.75)', lineHeight: 1.6,
              whiteSpace: 'pre-wrap', overflowY: 'auto', maxHeight: 340,
              fontFamily: 'system-ui, sans-serif',
            }}>
              {filledBody}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={handleCopy} style={{
                ...S.btnSm,
                flex: 1,
                background: copied ? 'rgba(74,222,128,0.15)' : 'rgba(4,7,19,0.35)',
                color: copied ? '#4ade80' : '#e9eeff',
                border: copied ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(140,160,255,0.20)',
              }}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button onClick={handleSend} disabled={!recipientContact} style={{
                flex: 2, padding: '10px 16px', borderRadius: 12, cursor: recipientContact ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 800,
                background: recipientContact
                  ? (channel === 'whatsapp' ? 'linear-gradient(135deg, rgba(74,222,128,0.25), rgba(74,222,128,0.15))' : 'linear-gradient(135deg, rgba(85,243,255,0.22), rgba(155,124,255,0.22))')
                  : 'rgba(30,40,60,0.5)',
                border: recipientContact
                  ? `1px solid ${channel === 'whatsapp' ? 'rgba(74,222,128,0.40)' : 'rgba(85,243,255,0.30)'}`
                  : '1px solid rgba(140,160,255,0.10)',
                color: recipientContact ? '#e9eeff' : 'rgba(233,238,255,0.3)',
                opacity: recipientContact ? 1 : 0.6,
              }}>
                {channel === 'whatsapp' ? '📱 Open WhatsApp' : '✉️ Open Email'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export function OpenClawTab({ assets }: { assets: AssetOpt[] }) {
  const isMobile = useIsMobile();
  const [metrics, setMetrics] = React.useState<MetricSeries[]>([]);
  const [events, setEvents] = React.useState<EventRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [pipeline, setPipeline] = React.useState<Record<string, number>>({});

  const [sendOpen, setSendOpen] = React.useState(false);

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
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: 'rgba(233,238,255,0.35)' }}>auto-refresh 60s</span>
          <button onClick={() => setSendOpen(true)} style={{
            background: 'linear-gradient(135deg, rgba(255,93,214,0.22), rgba(155,124,255,0.18))',
            border: '1px solid rgba(255,93,214,0.35)',
            borderRadius: 12, padding: '8px 18px', cursor: 'pointer',
            fontSize: 13, fontWeight: 800, color: '#e9eeff',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span>📨</span> Send
          </button>
        </div>
      </div>

      {/* Send Modal */}
      {sendOpen && (
        <SendModal
          onClose={() => setSendOpen(false)}
          accounts={[...new Set(events.map(e => e.asset_id))].sort()}
        />
      )}

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
