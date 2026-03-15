import React from 'react';
import { Chart } from 'chart.js';
import { t } from '../i18n';
import { S, AssetOpt, EventRow, apiHeaders, apiGetHeaders, relativeFrom } from '../shared';
import { SevBadge, TimeRangePicker } from '../components';
import { EpsChart } from '../EpsChart';

const SEVERITY_OPTS = ['', 'critical', 'high', 'medium', 'low', 'info'];

export function EventsTab({ assets, defaultNs }: { assets: AssetOpt[]; defaultNs?: string }) {
  const [assetId, setAssetId]     = React.useState('');
  const [namespace, setNamespace] = React.useState(defaultNs ?? '');
  const [severity, setSeverity]   = React.useState('');
  const [from, setFrom]           = React.useState(() => relativeFrom(24));
  const [to, setTo]               = React.useState(() => new Date().toISOString());
  const [events, setEvents]       = React.useState<EventRow[]>([]);
  const [loading, setLoading]     = React.useState(false);
  const [err, setErr]             = React.useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = React.useState<number | null>(null);

  async function run() {
    setLoading(true); setErr(null); setExpandedIdx(null);
    try {
      const q: any = { kind: 'events', from, to, limit: 500 };
      if (assetId)   q.asset_id   = assetId;
      if (namespace) q.namespace  = namespace;
      if (severity)  q.severities = [severity];
      const r = await fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ query: q }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setEvents(j?.result?.rows ?? []);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Short timestamp: HH:MM:SS if today, MM/DD HH:MM otherwise
  function tsShort(ts: string) {
    const d = new Date(ts);
    const now = new Date();
    const hm  = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const sec = String(d.getSeconds()).padStart(2,'0');
    if (d.toDateString() === now.toDateString()) return `${hm}:${sec}`;
    return `${d.getMonth()+1}/${d.getDate()} ${hm}`;
  }

  // Auto-run on mount
  React.useEffect(() => { run(); }, []);

  return (
    <div>
      {defaultNs === 'wazuh' && (
        <EpsChart namespace="wazuh" from={from} to={to} />
      )}
      <div style={S.card}>
        <div className="orbit-grid-4" style={{ marginBottom: 10 }}>
          <label style={S.label}>
            Asset
            <select style={S.select} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">{t('all')}</option>
              {assets.map((a) => <option key={a.asset_id} value={a.asset_id}>{a.asset_id}</option>)}
            </select>
          </label>
          <label style={S.label}>
            Namespace
            <select style={S.select} value={namespace} onChange={(e) => setNamespace(e.target.value)}>
              <option value="">{t('all')}</option>
              <option value="nagios">nagios</option>
              <option value="wazuh">wazuh</option>
              <option value="n8n">n8n</option>
              <option value="otel">otel</option>
            </select>
          </label>
          <label style={S.label}>
            Severity
            <select style={S.select} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {SEVERITY_OPTS.map((s) => <option key={s} value={s}>{s || t('all')}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{t('actions')}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 2 }}>
              <button style={S.btn} onClick={run} disabled={loading}>{loading ? '…' : t('search')}</button>
              <span style={{ color: '#64748b', fontSize: 12 }}>{events.length} events</span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <TimeRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
        </div>
        {err && <div style={S.err}>{err}</div>}
      </div>

      {/* Table — sticky header, expandable rows, fills remaining viewport height */}
      <div style={{ ...S.card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 370px)', minHeight: 240 }}>
        <table style={{ ...S.table, tableLayout: 'fixed', minWidth: 580 }}>
          <colgroup>
            <col style={{ width: 88 }} />  {/* timestamp */}
            <col style={{ width: 76 }} />  {/* severity  */}
            <col style={{ width: '16%' }} />{/* asset     */}
            <col style={{ width: '18%' }} />{/* ns · kind */}
            <col />                          {/* title     */}
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#0d1224' }}>
            <tr>
              {['Timestamp', t('severity'), t('asset'), `${t('namespace')} · Kind`, t('title')].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...S.td, color: '#64748b', textAlign: 'center', padding: 24 }}>
                  {loading ? t('loading') : t('events_no_data')}
                </td>
              </tr>
            )}
            {events.map((ev, i) => {
              const isExp = expandedIdx === i;
              const hasMsg = !!(ev.message);
              return (
                <React.Fragment key={i}>
                  <tr
                    onClick={() => setExpandedIdx(isExp ? null : i)}
                    style={{
                      cursor: 'pointer',
                      background: isExp
                        ? 'rgba(85,243,255,0.06)'
                        : i % 2 ? 'rgba(255,255,255,0.015)' : 'transparent',
                    }}
                  >
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap', color: '#64748b', paddingRight: 4 }}>
                      {tsShort(ev.ts)}
                    </td>
                    <td style={S.td}><SevBadge sev={ev.severity} /></td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ev.asset_id}>
                      {ev.asset_id}
                    </td>
                    <td style={{ ...S.td, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#94a3b8' }}>{ev.namespace}</span>
                      {ev.kind && <span style={{ color: '#475569' }}> · {ev.kind}</span>}
                    </td>
                    <td style={{ ...S.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ev.title}>
                      <span style={{ fontSize: 13 }}>{ev.title}</span>
                      {hasMsg && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: '#475569', verticalAlign: 'middle', userSelect: 'none' }}>
                          {isExp ? '▲' : '▶'}
                        </span>
                      )}
                    </td>
                  </tr>
                  {isExp && (
                    <tr style={{ background: 'rgba(85,243,255,0.025)' }}>
                      <td colSpan={5} style={{ ...S.td, padding: '10px 14px 12px', borderTop: '1px solid rgba(85,243,255,0.08)' }}>
                        {/* Metadata pills */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11, marginBottom: hasMsg ? 8 : 0 }}>
                          {[
                            ['ts',    ev.ts],
                            ['asset', ev.asset_id],
                            ['ns',    ev.namespace],
                            ev.kind ? ['kind', ev.kind] : null,
                            ['sev',   ev.severity],
                          ].filter((x): x is string[] => x !== null).map(([k, v]) => (
                            <span key={k as string}>
                              <span style={{ color: '#475569' }}>{k}</span>{' '}
                              <code style={{ color: '#cbd5e1', fontSize: 11 }}>{v}</code>
                            </span>
                          ))}
                        </div>
                        {hasMsg && (
                          <pre style={{
                            margin: 0,
                            fontSize: 12,
                            color: 'rgba(233,238,255,0.80)',
                            lineHeight: 1.55,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            maxHeight: 220,
                            overflowY: 'auto',
                            background: 'rgba(4,7,19,0.5)',
                            border: '1px solid rgba(140,160,255,0.10)',
                            borderRadius: 6,
                            padding: '8px 10px',
                          }}>
                            {ev.message}
                          </pre>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
