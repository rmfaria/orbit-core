/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  DoughnutController,
  ArcElement,
  RadarController,
  RadialLinearScale,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import './home.css';
import { t, setLocale, getLocale, Locale } from './i18n';
import { S, Tab, AssetOpt, NS_COLOR, useIsMobile, apiGetHeaders } from './shared';
import { HealthBadge } from './chartHelpers';
import { SystemTab } from './tabs/SystemTab';
import { HomeTab } from './tabs/HomeTab';
import { MetricsTab } from './tabs/MetricsTab';
import { WazuhTab } from './tabs/WazuhTab';
import { EventsTab } from './tabs/EventsTab';
import { NagiosTab } from './tabs/NagiosTab';
import { CorrelationsTab } from './tabs/CorrelationsTab';
import { AdminTab } from './tabs/AdminTab';
import { SourcesTab } from './tabs/SourcesTab';
import { DashboardsTab } from './tabs/DashboardsTab';
import { AiDesignerTab } from './tabs/AiDesignerTab';
import { AlertsTab } from './tabs/AlertsTab';
import { ConnectorsTab } from './tabs/ConnectorsTab';
import { ThreatIntelTab } from './tabs/ThreatIntelTab';

// Register only the Chart.js components we actually use (smaller bundle).
Chart.register(
  LineController, LineElement, PointElement,
  DoughnutController, ArcElement,
  RadarController, RadialLinearScale,
  LinearScale, CategoryScale,
  Filler, Tooltip, Legend,
);

// ─── TOP BAR ──────────────────────────────────────────────────────────────────

