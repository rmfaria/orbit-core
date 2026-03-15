import React from 'react';
import { t } from '../i18n';
import { S, Tab } from '../shared';

export function SourcesTab({ setTab }: { setTab: (t: Tab) => void }) {
  return (
    <div>
      <div style={S.card}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>Sources</div>
        <div style={{ color: 'rgba(233,238,255,0.78)', marginTop: 6, fontSize: 13 }}>
          Selecione uma fonte configurada para abrir o workspace.
        </div>
      </div>

      <div style={S.card}>
        <div className="orbit-grid-3">
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 900 }}>Nagios</div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, letterSpacing: '.05em' }}>{t('sources_active')}</span>
            </div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>{t('sources_nagios_desc')}</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 14 }}>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/nagios/README.md" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                📄 Manual
              </a>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/nagios/ship_events.py" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚙ Conector
              </a>
            </div>
            <div style={{ marginTop: 10 }}>
              <button style={S.btn} onClick={() => setTab('src-nagios')}>Open Nagios</button>
            </div>
          </div>
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 900 }}>Wazuh</div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, letterSpacing: '.05em' }}>{t('sources_active')}</span>
            </div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>{t('sources_wazuh_desc')}</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 14 }}>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/wazuh/README.md" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                📄 Manual
              </a>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/wazuh/ship_events.py" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚙ Conector
              </a>
            </div>
            <div style={{ marginTop: 10 }}>
              <button style={S.btn} onClick={() => setTab('events')}>{t('sources_view_events')}</button>
            </div>
          </div>
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 900 }}>Fortigate</div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, letterSpacing: '.05em' }}>{t('sources_active')}</span>
            </div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>Firewall logs via syslog → Wazuh → orbit-core</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 14 }}>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/fortigate/README.md" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                📄 Manual
              </a>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/wazuh/ship_events.py" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚙ Conector
              </a>
            </div>
            <div style={{ marginTop: 10 }}>
              <button style={S.btn} onClick={() => setTab('events')}>{t('sources_view_events')}</button>
            </div>
          </div>
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 900 }}>n8n</div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(85,243,255,.12)', color: '#55f3ff', fontWeight: 700, letterSpacing: '.05em' }}>{t('sources_active')}</span>
            </div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>{t('sources_n8n_desc')}</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 14 }}>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/n8n/README.md" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                📄 Manual
              </a>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/n8n/ship_events.py" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚙ Conector
              </a>
              <a href="https://github.com/rmfaria/orbit-core/blob/main/connectors/n8n/orbit_error_reporter.json" target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'rgba(160,180,255,.75)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚡ Plug-and-play
              </a>
            </div>
            <div style={{ marginTop: 10 }}>
              <button style={S.btn} onClick={() => setTab('events')}>{t('sources_view_events')}</button>
            </div>
          </div>
          <div style={S.card}>
            <div style={{ fontWeight: 900 }}>Explore</div>
            <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13, marginTop: 6 }}>Core metrics/events explorer</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button style={S.btnSm} onClick={() => setTab('metrics')}>Metrics</button>
              <button style={S.btnSm} onClick={() => setTab('events')}>Events</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
