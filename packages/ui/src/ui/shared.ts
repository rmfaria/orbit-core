/**
 * orbit-core — Shared types, constants, and helpers for UI components
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { t } from './i18n';

// ─── types ────────────────────────────────────────────────────────────────────

export type Row        = { ts: string; value: number };
export type MultiRow   = { ts: string; series: string; value: number };
export type EventRow   = { ts: string; asset_id: string; namespace: string; kind: string; severity: string; title: string; message: string };
export type AssetOpt   = { asset_id: string; name: string };
export type MetricOpt  = { namespace: string; metric: string; last_ts?: string };
export type Tab        = 'home' | 'system' | 'dashboards' | 'ai-designer' | 'src-nagios' | 'src-wazuh' | 'src-fortigate' | 'src-n8n' | 'src-otel' | 'src-suricata' | 'events' | 'metrics' | 'correlations' | 'threat-intel' | 'alerts' | 'connectors' | 'admin';

export type CorrelationRow = {
  event_key:    string;
  event_ts:     string;
  asset_id:     string;
  metric_ns:    string;
  metric:       string;
  baseline_avg: number | null;
  baseline_std: number | null;
  peak_value:   number | null;
  z_score:      number | null;
  rel_change:   number | null;
  detected_at:  string;
};

// ─── constants ────────────────────────────────────────────────────────────────

export const SEV_COLOR: Record<string, string> = {
  critical: '#f87171',
  high:     '#fb923c',
  medium:   '#fbbf24',
  low:      '#a3e635',
  info:     '#60a5fa',
};

export const SEV_BG: Record<string, string> = {
  critical: '#450a0a',
  high:     '#431407',
  medium:   '#451a03',
  low:      '#1a2e05',
  info:     '#172554',
};

export const NS_COLOR: Record<string, string> = {
  nagios:    '#38bdf8',
  wazuh:     '#a78bfa',
  fortigate: '#fb923c',
  n8n:       '#4ade80',
  otel:      '#f59e0b',
  suricata:  '#f87171',
};
export const NS_BG: Record<string, string> = {
  nagios:    '#0c1a3a',
  wazuh:     '#1e1040',
  fortigate: '#431407',
  n8n:       '#052e16',
  otel:      '#1c1408',
  suricata:  '#3b1010',
};

export const NAGIOS_STATE_COLOR: Record<string, string> = {
  OK:           '#4ade80',
  UP:           '#4ade80',
  WARNING:      '#fbbf24',
  CRITICAL:     '#f87171',
  DOWN:         '#f87171',
  UNKNOWN:      '#94a3b8',
  UNREACHABLE:  '#c084fc',
};

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Maps a raw event to its display/filter source. */
export function eventSource(e: { namespace: string; kind: string }): string {
  if (e.namespace === 'wazuh' && e.kind === 'fortigate') return 'fortigate';
  return e.namespace;
}

export function fmtTs(ts: string) {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

export function relativeFrom(hours: number) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

export function isoToLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function apiHeaders(): HeadersInit {
  const key = localStorage.getItem('orbit_api_key') ?? '';
  const h: HeadersInit = { 'content-type': 'application/json' };
  if (key) (h as Record<string, string>)['x-api-key'] = key;
  return h;
}

export function apiGetHeaders(): HeadersInit {
  const key = localStorage.getItem('orbit_api_key') ?? '';
  if (!key) return {};
  return { 'x-api-key': key };
}

export function useIsMobile(): boolean {
  const [mobile, setMobile] = React.useState(() => window.innerWidth < 768);
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const fn = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setMobile(window.innerWidth < 768), 150);
    };
    window.addEventListener('resize', fn, { passive: true });
    return () => { clearTimeout(timer); window.removeEventListener('resize', fn); };
  }, []);
  return mobile;
}

/** setInterval that pauses when the browser tab is hidden. Returns a cleanup function. */
export function visibleInterval(fn: () => void, ms: number): () => void {
  let id: ReturnType<typeof setInterval> | null = null;
  function start() { if (!id) id = setInterval(fn, ms); }
  function stop() { if (id) { clearInterval(id); id = null; } }
  function onVis() { document.hidden ? stop() : start(); }
  if (!document.hidden) start();
  document.addEventListener('visibilitychange', onVis);
  return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
}

// ─── styles (inline, no deps) ─────────────────────────────────────────────────

export const S = {
  root: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    minHeight: '100vh',
    color: '#e9eeff',
    display: 'flex',
    flexDirection: 'column' as const,
    background:
      'radial-gradient(1000px 640px at 18% 10%, rgba(85,243,255,0.10), transparent 55%),' +
      'radial-gradient(900px 560px at 82% 78%, rgba(155,124,255,0.11), transparent 58%),' +
      'linear-gradient(180deg, #040713, #0b1220)',
  } as React.CSSProperties,
  topbar: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
    background: 'rgba(4,7,19,0.92)',
    borderBottom: '1px solid rgba(140,160,255,0.14)',
    backdropFilter: 'blur(12px)',
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    padding: '0 20px',
    height: 50,
    flexShrink: 0,
  } as React.CSSProperties,
  card: {
    background: 'rgba(12,18,40,0.62)',
    border: '1px solid rgba(140,160,255,0.18)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    boxShadow: '0 18px 55px rgba(0,0,0,0.35)',
  } as React.CSSProperties,
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'rgba(233,238,255,0.70)' } as React.CSSProperties,
  select: {
    background: 'rgba(4,7,19,0.55)',
    border: '1px solid rgba(140,160,255,0.22)',
    borderRadius: 12,
    color: '#e9eeff',
    padding: '7px 10px',
    fontSize: 13,
    outline: 'none',
  } as React.CSSProperties,
  input: {
    background: 'rgba(4,7,19,0.55)',
    border: '1px solid rgba(140,160,255,0.22)',
    borderRadius: 12,
    color: '#e9eeff',
    padding: '7px 10px',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
  } as React.CSSProperties,
  btn: {
    background: 'linear-gradient(135deg, rgba(85,243,255,0.22), rgba(155,124,255,0.22))',
    color: '#e9eeff',
    border: '1px solid rgba(85,243,255,0.30)',
    borderRadius: 12,
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 800,
  } as React.CSSProperties,
  btnSm: {
    background: 'rgba(4,7,19,0.35)',
    color: '#e9eeff',
    border: '1px solid rgba(140,160,255,0.20)',
    borderRadius: 12,
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
  } as React.CSSProperties,
  grid4: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(4, 1fr)' } as React.CSSProperties,
  grid3: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, 1fr)' } as React.CSSProperties,
  grid2: { display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' } as React.CSSProperties,
  row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const } as React.CSSProperties,
  err: { color: '#fca5a5', fontSize: 13, marginTop: 6 } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 } as React.CSSProperties,
  th: {
    textAlign: 'left' as const,
    padding: '10px 10px',
    borderBottom: '1px solid rgba(140,160,255,0.18)',
    color: 'rgba(233,238,255,0.65)',
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  } as React.CSSProperties,
  td: { padding: '10px 10px', borderBottom: '1px solid rgba(140,160,255,0.10)' } as React.CSSProperties,
};