function TopBar({ tab, setTab, onLocaleChange }: { tab: Tab; setTab: (t: Tab) => void; onLocaleChange: () => void }) {
  const isMobile = useIsMobile();
  const [fontesDdOpen,   setFontesDdOpen]   = React.useState(false);
  const [analysisDdOpen, setAnalysisDdOpen] = React.useState(false);
  const [gearDdOpen,     setGearDdOpen]     = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [apiKey, setApiKey] = React.useState(() => localStorage.getItem('orbit_api_key') ?? '');
  const [locale, setLoc] = React.useState<Locale>(getLocale);

  function changeLocale(l: Locale) {
    setLocale(l);
    setLoc(l);
    onLocaleChange();
  }

  // Close dropdowns on outside click
  React.useEffect(() => {
    function handle(e: MouseEvent) {
      const tgt = e.target as HTMLElement;
      if (!tgt.closest('[data-dd="fontes"]'))   setFontesDdOpen(false);
      if (!tgt.closest('[data-dd="analysis"]')) setAnalysisDdOpen(false);
      if (!tgt.closest('[data-dd="gear"]'))     setGearDdOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Close mobile nav on resize to desktop
  React.useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile]);

  function navTabBtn(tid: Tab, label: string) {
    const active = tab === tid;
    return (
      <button
        key={tid}
        onClick={() => setTab(tid)}
        style={{
          background: active ? 'rgba(85,243,255,0.12)' : 'transparent',
          border: active ? '1px solid rgba(85,243,255,0.28)' : '1px solid transparent',
          borderRadius: 8,
          color: active ? '#55f3ff' : 'rgba(233,238,255,0.60)',
          padding: '5px 12px',
          margin: '0 2px',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: active ? 700 : 500,
          transition: 'all 0.15s',
          whiteSpace: 'nowrap' as const,
          height: 34,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {label}
      </button>
    );
  }

  // Drawer nav item (mobile)
  function navDrawerBtn(tid: Tab, label: string) {
    const active = tab === tid;
    return (
      <button
        key={tid}
        onClick={() => { setTab(tid); setMobileNavOpen(false); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          background: active ? 'rgba(85,243,255,0.08)' : 'transparent',
          border: 'none',
          borderLeft: active ? '3px solid #55f3ff' : '3px solid transparent',
          color: active ? '#55f3ff' : 'rgba(233,238,255,0.80)',
          padding: '14px 20px',
          cursor: 'pointer',
          fontSize: 15,
          fontWeight: active ? 700 : 400,
          textAlign: 'left' as const,
          transition: 'background 0.12s',
        }}
      >
        {label}
      </button>
    );
  }

  const isFontesActive = tab.startsWith('src-');

  function logoff() {
    localStorage.removeItem('orbit_api_key');
    setApiKey('');
    setTab('home');
  }

  const ddBase: React.CSSProperties = {
    position: 'absolute' as const,
    top: '100%',
    right: 0,
    marginTop: 4,
    background: 'rgba(8,12,28,0.97)',
    border: '1px solid rgba(140,160,255,0.20)',
    borderRadius: 12,
    boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
    backdropFilter: 'blur(12px)',
    minWidth: 160,
    zIndex: 100,
    overflow: 'hidden' as const,
  };

  const ddBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    background: 'transparent',
    border: 'none',
    color: 'rgba(233,238,255,0.80)',
    padding: '10px 16px',
    cursor: 'pointer',
    fontSize: 13,
    textAlign: 'left' as const,
  };

  const sourceLabels = ['Nagios', 'Wazuh', 'Fortigate', 'n8n', 'OTel', 'Suricata'];
  const sourceColors = [NS_COLOR.nagios, NS_COLOR.wazuh, NS_COLOR.fortigate, NS_COLOR.n8n, NS_COLOR.otel, NS_COLOR.suricata];
  const sourceTabs: Tab[] = ['src-nagios', 'src-wazuh', 'src-fortigate', 'src-n8n', 'src-otel', 'src-suricata'];

  return (
    <>
      <div style={S.topbar}>
        {/* Logo */}
        <span style={{ fontSize: 15, fontWeight: 800, color: '#55f3ff', letterSpacing: '0.2px', marginRight: 8, whiteSpace: 'nowrap' }}>
          ◎ Orbit
        </span>

        {/* Divider */}
        <div style={{ width: 1, height: 22, background: 'rgba(140,160,255,0.18)', marginRight: 8 }} />

        {/* Nav tabs — desktop only */}
        {!isMobile && (
          <nav style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            {navTabBtn('home', t('nav_home'))}
            {navTabBtn('system', t('nav_system'))}

            {/* Sources dropdown */}
            <div data-dd="fontes" style={{ position: 'relative' }}>
              <button
                onClick={() => setFontesDdOpen(x => !x)}
                style={{
                  background: isFontesActive ? 'rgba(85,243,255,0.12)' : 'transparent',
                  border: isFontesActive ? '1px solid rgba(85,243,255,0.28)' : '1px solid transparent',
                  borderRadius: 8,
                  color: isFontesActive ? '#55f3ff' : 'rgba(233,238,255,0.60)',
                  padding: '5px 12px',
                  margin: '0 2px',
                  height: 34,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: isFontesActive ? 700 : 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap' as const,
                }}
              >
                {t('nav_sources')}
                <span style={{ fontSize: 10, opacity: 0.7 }}>{fontesDdOpen ? '▲' : '▼'}</span>
              </button>
              {fontesDdOpen && (
                <div style={ddBase}>
                  {sourceTabs.map((tid, i) => {
                    const active = tab === tid;
                    return (
                      <button
                        key={tid}
                        onClick={() => { setTab(tid); setFontesDdOpen(false); }}
                        style={{
                          ...ddBtn,
                          background: active ? 'rgba(85,243,255,0.07)' : 'transparent',
                          color: active ? '#e9eeff' : 'rgba(233,238,255,0.75)',
                          fontWeight: active ? 700 : 400,
                        }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: sourceColors[i], flexShrink: 0 }} />
                        {sourceLabels[i]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Analysis dropdown */}
            {(() => {
              const analysisTabs: Tab[] = ['events', 'metrics', 'correlations', 'threat-intel'];
              const analysisLabels = [t('nav_events'), t('nav_metrics'), t('nav_correlations'), 'Threat Intel'];
              const isAnalysisActive = analysisTabs.includes(tab);
              return (
                <div data-dd="analysis" style={{ position: 'relative' }}>
                  <button
                    onClick={() => setAnalysisDdOpen(x => !x)}
                    style={{
                      background: isAnalysisActive ? 'rgba(85,243,255,0.12)' : 'transparent',
                      border: isAnalysisActive ? '1px solid rgba(85,243,255,0.28)' : '1px solid transparent',
                      borderRadius: 8,
                      color: isAnalysisActive ? '#55f3ff' : 'rgba(233,238,255,0.60)',
                      padding: '5px 12px',
                      margin: '0 2px',
                      height: 34,
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: isAnalysisActive ? 700 : 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      transition: 'all 0.15s',
                      whiteSpace: 'nowrap' as const,
                    }}
                  >
                    {t('nav_analysis')}
                    <span style={{ fontSize: 10, opacity: 0.7 }}>{analysisDdOpen ? '▲' : '▼'}</span>
                  </button>
                  {analysisDdOpen && (
                    <div style={ddBase}>
                      {analysisTabs.map((tid, i) => {
                        const active = tab === tid;
                        return (
                          <button
                            key={tid}
                            onClick={() => { setTab(tid); setAnalysisDdOpen(false); }}
                            style={{
                              ...ddBtn,
                              background: active ? 'rgba(85,243,255,0.07)' : 'transparent',
                              color: active ? '#e9eeff' : 'rgba(233,238,255,0.75)',
                              fontWeight: active ? 700 : 400,
                            }}
                          >
                            {analysisLabels[i]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
            {navTabBtn('alerts',       t('nav_alerts'))}
            {navTabBtn('connectors',   t('nav_connectors'))}
            {navTabBtn('dashboards',   t('nav_dashboards'))}
            {navTabBtn('ai-designer', t('nav_ai_designer'))}
          </nav>
        )}

        {/* Mobile spacer */}
        {isMobile && <div style={{ flex: 1 }} />}

        {/* Right side — desktop */}
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 8 }}>

            {/* Language switcher */}
            <div style={{ display: 'flex', gap: 2 }}>
              {(['en', 'pt-BR', 'es'] as Locale[]).map(l => (
                <button
                  key={l}
                  onClick={() => changeLocale(l)}
                  style={{
                    background: locale === l ? 'rgba(85,243,255,0.15)' : 'transparent',
                    border: '1px solid ' + (locale === l ? 'rgba(85,243,255,0.40)' : 'rgba(140,160,255,0.18)'),
                    borderRadius: 6,
                    color: locale === l ? '#55f3ff' : 'rgba(233,238,255,0.50)',
                    padding: '3px 7px',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: locale === l ? 700 : 500,
                    letterSpacing: '0.03em',
                    transition: 'all 0.12s',
                    height: 26,
                  }}
                >
                  {l === 'en' ? 'EN' : l === 'pt-BR' ? 'PT' : 'ES'}
                </button>
              ))}
            </div>

            <HealthBadge />

            {/* User indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: apiKey ? '#4ade80' : '#fbbf24',
                display: 'inline-block',
              }} />
              <span style={{ color: apiKey ? '#4ade80' : '#fbbf24', fontWeight: 600 }}>
                {apiKey ? t('auth_admin') : t('auth_no_auth')}
              </span>
            </div>

            {/* Gear dropdown */}
            <div data-dd="gear" style={{ position: 'relative' }}>
              <button
                onClick={() => setGearDdOpen(x => !x)}
                title={t('auth_settings')}
                style={{
                  background: gearDdOpen ? 'rgba(85,243,255,0.10)' : 'transparent',
                  border: '1px solid ' + (gearDdOpen ? 'rgba(85,243,255,0.30)' : 'rgba(140,160,255,0.20)'),
                  borderRadius: 8,
                  color: 'rgba(233,238,255,0.70)',
                  cursor: 'pointer',
                  fontSize: 16,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
              >
                ⚙
              </button>
              {gearDdOpen && (
                <div style={ddBase}>
                  <button
                    onClick={() => { setTab('admin'); setGearDdOpen(false); }}
                    style={ddBtn}
                  >
                    ⚙ Administration
                  </button>
                </div>
              )}
            </div>

            {/* Logoff */}
            <button
              onClick={logoff}
              title="Logoff"
              style={{
                background: 'transparent',
                border: '1px solid rgba(140,160,255,0.20)',
                borderRadius: 8,
                color: 'rgba(233,238,255,0.55)',
                cursor: 'pointer',
                fontSize: 15,
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
              }}
            >
              ⏻
            </button>
          </div>
        )}

        {/* Hamburger button — mobile only */}
        {isMobile && (
          <button
            onClick={() => setMobileNavOpen(x => !x)}
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            style={{
              background: mobileNavOpen ? 'rgba(85,243,255,0.12)' : 'transparent',
              border: '1px solid ' + (mobileNavOpen ? 'rgba(85,243,255,0.30)' : 'rgba(140,160,255,0.20)'),
              borderRadius: 8,
              color: '#e9eeff',
              cursor: 'pointer',
              fontSize: 20,
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
              marginLeft: 8,
              flexShrink: 0,
            }}
          >
            {mobileNavOpen ? '✕' : '☰'}
          </button>
        )}
      </div>

      {/* Mobile navigation drawer */}
      {isMobile && mobileNavOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            top: 50,
            zIndex: 40,
            background: 'rgba(4,7,19,0.98)',
            backdropFilter: 'blur(16px)',
            borderTop: '1px solid rgba(140,160,255,0.14)',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch' as const,
          }}
          onClick={() => setMobileNavOpen(false)}
        >
          {/* Inner: stop propagation so clicks on items don't close via the outer div */}
          <div onClick={e => e.stopPropagation()}>

            {/* Status row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: '1px solid rgba(140,160,255,0.10)' }}>
              <HealthBadge />
              <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: apiKey ? '#4ade80' : '#fbbf24', display: 'inline-block' }} />
              <span style={{ color: apiKey ? '#4ade80' : '#fbbf24', fontWeight: 600, fontSize: 13 }}>
                {apiKey ? t('auth_admin') : t('auth_no_auth')}
              </span>
            </div>

            {/* Nav items */}
            <div>
              {navDrawerBtn('home',   t('nav_home'))}
              {navDrawerBtn('system', t('nav_system'))}

              {/* Sources section */}
              <div style={{ padding: '10px 20px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(233,238,255,0.35)', textTransform: 'uppercase' as const }}>
                {t('nav_sources')}
              </div>
              {sourceTabs.map((tid, i) => {
                const active = tab === tid;
                return (
                  <button
                    key={tid}
                    onClick={() => { setTab(tid); setMobileNavOpen(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      background: active ? 'rgba(85,243,255,0.08)' : 'transparent',
                      border: 'none',
                      borderLeft: active ? '3px solid #55f3ff' : '3px solid transparent',
                      color: active ? '#55f3ff' : 'rgba(233,238,255,0.75)',
                      padding: '13px 20px 13px 28px',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: active ? 700 : 400,
                      textAlign: 'left' as const,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: sourceColors[i], flexShrink: 0 }} />
                    {sourceLabels[i]}
                  </button>
                );
              })}

              {/* Analysis section */}
              <div style={{ padding: '10px 20px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(233,238,255,0.35)', textTransform: 'uppercase' as const }}>
                {t('nav_analysis')}
              </div>
              {navDrawerBtn('events',       t('nav_events'))}
              {navDrawerBtn('metrics',      t('nav_metrics'))}
              {navDrawerBtn('correlations', t('nav_correlations'))}
              {navDrawerBtn('threat-intel', 'Threat Intel')}

              {navDrawerBtn('alerts',       t('nav_alerts'))}
              {navDrawerBtn('connectors',   t('nav_connectors'))}
              {navDrawerBtn('dashboards',   t('nav_dashboards'))}
              {navDrawerBtn('ai-designer', t('nav_ai_designer'))}
            </div>

            {/* Language switcher — mobile */}
            <div style={{ padding: '10px 20px', display: 'flex', gap: 6 }}>
              {(['en', 'pt-BR', 'es'] as Locale[]).map(l => (
                <button
                  key={l}
                  onClick={() => { changeLocale(l); setMobileNavOpen(false); }}
                  style={{
                    background: locale === l ? 'rgba(85,243,255,0.15)' : 'transparent',
                    border: '1px solid ' + (locale === l ? 'rgba(85,243,255,0.40)' : 'rgba(140,160,255,0.20)'),
                    borderRadius: 8,
                    color: locale === l ? '#55f3ff' : 'rgba(233,238,255,0.55)',
                    padding: '8px 18px',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: locale === l ? 700 : 500,
                    flex: 1,
                  }}
                >
                  {l === 'en' ? 'EN' : l === 'pt-BR' ? 'PT' : 'ES'}
                </button>
              ))}
            </div>

            {/* Bottom actions */}
            <div style={{ borderTop: '1px solid rgba(140,160,255,0.10)', padding: '14px 20px', display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setTab('admin'); setMobileNavOpen(false); }}
                style={{ ...ddBtn, flex: 1, padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(140,160,255,0.20)', justifyContent: 'center', fontSize: 14 }}
              >
                ⚙ Admin
              </button>
              <button
                onClick={() => { logoff(); setMobileNavOpen(false); }}
                style={{ ...ddBtn, flex: 1, padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(255,93,93,0.25)', color: '#fca5a5', justifyContent: 'center', fontSize: 14 }}
              >
                ⏻ Logoff
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#f87171', fontFamily: 'monospace', background: '#0f0f12', minHeight: '100dvh' }}>
          <div style={{ fontSize: 18, marginBottom: 12, fontWeight: 700 }}>Erro inesperado na interface</div>
          <pre style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 20 }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '8px 20px', cursor: 'pointer', background: '#2d2d8f', border: 'none', color: '#e2e8f0', borderRadius: 8, fontWeight: 600 }}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

// ── License Banner (inline activation during grace) ─────────────────────────

function LicenseBanner({ msg, onActivated }: { msg: string; onActivated: () => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const [key, setKey] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function activate() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('api/v1/license/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ license_key: key.trim() }),
      });
      const j = await res.json();
      if (j.ok) onActivated();
      else setError(j.error || 'Invalid license key');
    } catch { setError('Connection error'); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ marginBottom: 14, background: 'rgba(85,243,255,0.06)', border: '1px solid rgba(85,243,255,0.25)', borderRadius: 12, fontSize: 13, color: '#55f3ff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16 }}>&#x23F3;</span>
        <span style={{ flex: 1, minWidth: 150 }}>{msg}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setExpanded(!expanded)} style={{ background: 'rgba(85,243,255,0.12)', border: '1px solid rgba(85,243,255,0.3)', borderRadius: 8, color: '#55f3ff', padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>{expanded ? '✕' : t('license_activate')}</button>
          <a href="https://orbit-core.org/register.html" target="_blank" rel="noreferrer" style={{ color: '#55f3ff', fontWeight: 700, textDecoration: 'underline', fontSize: 12 }}>{t('license_get_free')}</a>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '0 18px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>
          <input value={key} onChange={e => setKey(e.target.value)} placeholder={t('license_key_placeholder')} style={{ ...S.input, flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: 12, padding: '8px 12px', boxSizing: 'border-box' as const }} />
          <button onClick={activate} disabled={loading || !key.trim()} style={{ ...S.btn, padding: '8px 20px', fontSize: 12, whiteSpace: 'nowrap' as const }}>{loading ? t('license_activating') : '→ ' + t('license_activate')}</button>
          {error && <span style={{ color: '#f87171', fontSize: 12 }}>{error}</span>}
        </div>
      )}
    </div>
  );
}

// ── License Setup Screen ─────────────────────────────────────────────────────

type LicenseStatus = 'loading' | 'valid' | 'grace' | 'expired' | 'unlicensed';

function LicenseSetup({ onActivated }: { onActivated: () => void }) {
  const [key, setKey] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function activate() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('api/v1/license/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ license_key: key.trim() }),
      });
      const j = await res.json();
      if (j.ok) onActivated();
      else setError(j.error || 'Invalid license key');
    } catch { setError('Connection error. Please try again.'); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(1000px 640px at 50% 40%, rgba(85,243,255,0.08), transparent 55%), linear-gradient(180deg, #040713, #0b1220)', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#e9eeff' }}>
      <div style={{ ...S.card, maxWidth: 520, width: '90%', padding: 32, textAlign: 'center' as const }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>&#x2B21;</div>
        <div style={{ fontWeight: 900, fontSize: 22, marginBottom: 4 }}>{t('license_setup_title')}</div>
        <div style={{ color: 'rgba(233,238,255,0.65)', fontSize: 14, marginBottom: 24 }}>{t('license_setup_subtitle')}</div>
        <textarea value={key} onChange={e => setKey(e.target.value)} placeholder={t('license_key_placeholder')} style={{ ...S.input, width: '100%', minHeight: 80, resize: 'vertical' as const, fontFamily: 'monospace', fontSize: 12, marginBottom: 12, boxSizing: 'border-box' as const }} />
        {error && <div style={S.err}>{error}</div>}
        <button onClick={activate} disabled={loading || !key.trim()} style={{ ...S.btn, width: '100%', marginTop: 12, padding: '12px 16px' }}>{loading ? t('license_activating') : t('license_activate')}</button>
        <div style={{ marginTop: 20, fontSize: 13, color: 'rgba(233,238,255,0.55)' }}>
          {t('license_no_key')}{' '}
          <a href="https://orbit-core.org/register.html" target="_blank" rel="noreferrer" style={{ color: '#55f3ff', textDecoration: 'none' }}>{t('license_register_link')}</a>
        </div>
      </div>
    </div>
  );
}

// ── Auth Gate (first-access setup / login) ──────────────────────────────────

function AuthGate({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = React.useState<'loading' | 'setup' | 'login' | 'ok'>('loading');
  const [password, setPassword]   = React.useState('');
  const [confirm, setConfirm]     = React.useState('');
  const [error, setError]         = React.useState('');
  const [busy, setBusy]           = React.useState(false);

  React.useEffect(() => {
    const hasKey = !!localStorage.getItem('orbit_api_key');

    fetch('api/v1/auth/status')
      .then(r => r.json())
      .then(j => {
        if (!j.ok) { setAuthState('ok'); return; } // endpoint missing → legacy mode
        if (!j.setup_complete) {
          // First access — clear stale key and show setup
          localStorage.removeItem('orbit_api_key');
          setAuthState('setup');
        } else if (hasKey) {
          setAuthState('ok');
        } else {
          setAuthState('login');
        }
      })
      .catch(() => setAuthState('ok')); // network error → let the app handle it
  }, []);

  if (authState === 'loading') {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#030711', color: '#55f3ff', fontFamily: 'Inter, system-ui, sans-serif' }}>Loading...</div>;
  }
  if (authState === 'ok') return <>{children}</>;

  const isSetup = authState === 'setup';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (isSetup && password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setBusy(true);
    try {
      const endpoint = isSetup ? 'api/v1/auth/setup' : 'api/v1/auth/login';
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const j = await r.json();
      if (!j.ok) { setError(j.error || 'Authentication failed'); setBusy(false); return; }
      localStorage.setItem('orbit_api_key', j.api_key);
      window.location.reload();
    } catch {
      setError('Connection failed');
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#030711', fontFamily: 'Inter, system-ui, sans-serif', padding: 16 }}>
      <form onSubmit={handleSubmit} style={{ maxWidth: 400, width: '100%', padding: 'clamp(20px, 5vw, 40px)', borderRadius: 16, background: 'rgba(15,23,42,0.85)', border: '1px solid rgba(85,243,255,0.12)', backdropFilter: 'blur(24px)', textAlign: 'center', boxSizing: 'border-box' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>&#x2B21;</div>
        <h1 style={{ fontSize: 20, fontWeight: 900, color: '#e9eeff', margin: '0 0 4px' }}>
          {isSetup ? 'Create Admin Password' : 'Orbit Core Login'}
        </h1>
        <p style={{ color: '#8c9ab5', fontSize: 13, margin: '0 0 28px' }}>
          {isSetup ? 'Set your admin password to get started.' : 'Enter your password to continue.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#8c9ab5', display: 'block', marginBottom: 4 }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              autoFocus required minLength={6}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(140,160,255,0.2)', background: 'rgba(15,23,42,0.6)', color: '#e9eeff', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          {isSetup && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#8c9ab5', display: 'block', marginBottom: 4 }}>Confirm Password</label>
              <input
                type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                required minLength={6}
                style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(140,160,255,0.2)', background: 'rgba(15,23,42,0.6)', color: '#e9eeff', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          )}
          <button type="submit" disabled={busy} style={{ padding: 14, border: 'none', borderRadius: 10, background: 'linear-gradient(135deg, #55f3ff, #a78bfa)', color: '#030711', fontSize: 15, fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1, marginTop: 8 }}>
            {busy ? (isSetup ? 'Creating...' : 'Logging in...') : (isSetup ? 'Create Password' : 'Login')}
          </button>
          {error && (
            <div style={{ color: '#f87171', fontSize: 13, padding: '10px 14px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8 }}>
              {error}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

export function App() {
  const isMobile = useIsMobile();
  const [tab, setTab]         = React.useState<Tab>('home');
  const [assets, setAssets]   = React.useState<AssetOpt[]>([]);
  const [needsKey, setNeedsKey] = React.useState(false);
  const [, _forceLocale] = React.useReducer((x: number) => x + 1, 0);

  const [licenseStatus, setLicenseStatus] = React.useState<LicenseStatus>('loading');
  const [licenseMsg, setLicenseMsg] = React.useState('');

  // Check license on mount
  React.useEffect(() => {
    fetch('api/v1/license/status')
      .then(r => r.json())
      .then(j => {
        if (j.ok) {
          setLicenseStatus(j.license.status);
          setLicenseMsg(j.license.message ?? '');
        } else {
          setLicenseStatus('grace');
        }
      })
      .catch(() => setLicenseStatus('grace'));
  }, []);

  React.useEffect(() => {
    if (licenseStatus === 'loading' || licenseStatus === 'unlicensed' || licenseStatus === 'expired') return;
    fetch('api/v1/catalog/assets?limit=500', { headers: apiGetHeaders() })
      .then((r) => { if (r.status === 401) { setNeedsKey(true); return null; } return r.json(); })
      .then((j) => { if (j) { setNeedsKey(false); setAssets((j?.assets ?? []).map((a: any) => ({ asset_id: a.asset_id, name: a.name ?? a.asset_id }))); } })
      .catch(e => console.error("[orbit]", e));
  }, [tab, licenseStatus]);

  // Loading state
  if (licenseStatus === 'loading') {
    return <div style={{ ...S.root, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#55f3ff' }}>{t('license_loading')}</div>;
  }

  // Unlicensed or expired → full-screen setup
  if (licenseStatus === 'unlicensed' || licenseStatus === 'expired') {
    return <AuthGate><LicenseSetup onActivated={() => setLicenseStatus('valid')} /></AuthGate>;
  }

  return (
    <AuthGate>
    <ErrorBoundary>
    <div style={S.root}>
      <TopBar tab={tab} setTab={setTab} onLocaleChange={_forceLocale} />
      <div style={{ flex: 1, minWidth: 0, padding: isMobile ? '14px 12px' : '22px 24px' }}>
        {licenseStatus === 'grace' && <LicenseBanner msg={licenseMsg} onActivated={() => { setLicenseStatus('valid'); setLicenseMsg(''); }} />}
        {needsKey && tab !== 'admin' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '10px 12px' : '12px 18px', marginBottom: 14, background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.35)', borderRadius: 12, fontSize: isMobile ? 12 : 13, color: '#fbbf24', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18 }}>⚠</span>
            <span>{t('err_api_key')}<strong>API Key</strong>{t('err_api_key_mid')}</span>
            <button onClick={() => setTab('admin')} style={{ background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.4)', borderRadius: 8, color: '#fbbf24', padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>⚙ Admin</button>
            <span>{t('err_api_key_suffix')}</span>
          </div>
        )}
        {tab === 'home'          && <HomeTab        assets={assets} setTab={setTab} />}
        {tab === 'system'        && <SystemTab />}
        {tab === 'dashboards'    && <DashboardsTab  assets={assets} />}
        {tab === 'ai-designer'  && <AiDesignerTab />}
        {tab === 'src-nagios'    && <NagiosTab      assets={assets} />}
        {tab === 'src-wazuh'     && <WazuhTab        assets={assets} />}
        {tab === 'src-fortigate' && <EventsTab      key="src-fortigate" assets={assets} defaultNs="wazuh" />}
        {tab === 'src-n8n'       && <EventsTab      key="src-n8n"       assets={assets} defaultNs="n8n"   />}
        {tab === 'src-otel'      && <EventsTab      key="src-otel"      assets={assets} defaultNs="otel"  />}
        {tab === 'src-suricata'  && <EventsTab      key="src-suricata"  assets={assets} defaultNs="suricata" />}
        {tab === 'events'        && <EventsTab      key="events"        assets={assets} />}
        {tab === 'metrics'       && <MetricsTab     assets={assets} />}
        {tab === 'correlations'  && <CorrelationsTab assets={assets} />}
        {tab === 'threat-intel'  && <ThreatIntelTab assets={assets} />}
        {tab === 'alerts'        && <AlertsTab assets={assets} />}
        {tab === 'connectors'    && <ConnectorsTab setTab={setTab} />}
        {tab === 'admin'         && <AdminTab setTab={setTab} />}
      </div>
    </div>
    </ErrorBoundary>
    </AuthGate>
  );
}
