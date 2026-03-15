import React from 'react';
import { t } from './i18n';
import { SEV_COLOR, SEV_BG, NS_COLOR, NS_BG, NAGIOS_STATE_COLOR, S, EventRow, fmtTs, eventSource, relativeFrom, isoToLocal } from './shared';

export function SevBadge({ sev }: { sev: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 99,
      fontSize: 11,
      fontWeight: 700,
      background: SEV_BG[sev] ?? '#1e293b',
      color: SEV_COLOR[sev] ?? '#e2e8f0',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    }}>
      {sev}
    </span>
  );
}

export function NsBadge({ ns }: { ns: string }) {
  const color = NS_COLOR[ns] ?? 'rgba(233,238,255,.55)';
  const bg    = NS_BG[ns]    ?? 'rgba(30,40,80,.5)';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 7px',
      borderRadius: 99,
      fontSize: 10,
      fontWeight: 700,
      background: bg,
      color,
      border: `1px solid ${color}40`,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      alignSelf: 'flex-start',
      marginTop: 1,
      whiteSpace: 'nowrap',
    }}>{ns}</span>
  );
}

export function FeedRow({ e }: { e: EventRow }) {
  const [open, setOpen] = React.useState(false);
  const src = eventSource(e);
  const expandable = (src === 'wazuh' || src === 'fortigate') && !!e.message;
  const devname = e.message?.match(/devname="([^"]+)"/)?.[1] ?? null;
  return (
    <div
      className="orbit-feed-row"
      onClick={() => expandable && setOpen(x => !x)}
      style={{ cursor: expandable ? 'pointer' : 'default' }}
    >
      <SevBadge sev={e.severity} />
      <NsBadge ns={src} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: 'block' }}>{e.title}</strong>
        {devname && !open && (
          <div style={{ fontSize: 12, color: 'rgba(160,180,255,.55)', marginTop: 3 }}>{devname}</div>
        )}
        {(!expandable || open) && e.message && (
          <div style={{
            fontSize: 12,
            color: 'rgba(233,238,255,.65)',
            marginTop: 4,
            lineHeight: 1.4,
            wordBreak: 'break-word',
            whiteSpace: expandable ? 'pre-wrap' : undefined,
          }}>{e.message}</div>
        )}
        <div style={{ fontSize: 11, color: 'rgba(233,238,255,.38)', marginTop: 5, display: 'flex', gap: 10 }}>
          <span>{fmtTs(e.ts)}</span>
          {expandable && (
            <span style={{ color: 'rgba(140,160,255,.5)' }}>{open ? t('events_close') : t('events_see_log')}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function StateBadge({ state }: { state: string }) {
  const color = NAGIOS_STATE_COLOR[state] ?? '#94a3b8';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 10px',
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 700,
      background: `${color}22`,
      color,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {state}
    </span>
  );
}

// ─── API Key Banner ───────────────────────────────────────────────────────────

export function ApiKeyBanner() {
  const [key, setKey] = React.useState(() => localStorage.getItem('orbit_api_key') ?? '');
  const [saved, setSaved] = React.useState(false);

  function save() {
    localStorage.setItem('orbit_api_key', key);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'center', padding: '10px 16px' }}>
      <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>API Key</span>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder="ORBIT_API_KEY (deixe vazio se sem auth)"
        style={{ ...S.input, flex: 1, fontSize: 12 }}
      />
      <button onClick={save} style={{ ...S.btnSm }}>
        {saved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  );
}

// ─── Time Range Picker ────────────────────────────────────────────────────────

export const RANGE_PRESETS = [
  { label: '1h',  h: 1,   tip: 'Última hora'    },
  { label: '6h',  h: 6,   tip: 'Últimas 6 horas' },
  { label: '24h', h: 24,  tip: 'Últimas 24 horas' },
  { label: '7d',  h: 168, tip: 'Últimos 7 dias'  },
  { label: '30d', h: 720, tip: 'Últimos 30 dias'  },
];

export function TimeRangePicker({
  from, to, setFrom, setTo, bucketSec, setBucketSec,
}: {
  from: string; to: string;
  setFrom: (s: string) => void; setTo: (s: string) => void;
  bucketSec?: number; setBucketSec?: (n: number) => void;
}) {
  const [activeH, setActiveH] = React.useState<number | null>(24);

  function applyPreset(h: number) {
    setFrom(relativeFrom(h));
    setTo(new Date().toISOString());
    setActiveH(h);
  }

  const dtInput: React.CSSProperties = {
    background: 'rgba(4,7,19,0.65)',
    border: '1px solid rgba(140,160,255,0.22)',
    borderRadius: 10,
    color: '#e9eeff',
    padding: '5px 9px',
    fontSize: 12,
    outline: 'none',
    colorScheme: 'dark' as any,
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* Preset pills */}
      <span style={{ fontSize: 10, color: 'rgba(233,238,255,0.38)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        período
      </span>
      {RANGE_PRESETS.map(({ label, h, tip }) => {
        const active = activeH === h;
        return (
          <button
            key={h}
            title={tip}
            onClick={() => applyPreset(h)}
            style={{
              background: active
                ? 'linear-gradient(135deg, rgba(85,243,255,0.20) 0%, rgba(155,124,255,0.20) 100%)'
                : 'rgba(255,255,255,0.04)',
              border: active
                ? '1px solid rgba(85,243,255,0.48)'
                : '1px solid rgba(140,160,255,0.15)',
              borderRadius: 20,
              color: active ? '#55f3ff' : 'rgba(233,238,255,0.58)',
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: active ? 700 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s',
              boxShadow: active ? '0 0 10px rgba(85,243,255,0.16)' : 'none',
              letterSpacing: active ? '0.03em' : 'normal',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        );
      })}

      {/* Divider */}
      <div style={{ width: 1, height: 18, background: 'rgba(140,160,255,0.14)', margin: '0 2px', flexShrink: 0 }} />

      {/* Custom date inputs */}
      <input
        type="datetime-local"
        value={isoToLocal(from)}
        onChange={e => { if (e.target.value) { setFrom(new Date(e.target.value).toISOString()); setActiveH(null); } }}
        style={dtInput}
      />
      <span style={{ color: 'rgba(233,238,255,0.28)', fontSize: 14, flexShrink: 0 }}>→</span>
      <input
        type="datetime-local"
        value={isoToLocal(to)}
        onChange={e => { if (e.target.value) { setTo(new Date(e.target.value).toISOString()); setActiveH(null); } }}
        style={dtInput}
      />
      <button
        onClick={() => setTo(new Date().toISOString())}
        title="Definir 'até' para agora"
        style={{
          background: 'rgba(155,124,255,0.10)',
          border: '1px solid rgba(155,124,255,0.26)',
          borderRadius: 8,
          color: 'rgba(155,124,255,0.82)',
          padding: '4px 9px',
          fontSize: 11,
          cursor: 'pointer',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
        }}
      >
        ↻ agora
      </button>

      {/* Optional bucket selector */}
      {setBucketSec && bucketSec !== undefined && (
        <>
          <div style={{ width: 1, height: 18, background: 'rgba(140,160,255,0.14)', margin: '0 2px', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'rgba(233,238,255,0.38)', whiteSpace: 'nowrap' }}>bucket</span>
          <input
            type="number"
            value={bucketSec}
            min={10}
            onChange={e => setBucketSec(Number(e.target.value))}
            style={{ ...dtInput, width: 58, padding: '4px 6px', fontSize: 11 }}
          />
          <span style={{ fontSize: 11, color: 'rgba(233,238,255,0.28)' }}>s</span>
        </>
      )}
    </div>
  );
}
