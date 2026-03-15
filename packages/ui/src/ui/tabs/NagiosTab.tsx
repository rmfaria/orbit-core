import React from 'react';
import { t } from '../i18n';
import { S, AssetOpt, EventRow, apiHeaders, apiGetHeaders, fmtTs, relativeFrom, visibleInterval } from '../shared';
import { SevBadge, StateBadge, TimeRangePicker } from '../components';
import { makeNeLineChart } from '../chartHelpers';

type NagiosSvc = {
  ts: string;
  asset_id: string;
  service: string;
  state: string;
  severity: string;
  output: string;
};

export function NagiosTab({ assets }: { assets: AssetOpt[] }) {
  const [assetId, setAssetId]         = React.useState('');
  const [stateFilter, setStateFilter] = React.useState('');
  const [from, setFrom]               = React.useState(() => relativeFrom(24));
  const [to, setTo]                   = React.useState(() => new Date().toISOString());
  const [services, setServices]       = React.useState<NagiosSvc[]>([]);
  const [loading, setLoading]         = React.useState(false);
  const [err, setErr]                 = React.useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = React.useState<number | null>(null);

  async function run() {
    setLoading(true); setErr(null); setExpandedIdx(null);
    try {
      const q: any = { kind: 'events', from, to, namespace: 'nagios', limit: 2000 };
      if (assetId) q.asset_id = assetId;

      const r = await fetch('api/v1/query', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ query: q }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));

      const raw: EventRow[] = j?.result?.rows ?? [];

      const latestMap = new Map<string, NagiosSvc>();
      for (const ev of raw) {
        const isHost = ev.kind === 'host';
        const parts = ev.title.split(' ');
        const state = parts[parts.length - 1] ?? ev.severity.toUpperCase();
        const service = isHost
          ? '(host)'
          : parts.slice(0, parts.length - 1).join(' ') || ev.kind;

        const key = `${ev.asset_id}::${service}`;
        const existing = latestMap.get(key);
        if (!existing || new Date(ev.ts) > new Date(existing.ts)) {
          latestMap.set(key, {
            ts:       ev.ts,
            asset_id: ev.asset_id,
            service,
            state:    state.toUpperCase(),
            severity: ev.severity,
            output:   ev.message ?? '',
          });
        }
      }

      let all = Array.from(latestMap.values());
      const sevOrder = ['critical', 'high', 'medium', 'low', 'info'];
      all.sort((a, b) => {
        const sa = sevOrder.indexOf(a.severity);
        const sb = sevOrder.indexOf(b.severity);
        if (sa !== sb) return sa - sb;
        return a.asset_id.localeCompare(b.asset_id);
      });

      if (stateFilter) all = all.filter((s) => s.state === stateFilter || s.severity === stateFilter.toLowerCase());
      setServices(all);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { run(); }, []);

  const states = ['', 'OK', 'UP', 'WARNING', 'CRITICAL', 'DOWN', 'UNREACHABLE', 'UNKNOWN'];
  const counts = {
    ok:       services.filter((s) => s.state === 'OK' || s.state === 'UP').length,
    warning:  services.filter((s) => s.state === 'WARNING').length,
    critical: services.filter((s) => s.state === 'CRITICAL' || s.state === 'DOWN').length,
    unknown:  services.filter((s) => s.state === 'UNKNOWN' || s.state === 'UNREACHABLE').length,
  };

  return (
    <div>
      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { label: 'OK / UP',         count: counts.ok,       color: '#4ade80' },
          { label: 'WARNING',         count: counts.warning,  color: '#fbbf24' },
          { label: 'CRITICAL / DOWN', count: counts.critical, color: '#f87171' },
          { label: 'UNKNOWN',         count: counts.unknown,  color: '#94a3b8' },
        ].map(({ label, count, color }) => (
          <div key={label} style={{
            background: '#1e293b', border: `1px solid ${color}44`, borderRadius: 8,
            padding: '8px 16px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', minWidth: 100,
          }}>
            <span style={{ fontSize: 22, fontWeight: 700, color }}>{count}</span>
            <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={S.card}>
        <div className="orbit-grid-2" style={{ marginBottom: 10 }}>
          <label style={S.label}>
            Host
            <select style={S.select} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">{t('all')}</option>
              {assets.map((a) => <option key={a.asset_id} value={a.asset_id}>{a.asset_id}</option>)}
            </select>
          </label>
          <label style={S.label}>
            {t('nagios_col_state')}
            <select style={S.select} value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
              {states.map((s) => <option key={s} value={s}>{s || t('all')}</option>)}
            </select>
          </label>
        </div>
        <div style={{ marginBottom: 10 }}>
          <TimeRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
        </div>
        <div style={S.row}>
          <button style={S.btn} onClick={run} disabled={loading}>{loading ? '…' : t('search')}</button>
          <span style={{ color: '#64748b', fontSize: 12 }}>{services.length} services</span>
        </div>
        {err && <div style={S.err}>{err}</div>}
      </div>

      {/* Table — sticky header, expandable rows, fills remaining viewport height */}
      <div style={{ ...S.card, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 390px)', minHeight: 240 }}>
        <table style={{ ...S.table, tableLayout: 'fixed', minWidth: 520 }}>
          <colgroup>
            <col style={{ width: 96 }} />  {/* state      */}
            <col style={{ width: 68 }} />  {/* severity   */}
            <col style={{ width: '18%' }} />{/* host       */}
            <col style={{ width: '22%' }} />{/* service    */}
            <col />                          {/* output     */}
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#0d1224' }}>
            <tr>
              {[t('nagios_col_state'), t('nagios_col_severity'), 'Host', t('nagios_col_service'), t('nagios_col_output')].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {services.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...S.td, color: '#64748b', textAlign: 'center', padding: 24 }}>
                  {loading ? t('loading') : t('nagios_no_services')}
                </td>
              </tr>
            )}
            {services.map((svc, i) => {
              const isExp = expandedIdx === i;
              const hasOutput = !!svc.output;
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
                    <td style={S.td}><StateBadge state={svc.state} /></td>
                    <td style={S.td}><SevBadge sev={svc.severity} /></td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={svc.asset_id}>
                      {svc.asset_id}
                    </td>
                    <td style={{ ...S.td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={svc.service}>
                      {svc.service}
                    </td>
                    <td style={{ ...S.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={svc.output}>
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>{svc.output}</span>
                      {hasOutput && (
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
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11, marginBottom: hasOutput ? 8 : 0 }}>
                          {[
                            ['last change', fmtTs(svc.ts)],
                            ['host',        svc.asset_id],
                            ['service',     svc.service],
                            ['state',       svc.state],
                            ['severity',    svc.severity],
                          ].map(([k, v]) => (
                            <span key={k}>
                              <span style={{ color: '#475569' }}>{k}</span>{' '}
                              <code style={{ color: '#cbd5e1', fontSize: 11 }}>{v}</code>
                            </span>
                          ))}
                        </div>
                        {hasOutput && (
                          <pre style={{
                            margin: 0, fontSize: 12, color: 'rgba(233,238,255,0.80)',
                            lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            maxHeight: 220, overflowY: 'auto',
                            background: 'rgba(4,7,19,0.5)',
                            border: '1px solid rgba(140,160,255,0.10)',
                            borderRadius: 6, padding: '8px 10px',
                          }}>
                            {svc.output}
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
