import React from 'react';
import { t } from '../i18n';
import { S, AssetOpt, MetricOpt, apiHeaders, apiGetHeaders } from '../shared';
import { SevBadge } from '../components';

type AlertChannel = { id: string; name: string; kind: string; config?: any; created_at: string };
type AlertRule = {
  id: number; name: string; enabled: boolean;
  asset_id: string | null; namespace: string | null; metric: string | null;
  condition: any; severity: string; channels: string[];
  state: string; fired_at: string | null; last_value: number | null;
  silence_until: string | null; created_at: string;
};
type AlertNotif = { id: number; rule_id: number; rule_name: string; channel_id: string; event: string; ok: boolean; error: string | null; sent_at: string };

const SEV_COLORS: Record<string, string> = { critical: '#f87171', high: '#fb923c', medium: '#fbbf24', low: '#34d399', info: '#55f3ff' };
const CH_ICONS: Record<string, string> = { email: '\u2709', telegram: '\u2708', webhook: '\u{1F517}' };
const CH_COLORS: Record<string, [string, string]> = {
  email:    ['#1e1b4b', '#a78bfa'],
  telegram: ['#172554', '#60a5fa'],
  webhook:  ['#1c1917', '#fdba74'],
};

const TEST_PAYLOAD = {
  event:     'firing' as const,
  rule_name: 'Test Alert \u2014 orbit-core',
  asset_id:  'host:example',
  namespace: 'nagios',
  metric:    'cpu',
  condition: { kind: 'threshold', op: '>', value: 80, window_min: 5, agg: 'avg' },
  value:     95.5,
  severity:  'high',
  fired_at:  new Date().toISOString(),
};

export function AlertsTab({ assets }: { assets: AssetOpt[] }) {
  const [rules, setRules]       = React.useState<AlertRule[]>([]);
  const [channels, setChannels] = React.useState<AlertChannel[]>([]);
  const [history, setHistory]   = React.useState<AlertNotif[]>([]);
  const [loading, setLoading]   = React.useState(false);
  const [err, setErr]           = React.useState<string | null>(null);
  const [toast, setToast]       = React.useState<{ msg: string; ok: boolean } | null>(null);

  const [showChannels, setShowChannels] = React.useState(true);
  const [showHistory, setShowHistory]   = React.useState(true);

  // Rule form
  const [showRuleForm, setShowRuleForm] = React.useState(false);
  const [rf, setRf] = React.useState({
    name: '', asset_id: '', namespace: '', metric: '',
    condKind: 'threshold' as 'threshold' | 'absence',
    op: '>' as string, condValue: '', windowMin: '5', agg: 'avg',
    severity: 'medium', selectedChannels: [] as string[],
  });
  const [expandedRuleId, setExpandedRuleId] = React.useState<number | null>(null);

  // Channel form
  const [showChForm, setShowChForm] = React.useState(false);
  const [cf, setCf] = React.useState({
    id: '', name: '', kind: 'email' as 'email' | 'webhook' | 'telegram',
    url: '', headers: '', bot_token: '', chat_id: '', recipients: '',
  });

  // SMTP modal
  const [showSmtp, setShowSmtp] = React.useState(false);
  const [smtp, setSmtp] = React.useState({ host: '', port: '587', secure: false, user: '', pass: '', from: '' });
  const [smtpLoaded, setSmtpLoaded] = React.useState(false);
  const [smtpSaving, setSmtpSaving] = React.useState(false);

  // Test modal
  const [testModal, setTestModal] = React.useState<{ ch: AlertChannel; status: 'idle' | 'sending' | 'ok' | 'error'; error?: string } | null>(null);

  // AI generator
  const [aiPrompt, setAiPrompt]       = React.useState('');
  const [aiGenerating, setAiGenerating] = React.useState(false);
  const [aiError, setAiError]         = React.useState<string | null>(null);
  const [aiPreview, setAiPreview]     = React.useState<{ rules: any[]; summary: string } | null>(null);
  const [aiApplied, setAiApplied]     = React.useState<Set<number>>(new Set());

  // Catalog for rule form
  const [catAssets, setCatAssets]   = React.useState<string[]>([]);
  const [catMetrics, setCatMetrics] = React.useState<MetricOpt[]>([]);

  function showToastMsg(msg: string, ok: boolean) { setToast({ msg, ok }); setTimeout(() => setToast(null), 4000); }
  function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }

  async function loadRules() {
    setLoading(true); setErr(null);
    try { const j = await fetch('api/v1/alerts/rules', { headers: apiGetHeaders() }).then(r => r.json()); if (j.ok) setRules(j.rules); else throw new Error(j.error); }
    catch (e: any) { setErr(String(e)); } finally { setLoading(false); }
  }
  async function loadChannels() {
    try {
      const j = await fetch('api/v1/alerts/channels', { headers: apiGetHeaders() }).then(r => r.json());
      if (j.ok) setChannels(j.channels);
    } catch {}
  }
  async function loadHistory() { try { const j = await fetch('api/v1/alerts/history', { headers: apiGetHeaders() }).then(r => r.json()); if (j.ok) setHistory(j.notifications); } catch {} }
  async function loadSmtp() {
    try {
      const j = await fetch('api/v1/alerts/smtp', { headers: apiGetHeaders() }).then(r => r.json());
      if (j.ok && j.smtp) setSmtp({ host: j.smtp.host, port: String(j.smtp.port), secure: j.smtp.secure, user: j.smtp.user, pass: '', from: j.smtp.from });
      setSmtpLoaded(true);
    } catch {}
  }
  async function loadCatalog() {
    try {
      const j = await fetch('api/v1/catalog/assets', { headers: apiGetHeaders() }).then(r => r.json());
      if (j.ok) setCatAssets((j.assets ?? []).map((a: any) => a.asset_id));
    } catch {}
  }
  async function loadMetricsFor(assetId: string) {
    if (!assetId) { setCatMetrics([]); return; }
    try {
      const j = await fetch(`api/v1/catalog/metrics?asset_id=${encodeURIComponent(assetId)}`, { headers: apiGetHeaders() }).then(r => r.json());
      if (j.ok) setCatMetrics(j.metrics ?? []);
    } catch {}
  }

  React.useEffect(() => { loadRules(); loadChannels(); loadHistory(); loadSmtp(); loadCatalog(); }, []);

  // Rule actions
  async function toggleRule(rule: AlertRule) {
    await fetch(`api/v1/alerts/rules/${rule.id}`, { method: 'PATCH', headers: apiHeaders(), body: JSON.stringify({ enabled: !rule.enabled }) });
    loadRules();
  }
  async function silenceRule(rule: AlertRule) {
    await fetch(`api/v1/alerts/rules/${rule.id}`, { method: 'PATCH', headers: apiHeaders(), body: JSON.stringify({ silence_until: new Date(Date.now() + 3600_000).toISOString() }) });
    showToastMsg(t('alerts_silenced_1h'), true); loadRules();
  }
  async function deleteRule(id: number) { if (!confirm(t('alerts_confirm_delete'))) return; await fetch(`api/v1/alerts/rules/${id}`, { method: 'DELETE', headers: apiGetHeaders() }); loadRules(); }

  async function saveRule() {
    const condition = rf.condKind === 'threshold'
      ? { kind: 'threshold', op: rf.op, value: parseFloat(rf.condValue), window_min: parseInt(rf.windowMin), agg: rf.agg }
      : { kind: 'absence', window_min: parseInt(rf.windowMin) };
    const body: any = { name: rf.name, enabled: true, condition, severity: rf.severity, channels: rf.selectedChannels };
    if (rf.asset_id) body.asset_id = rf.asset_id;
    if (rf.namespace) body.namespace = rf.namespace;
    if (rf.metric) body.metric = rf.metric;
    const j = await fetch('api/v1/alerts/rules', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) }).then(r => r.json());
    if (!j.ok) { showToastMsg('Error: ' + JSON.stringify(j.error), false); return; }
    showToastMsg(t('alerts_rule_created'), true);
    setShowRuleForm(false);
    setRf({ name: '', asset_id: '', namespace: '', metric: '', condKind: 'threshold', op: '>', condValue: '', windowMin: '5', agg: 'avg', severity: 'medium', selectedChannels: [] });
    loadRules();
  }

  // Channel actions
  async function deleteChannel(id: string) { if (!confirm(t('alerts_confirm_delete_channel'))) return; await fetch(`api/v1/alerts/channels/${id}`, { method: 'DELETE', headers: apiGetHeaders() }); loadChannels(); }

  async function testChannel(ch: AlertChannel) {
    setTestModal({ ch, status: 'sending' });
    try {
      const j = await fetch(`api/v1/alerts/channels/${ch.id}/test`, { method: 'POST', headers: apiHeaders() }).then(r => r.json());
      setTestModal({ ch, status: j.ok ? 'ok' : 'error', error: j.ok ? undefined : j.error });
    } catch (e: any) {
      setTestModal({ ch, status: 'error', error: String(e) });
    }
  }

  async function saveChannel() {
    try {
      let config: any;
      if (cf.kind === 'webhook') {
        let hdrs: Record<string, string> | undefined;
        if (cf.headers.trim()) {
          try { hdrs = JSON.parse(cf.headers); } catch { showToastMsg('Error: invalid JSON in headers', false); return; }
        }
        config = { url: cf.url, ...(hdrs ? { headers: hdrs } : {}) };
      } else if (cf.kind === 'telegram') {
        config = { bot_token: cf.bot_token, chat_id: cf.chat_id };
      } else {
        config = { recipients: cf.recipients.split(',').map(s => s.trim()).filter(Boolean) };
      }
      const j = await fetch('api/v1/alerts/channels', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ id: cf.id, name: cf.name, kind: cf.kind, config }) }).then(r => r.json());
      if (!j.ok) { showToastMsg('Error: ' + JSON.stringify(j.error), false); return; }
      showToastMsg(t('alerts_channel_saved'), true);
      setShowChForm(false);
      setCf({ id: '', name: '', kind: 'email', url: '', headers: '', bot_token: '', chat_id: '', recipients: '' });
      loadChannels();
    } catch (e: any) {
      showToastMsg('Error: ' + String(e?.message ?? e), false);
    }
  }

  // SMTP
  async function saveSmtp() {
    setSmtpSaving(true);
    try {
      const j = await fetch('api/v1/alerts/smtp', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ host: smtp.host, port: parseInt(smtp.port), secure: smtp.secure, user: smtp.user, pass: smtp.pass, from: smtp.from }) }).then(r => r.json());
      if (!j.ok) { showToastMsg('Error: ' + JSON.stringify(j.error), false); return; }
      showToastMsg(t('alerts_smtp_saved'), true);
    } finally { setSmtpSaving(false); }
  }
  async function testSmtp() {
    const to = prompt(t('alerts_smtp_test_to'));
    if (!to) return;
    const j = await fetch('api/v1/alerts/smtp/test', { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ to }) }).then(r => r.json());
    showToastMsg(j.ok ? j.message : 'Error: ' + j.error, j.ok);
  }

  // AI generator
  async function aiGenerate() {
    const aiKey = (localStorage.getItem('ai_api_key') ?? '').trim();
    const aiModel = (localStorage.getItem('ai_model') ?? 'claude-sonnet-4-6').trim();
    if (!aiKey) { setAiError(t('alerts_ai_no_key')); return; }
    if (!aiPrompt.trim()) return;
    setAiGenerating(true); setAiError(null); setAiPreview(null); setAiApplied(new Set());
    try {
      const j = await fetch('api/v1/ai/alerts', {
        method: 'POST',
        headers: { ...apiHeaders(), 'x-ai-key': aiKey, 'x-ai-model': aiModel },
        body: JSON.stringify({ prompt: aiPrompt }),
      }).then(r => r.json());
      if (!j.ok) { setAiError(j.error + (j.detail ? ': ' + j.detail : '') + (j.raw ? '\n\nRaw: ' + j.raw : '')); return; }
      const res = j.result as { rules?: any[]; summary?: string };
      if (!res?.rules?.length) {
        setAiError(res?.summary || 'AI could not generate rules for this request. Try being more specific about assets/metrics.');
        return;
      }
      setAiPreview({ rules: res.rules, summary: res.summary ?? '' });
    } catch (e: any) {
      setAiError(String(e?.message ?? e));
    } finally {
      setAiGenerating(false);
    }
  }

  async function aiApplyRule(rule: any, idx: number) {
    try {
      const body = {
        name: rule.name, enabled: true,
        asset_id: rule.asset_id || undefined,
        namespace: rule.namespace || undefined,
        metric: rule.metric || undefined,
        condition: rule.condition, severity: rule.severity ?? 'medium',
        channels: rule.channels ?? [],
      };
      const j = await fetch('api/v1/alerts/rules', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) }).then(r => r.json());
      if (!j.ok) { showToastMsg('Error: ' + JSON.stringify(j.error), false); return; }
      setAiApplied(prev => new Set([...prev, idx]));
    } catch (e: any) {
      showToastMsg('Error: ' + String(e?.message ?? e), false);
    }
  }

  async function aiApplyAll() {
    if (!aiPreview) return;
    for (let i = 0; i < aiPreview.rules.length; i++) {
      if (!aiApplied.has(i)) await aiApplyRule(aiPreview.rules[i], i);
    }
    showToastMsg(t('alerts_ai_applied'), true);
    loadRules();
  }

  function condText(rule: AlertRule) {
    const c = rule.condition;
    if (c.kind === 'threshold') return `${c.agg ?? 'avg'} ${c.op} ${c.value} (${c.window_min}min)`;
    return `no data ${c.window_min}min`;
  }

  const sectionHead = (label: string, count: number, open: boolean, toggle: () => void, action?: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: open ? 12 : 0, marginTop: 24, cursor: 'pointer', userSelect: 'none' }} onClick={toggle}>
      <span style={{ fontSize: 10, color: '#475569', transition: 'transform .15s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>{'\u25BC'}</span>
      <span style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>{label}</span>
      <span style={{ background: 'rgba(85,243,255,0.08)', color: '#55f3ff', padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>{count}</span>
      <div style={{ flex: 1 }} />
      {action && <div onClick={e => e.stopPropagation()}>{action}</div>}
    </div>
  );

  const card = (s: React.CSSProperties): React.CSSProperties => ({
    background: 'rgba(13,21,40,0.7)', border: '1px solid rgba(140,160,255,0.14)', borderRadius: 12, padding: '12px 16px', ...s,
  });

  const cssKeyframes = `
@keyframes pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(248,113,113,0.5); } 70% { box-shadow: 0 0 0 6px rgba(248,113,113,0); } 100% { box-shadow: 0 0 0 0 rgba(248,113,113,0); } }
@keyframes test-glow { 0%,100% { box-shadow: 0 0 4px rgba(85,243,255,0.3); } 50% { box-shadow: 0 0 12px rgba(85,243,255,0.6); } }
.orbit-test-btn { transition: all .2s; }
.orbit-test-btn:hover { background: rgba(85,243,255,0.12) !important; border-color: rgba(85,243,255,0.5) !important; animation: test-glow 1.5s ease-in-out infinite; transform: translateY(-1px); }
.orbit-test-btn:active { transform: scale(0.96); }
`;

  // Firing count for header
  const firingCount = rules.filter(r => r.state === 'firing' && r.enabled).length;

  return (
    <div>
      <style>{cssKeyframes}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 18, right: 24, zIndex: 9999, padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: toast.ok ? '#052e16' : '#450a0a', color: toast.ok ? '#4ade80' : '#f87171', border: `1px solid ${toast.ok ? '#4ade80' : '#f87171'}`, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', animation: 'fadeIn .2s' }}>
          {toast.msg}
        </div>
      )}

      {/* ══════ TEST MODAL ══════ */}
      {testModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => testModal.status !== 'sending' && setTestModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{ ...card({}), width: '100%', maxWidth: 540, margin: '0 12px', border: `1px solid ${testModal.status === 'ok' ? 'rgba(74,222,128,0.4)' : testModal.status === 'error' ? 'rgba(248,113,113,0.4)' : 'rgba(85,243,255,0.3)'}`, boxSizing: 'border-box' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>{CH_ICONS[testModal.ch.kind] ?? '\u{1F517}'}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0' }}>{t('alerts_test_title')}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{testModal.ch.name} ({testModal.ch.kind})</div>
              </div>
              <div style={{ flex: 1 }} />
              {testModal.status === 'sending' && <span style={{ color: '#55f3ff', fontSize: 12, fontWeight: 600 }}>{t('alerts_test_sending')}</span>}
              {testModal.status === 'ok' && <span style={{ color: '#4ade80', fontSize: 12, fontWeight: 700 }}>{t('alerts_test_result_ok')}</span>}
              {testModal.status === 'error' && <span style={{ color: '#f87171', fontSize: 12, fontWeight: 700 }}>{t('alerts_test_result_fail')}</span>}
            </div>

            {/* Status bar */}
            <div style={{ height: 3, borderRadius: 2, marginBottom: 16, background: testModal.status === 'sending' ? 'linear-gradient(90deg, #55f3ff, #9b7cff, #55f3ff)' : testModal.status === 'ok' ? '#4ade80' : testModal.status === 'error' ? '#f87171' : 'rgba(140,160,255,0.14)', backgroundSize: testModal.status === 'sending' ? '200% 100%' : undefined, animation: testModal.status === 'sending' ? 'shimmer 1.5s ease-in-out infinite' : undefined }} />
            <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>

            {/* Error detail */}
            {testModal.status === 'error' && testModal.error && (
              <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#fca5a5', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {testModal.error}
              </div>
            )}

            {/* Payload preview (always shown, highlighted for webhook) */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('alerts_test_payload')}
                {testModal.ch.kind === 'webhook' && <span style={{ color: '#fdba74', marginLeft: 6, fontWeight: 400, textTransform: 'none' }}>POST {testModal.ch.config?.url ? new URL(testModal.ch.config.url).pathname : '/webhook'}</span>}
              </div>
              <pre style={{
                background: 'rgba(4,7,19,0.6)', border: '1px solid rgba(140,160,255,0.12)', borderRadius: 8,
                padding: 12, fontSize: 11, color: '#a5f3fc', fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                overflow: 'auto', maxHeight: 240, margin: 0, lineHeight: 1.5,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {JSON.stringify(TEST_PAYLOAD, null, 2)}
              </pre>
            </div>

            {/* Channel details */}
            {testModal.ch.kind === 'webhook' && testModal.ch.config?.url && (
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
                <span style={{ color: '#475569' }}>{t('alerts_ch_detail_url')}:</span> <code style={{ color: '#fdba74' }}>{testModal.ch.config.url}</code>
              </div>
            )}
            {testModal.ch.kind === 'telegram' && (
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
                <span style={{ color: '#475569' }}>{t('alerts_ch_detail_chat')}:</span> <code style={{ color: '#60a5fa' }}>{testModal.ch.config?.chat_id ?? '—'}</code>
              </div>
            )}
            {testModal.ch.kind === 'email' && (
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
                <span style={{ color: '#475569' }}>{t('alerts_ch_detail_recipients')}:</span> <code style={{ color: '#a78bfa' }}>{(testModal.ch.config?.recipients ?? []).join(', ') || '—'}</code>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              {(testModal.status === 'idle' || testModal.status === 'ok' || testModal.status === 'error') && (
                <button onClick={() => testChannel(testModal.ch)} style={{ ...S.btn, padding: '8px 20px', fontSize: 13 }}>{t('alerts_test_send')}</button>
              )}
              <div style={{ flex: 1 }} />
              <button onClick={() => setTestModal(null)} disabled={testModal.status === 'sending'} style={{ ...S.btnSm, padding: '8px 14px', fontSize: 12 }}>{t('alerts_test_close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 18, color: '#e2e8f0' }}>{t('nav_alerts')}</span>
        {firingCount > 0 && (
          <span style={{ background: '#450a0a', color: '#f87171', padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, animation: 'pulse-ring 2s infinite' }}>
            {firingCount} FIRING
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => { setShowSmtp(true); if (!smtpLoaded) loadSmtp(); }}
          style={{ ...S.btnSm, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', fontSize: 12, color: '#a78bfa', borderColor: 'rgba(167,139,250,0.3)' }}>
          SMTP
        </button>
      </div>

      {/* ══════ SMTP MODAL ══════ */}
      {showSmtp && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => setShowSmtp(false)}>
          <div onClick={e => e.stopPropagation()} style={{ ...card({}), width: '100%', maxWidth: 440, margin: '0 12px', border: '1px solid rgba(167,139,250,0.3)', boxSizing: 'border-box' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#a78bfa', marginBottom: 14 }}>{t('alerts_smtp_settings')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 10 }}>
              <label style={S.label}>{t('alerts_smtp_host')}<input style={S.input} value={smtp.host} onChange={e => setSmtp(p => ({ ...p, host: e.target.value }))} placeholder="smtp.gmail.com" /></label>
              <label style={S.label}>{t('alerts_smtp_port')}<input style={S.input} value={smtp.port} onChange={e => setSmtp(p => ({ ...p, port: e.target.value }))} placeholder="587" /></label>
              <label style={S.label}>{t('alerts_smtp_user')}<input style={S.input} value={smtp.user} onChange={e => setSmtp(p => ({ ...p, user: e.target.value }))} placeholder="user@domain.com" /></label>
              <label style={S.label}>{t('alerts_smtp_pass')}<input style={S.input} type="password" value={smtp.pass} onChange={e => setSmtp(p => ({ ...p, pass: e.target.value }))} placeholder="********" /></label>
              <label style={S.label}>{t('alerts_smtp_from')}<input style={S.input} value={smtp.from} onChange={e => setSmtp(p => ({ ...p, from: e.target.value }))} placeholder="alerts@orbit-core.local" /></label>
              <label style={{ ...S.label, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                <input type="checkbox" checked={smtp.secure} onChange={e => setSmtp(p => ({ ...p, secure: e.target.checked }))} /> TLS/SSL
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveSmtp} disabled={smtpSaving} style={{ ...S.btn, padding: '8px 20px', fontSize: 13 }}>{smtpSaving ? '...' : t('save')}</button>
              <button onClick={testSmtp} style={{ ...S.btnSm, padding: '8px 14px', fontSize: 12, color: '#55f3ff' }}>{t('alerts_smtp_test')}</button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setShowSmtp(false)} style={{ ...S.btnSm, padding: '8px 14px', fontSize: 12 }}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════ AI ALERT GENERATOR ══════ */}
      <div style={{ ...card({}), marginTop: 16, border: '1px solid rgba(155,124,255,0.25)', background: 'linear-gradient(135deg, rgba(13,21,40,0.8), rgba(30,15,60,0.4))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #9b7cff, #55f3ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#040713' }}>AI</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>{t('alerts_ai_title')}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{t('alerts_ai_subtitle')}</div>
          </div>
        </div>

        {/* Quick suggestions */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            'Monitor CPU > 90% on all hosts',
            'Alert critical Wazuh events',
            'Detect absence of Nagios metrics (10min)',
            'High memory usage alerts',
            'Full monitoring for all assets',
          ].map(s => (
            <button key={s} onClick={() => setAiPrompt(s)}
              style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 500, cursor: 'pointer', transition: 'all .15s',
                background: aiPrompt === s ? 'rgba(155,124,255,0.15)' : 'rgba(4,7,19,0.4)',
                border: `1px solid ${aiPrompt === s ? 'rgba(155,124,255,0.4)' : 'rgba(140,160,255,0.14)'}`,
                color: aiPrompt === s ? '#c4b5fd' : '#64748b',
              }}>
              {s}
            </button>
          ))}
        </div>

        {/* Prompt input */}
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiGenerate(); } }}
            placeholder={t('alerts_ai_placeholder')}
            style={{ ...S.input, flex: 1, height: 48, resize: 'vertical', borderColor: 'rgba(155,124,255,0.25)' }}
          />
          <button onClick={aiGenerate} disabled={aiGenerating || !aiPrompt.trim()}
            style={{ ...S.btn, padding: '12px 20px', fontSize: 13, whiteSpace: 'nowrap', opacity: aiGenerating || !aiPrompt.trim() ? 0.5 : 1,
              background: 'linear-gradient(135deg, rgba(155,124,255,0.3), rgba(85,243,255,0.2))',
              borderColor: 'rgba(155,124,255,0.4)',
            }}>
            {aiGenerating ? t('alerts_ai_generating') : t('alerts_ai_generate')}
          </button>
        </div>

        {/* Generating animation */}
        {aiGenerating && (
          <div style={{ height: 3, borderRadius: 2, marginTop: 12, background: 'linear-gradient(90deg, #9b7cff, #55f3ff, #9b7cff)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite' }} />
        )}

        {/* Error */}
        {aiError && <div style={{ color: '#fca5a5', fontSize: 12, marginTop: 10, padding: '8px 12px', background: 'rgba(248,113,113,0.08)', borderRadius: 8, border: '1px solid rgba(248,113,113,0.2)' }}>{aiError}</div>}

        {/* Preview results */}
        {aiPreview && (
          <div style={{ marginTop: 14 }}>
            {/* Summary */}
            {aiPreview.summary && (
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, padding: '8px 12px', background: 'rgba(155,124,255,0.06)', borderRadius: 8, border: '1px solid rgba(155,124,255,0.15)' }}>
                <span style={{ color: '#c4b5fd', fontWeight: 700, fontSize: 11 }}>{t('alerts_ai_summary')}:</span> {aiPreview.summary}
              </div>
            )}

            {/* Rules preview */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0' }}>{t('alerts_ai_preview')}</span>
              <span style={{ background: 'rgba(155,124,255,0.12)', color: '#c4b5fd', padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>{aiPreview.rules.length}</span>
              <div style={{ flex: 1 }} />
              <button onClick={aiApplyAll} style={{ ...S.btn, padding: '6px 16px', fontSize: 12, background: 'linear-gradient(135deg, rgba(74,222,128,0.2), rgba(85,243,255,0.15))', borderColor: 'rgba(74,222,128,0.4)', color: '#4ade80' }}>
                {t('alerts_ai_apply')}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {aiPreview.rules.map((rule, i) => {
                const applied = aiApplied.has(i);
                const condStr = rule.condition?.kind === 'threshold'
                  ? `${rule.condition.agg ?? 'avg'} ${rule.condition.op} ${rule.condition.value} (${rule.condition.window_min}min)`
                  : `no data ${rule.condition?.window_min ?? '?'}min`;
                return (
                  <div key={i} style={{ ...card({}), borderLeft: `3px solid ${applied ? '#4ade80' : SEV_COLORS[rule.severity] ?? '#55f3ff'}`, opacity: applied ? 0.6 : 1, transition: 'opacity .2s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0' }}>{rule.name}</span>
                      <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{[rule.asset_id, rule.namespace, rule.metric].filter(Boolean).join(' / ') || 'all'}</span>
                      <div style={{ flex: 1 }} />
                      <SevBadge sev={rule.severity ?? 'medium'} />
                      {applied
                        ? <span style={{ color: '#4ade80', fontSize: 11, fontWeight: 700 }}>Applied</span>
                        : <button onClick={() => aiApplyRule(rule, i)} style={{ ...S.btnSm, fontSize: 11, color: '#c4b5fd', borderColor: 'rgba(155,124,255,0.3)' }}>{t('alerts_ai_apply_one')}</button>
                      }
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#7dd3fc' }}>{condStr}</span>
                      {(rule.channels ?? []).map((cid: string) => {
                        const ch = channels.find(c => c.id === cid);
                        const kind = ch?.kind ?? 'webhook';
                        const [, fg] = CH_COLORS[kind] ?? ['', '#fdba74'];
                        return <span key={cid} style={{ fontSize: 10, color: fg, padding: '2px 8px', borderRadius: 6, background: fg + '15', fontWeight: 600 }}>{CH_ICONS[kind]} {cid}</span>;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ══════ CHANNELS ══════ */}
      {sectionHead(t('alerts_subtab_channels').replace(/[^\w\s]/g, '').trim(), channels.length, showChannels, () => setShowChannels(x => !x),
        <button onClick={() => setShowChForm(x => !x)} style={{ ...S.btnSm, padding: '4px 12px', fontSize: 12, color: '#55f3ff', borderColor: 'rgba(85,243,255,0.3)' }}>
          {showChForm ? t('cancel') : t('alerts_new_channel')}
        </button>
      )}
      {showChannels && <>
        {/* Channel form */}
        {showChForm && (
          <div style={{ ...card({}), marginBottom: 14, border: '1px solid rgba(85,243,255,0.25)' }}>
            {/* Type selector */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {(['email', 'telegram', 'webhook'] as const).map(k => {
                const active = cf.kind === k;
                const [bg, fg] = CH_COLORS[k];
                return (
                  <button key={k} onClick={() => setCf(p => ({ ...p, kind: k }))}
                    style={{ flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, transition: 'all .15s',
                      background: active ? bg : 'transparent',
                      border: `1px solid ${active ? fg + '60' : 'rgba(140,160,255,0.14)'}`,
                      color: active ? fg : '#64748b',
                    }}>
                    {CH_ICONS[k]} {k.charAt(0).toUpperCase() + k.slice(1)}
                  </button>
                );
              })}
            </div>
            <div className="orbit-grid-3" style={{ marginBottom: 10 }}>
              <label style={S.label}>{t('name')}<input style={S.input} value={cf.name} onChange={e => { const name = e.target.value; setCf(p => ({ ...p, name, id: slugify(name) })); }} placeholder={cf.kind === 'email' ? 'Email NOC' : cf.kind === 'telegram' ? 'Telegram NOC' : 'Slack Webhook'} /></label>
              {cf.kind === 'email' && <label style={S.label}>{t('alerts_recipients')}<input style={S.input} value={cf.recipients} onChange={e => setCf(p => ({ ...p, recipients: e.target.value }))} placeholder="a@co.com, b@co.com" /></label>}
              {cf.kind === 'telegram' && <label style={S.label}>Bot Token<input style={S.input} value={cf.bot_token} onChange={e => setCf(p => ({ ...p, bot_token: e.target.value }))} placeholder="1234567890:AAH..." /></label>}
              {cf.kind === 'webhook' && <label style={S.label}>URL<input style={S.input} value={cf.url} onChange={e => setCf(p => ({ ...p, url: e.target.value }))} placeholder="https://hooks.slack.com/..." /></label>}
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={S.label}>ID (slug) <span style={{ color: '#475569', fontWeight: 400 }}>— auto</span>
                <input style={{ ...S.input, color: '#64748b' }} value={cf.id} onChange={e => setCf(p => ({ ...p, id: e.target.value }))} placeholder="webhook-n8n" />
              </label>
            </div>
            {cf.kind === 'telegram' && (
              <div style={{ marginBottom: 10 }}>
                <label style={S.label}>Chat ID<input style={S.input} value={cf.chat_id} onChange={e => setCf(p => ({ ...p, chat_id: e.target.value }))} placeholder="-1001234567890" /></label>
              </div>
            )}
            {cf.kind === 'webhook' && cf.url && (
              <div style={{ marginBottom: 10 }}>
                <label style={S.label}>{t('headers_json')}<textarea style={{ ...S.input, height: 50, resize: 'vertical' }} value={cf.headers} onChange={e => setCf(p => ({ ...p, headers: e.target.value }))} placeholder='{"Authorization":"Bearer ..."}' /></label>
              </div>
            )}
            {cf.kind === 'email' && !smtpLoaded && <div style={{ color: '#fbbf24', fontSize: 12, marginBottom: 8 }}>{t('alerts_no_smtp')}</div>}
            <button onClick={saveChannel} style={{ ...S.btn, padding: '8px 20px' }}>{t('alerts_save_channel')}</button>
          </div>
        )}

        {/* Channel cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10, marginBottom: 4 }}>
          {channels.map(ch => {
            const [bg, fg] = CH_COLORS[ch.kind] ?? ['#1c1917', '#fdba74'];
            return (
              <div key={ch.id} style={{ ...card({}), display: 'flex', flexDirection: 'column', gap: 8, transition: 'border-color .15s', position: 'relative' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = fg + '40')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(140,160,255,0.14)')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, fontSize: 16 }}>
                    {CH_ICONS[ch.kind] ?? '\u{1F517}'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{ch.id}</div>
                  </div>
                  <span style={{ background: bg, color: fg, padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>{ch.kind.toUpperCase()}</span>
                </div>
                {/* Channel meta */}
                {ch.config?.url && <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.config.url}</div>}
                {ch.config?.recipients && <div style={{ fontSize: 11, color: '#475569' }}>{(ch.config.recipients as string[]).join(', ')}</div>}
                {ch.config?.chat_id && <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>chat: {ch.config.chat_id}</div>}
                <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                  <button className="orbit-test-btn" onClick={() => { setTestModal({ ch, status: 'idle' }); }} style={{ ...S.btnSm, fontSize: 11, color: '#55f3ff', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    {'\u25B6'} {t('test')}
                  </button>
                  <button onClick={() => deleteChannel(ch.id)} style={{ ...S.btnSm, fontSize: 11, color: '#f87171' }}>{t('remove')}</button>
                </div>
              </div>
            );
          })}
          {channels.length === 0 && <div style={{ color: '#475569', fontSize: 13, padding: 12 }}>{t('alerts_no_channels_list')}</div>}
        </div>
      </>}

      {/* ══════ RULES ══════ */}
      {sectionHead(t('alerts_subtab_rules').replace(/[^\w\s]/g, '').trim(), rules.length, true, () => {},
        <button onClick={() => setShowRuleForm(x => !x)} style={{ ...S.btnSm, padding: '4px 12px', fontSize: 12, color: '#55f3ff', borderColor: 'rgba(85,243,255,0.3)' }}>
          {showRuleForm ? t('cancel') : t('alerts_new_rule')}
        </button>
      )}

      {/* Rule form */}
      {showRuleForm && (
        <div style={{ ...card({}), marginBottom: 14, border: '1px solid rgba(85,243,255,0.25)' }}>
          <div style={{ fontWeight: 700, color: '#55f3ff', marginBottom: 12, fontSize: 14 }}>{t('alerts_form_title')}</div>
          <div className="orbit-grid-4" style={{ marginBottom: 10 }}>
            <label style={S.label}>{t('name')}<input style={S.input} value={rf.name} onChange={e => setRf(p => ({ ...p, name: e.target.value }))} placeholder={t('alerts_name_ph')} /></label>
            <label style={S.label}>Asset
              <select style={S.select} value={rf.asset_id} onChange={e => { setRf(p => ({ ...p, asset_id: e.target.value, namespace: '', metric: '' })); loadMetricsFor(e.target.value); }}>
                <option value="">{t('all')}</option>
                {catAssets.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label style={S.label}>Namespace
              <select style={S.select} value={rf.namespace} onChange={e => setRf(p => ({ ...p, namespace: e.target.value }))}>
                <option value="">{t('all')}</option>
                {Array.from(new Set(catMetrics.map(m => m.namespace))).map(ns => <option key={ns} value={ns}>{ns}</option>)}
              </select>
            </label>
            <label style={S.label}>Metric
              <select style={S.select} value={rf.metric} onChange={e => setRf(p => ({ ...p, metric: e.target.value }))}>
                <option value="">{t('all')}</option>
                {catMetrics.filter(m => !rf.namespace || m.namespace === rf.namespace).map(m => <option key={m.metric} value={m.metric}>{m.metric}</option>)}
              </select>
            </label>
          </div>
          <div className="orbit-grid-4" style={{ marginBottom: 10 }}>
            <label style={S.label}>{t('alerts_cond_type')}
              <select style={S.select} value={rf.condKind} onChange={e => setRf(p => ({ ...p, condKind: e.target.value as any }))}>
                <option value="threshold">{t('alerts_cond_threshold')}</option>
                <option value="absence">{t('alerts_cond_nodata')}</option>
              </select>
            </label>
            {rf.condKind === 'threshold' && <>
              <label style={S.label}>{t('operator')}
                <select style={S.select} value={rf.op} onChange={e => setRf(p => ({ ...p, op: e.target.value }))}>
                  {['>', '>=', '<', '<='].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label style={S.label}>{t('value')}<input style={S.input} type="number" value={rf.condValue} onChange={e => setRf(p => ({ ...p, condValue: e.target.value }))} placeholder="80" /></label>
              <label style={S.label}>{t('alerts_aggregation')}
                <select style={S.select} value={rf.agg} onChange={e => setRf(p => ({ ...p, agg: e.target.value }))}>
                  <option value="avg">avg</option><option value="max">max</option>
                </select>
              </label>
            </>}
            {rf.condKind === 'absence' && <label style={S.label}> </label>}
          </div>
          <div className="orbit-grid-4" style={{ marginBottom: 12 }}>
            <label style={S.label}>{t('alerts_window_min')}<input style={S.input} type="number" value={rf.windowMin} onChange={e => setRf(p => ({ ...p, windowMin: e.target.value }))} placeholder="5" /></label>
            <label style={S.label}>{t('severity')}
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                {(['info','low','medium','high','critical'] as const).map(s => (
                  <button key={s} onClick={() => setRf(p => ({ ...p, severity: s }))}
                    style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all .12s',
                      background: rf.severity === s ? SEV_COLORS[s] + '25' : 'transparent',
                      border: `1px solid ${rf.severity === s ? SEV_COLORS[s] : 'rgba(140,160,255,0.14)'}`,
                      color: rf.severity === s ? SEV_COLORS[s] : '#64748b',
                    }}>{s}</button>
                ))}
              </div>
            </label>
            <label style={{ ...S.label, gridColumn: 'span 2' }}>{t('channels')}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                {channels.length === 0 && <span style={{ color: '#64748b', fontSize: 12 }}>{t('alerts_no_channels')}</span>}
                {channels.map(ch => {
                  const sel = rf.selectedChannels.includes(ch.id);
                  const [, fg] = CH_COLORS[ch.kind] ?? ['', '#fdba74'];
                  return (
                    <button key={ch.id} onClick={() => setRf(p => ({ ...p, selectedChannels: sel ? p.selectedChannels.filter(x => x !== ch.id) : [...p.selectedChannels, ch.id] }))}
                      style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                        background: sel ? fg + '18' : 'transparent', border: `1px solid ${sel ? fg + '50' : 'rgba(140,160,255,0.14)'}`, color: sel ? fg : '#64748b',
                      }}>
                      {CH_ICONS[ch.kind]} {ch.name}
                    </button>
                  );
                })}
              </div>
            </label>
          </div>
          <button onClick={saveRule} style={{ ...S.btn, padding: '8px 20px' }}>{t('alerts_save_rule')}</button>
        </div>
      )}

      {err && <div style={S.err}>{err}</div>}
      {loading && <div style={{ color: '#94a3b8', fontSize: 13, padding: 12 }}>{t('loading')}</div>}

      {/* Rule cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rules.length === 0 && !loading && <div style={{ color: '#475569', fontSize: 13, padding: 12 }}>{t('alerts_no_rules_list')}</div>}
        {rules.map(rule => {
          const isFiring = rule.state === 'firing' && rule.enabled;
          const silenced = rule.silence_until && new Date(rule.silence_until) > new Date();
          const isExp = expandedRuleId === rule.id;
          const borderL = !rule.enabled ? '#334155' : isFiring ? '#f87171' : silenced ? '#fbbf24' : '#4ade80';
          return (
            <div key={rule.id} style={{ ...card({}), borderLeft: `3px solid ${borderL}`, cursor: 'pointer', transition: 'border-color .15s' }} onClick={() => setExpandedRuleId(isExp ? null : rule.id)}>
              {/* Row 1: state + name + target */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {!rule.enabled
                  ? <span style={{ background: '#1e293b', color: '#64748b', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>{t('alerts_state_disabled')}</span>
                  : silenced
                    ? <span style={{ background: '#1c1c1c', color: '#fbbf24', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>{t('alerts_state_silenced')}</span>
                    : isFiring
                      ? <span style={{ background: '#450a0a', color: '#f87171', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, animation: 'pulse-ring 2s infinite' }}>FIRING</span>
                      : <span style={{ background: '#052e16', color: '#4ade80', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>OK</span>
                }
                <span style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>{rule.name}</span>
                <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{[rule.asset_id, rule.namespace, rule.metric].filter(Boolean).join(' / ') || t('all')}</span>
                <div style={{ flex: 1 }} />
                <SevBadge sev={rule.severity} />
              </div>
              {/* Row 2: condition + last value + channels */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#7dd3fc' }}>{condText(rule)}</span>
                {rule.last_value !== null && <span style={{ fontSize: 12, color: '#475569' }}>last: <b style={{ color: '#a5f3fc' }}>{rule.last_value.toFixed(2)}</b></span>}
                <div style={{ flex: 1 }} />
                {rule.channels.map(cid => {
                  const ch = channels.find(c => c.id === cid);
                  const kind = ch?.kind ?? 'webhook';
                  const [, fg] = CH_COLORS[kind] ?? ['', '#fdba74'];
                  return <span key={cid} style={{ fontSize: 10, color: fg, padding: '2px 8px', borderRadius: 6, background: fg + '15', fontWeight: 600 }}>{CH_ICONS[kind]} {cid}</span>;
                })}
                <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => toggleRule(rule)} style={{ ...S.btnSm, color: rule.enabled ? '#4ade80' : '#64748b' }} title={rule.enabled ? t('alerts_btn_toggle_off') : t('alerts_btn_toggle_on')}>{rule.enabled ? '\u25CF' : '\u25CB'}</button>
                  <button onClick={() => silenceRule(rule)} style={S.btnSm} title={t('alerts_btn_silence')}>{'\u{1F515}'}</button>
                  <button onClick={() => deleteRule(rule.id)} style={{ ...S.btnSm, color: '#f87171' }} title={t('remove')}>{'\u2715'}</button>
                </div>
              </div>
              {/* Expanded details */}
              {isExp && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(140,160,255,0.1)', display: 'flex', flexWrap: 'wrap', gap: '4px 20px', fontSize: 11 }}>
                  {([['condition', condText(rule)], ['created', new Date(rule.created_at).toLocaleString()]] as const).map(([k, v]) => (
                    <span key={k}><span style={{ color: '#475569' }}>{k}</span> <code style={{ color: '#cbd5e1' }}>{v}</code></span>
                  ))}
                  {silenced && <span><span style={{ color: '#475569' }}>silenced until</span> <code style={{ color: '#fbbf24' }}>{new Date(rule.silence_until!).toLocaleString()}</code></span>}
                  {rule.fired_at && <span><span style={{ color: '#475569' }}>fired at</span> <code style={{ color: '#f87171' }}>{new Date(rule.fired_at).toLocaleString()}</code></span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ══════ HISTORY ══════ */}
      {sectionHead(t('alerts_subtab_history').replace(/[^\w\s]/g, '').trim(), history.length, showHistory, () => setShowHistory(x => !x),
        <button onClick={loadHistory} style={{ ...S.btnSm, fontSize: 11 }}>{t('reload')}</button>
      )}
      {showHistory && (
        <div style={{ ...card({ padding: 0 }), overflow: 'auto', maxHeight: 300, marginTop: 8 }}>
          <table style={{ ...S.table, tableLayout: 'fixed', minWidth: 480 }}>
            <colgroup>
              <col style={{ width: 130 }} />
              <col style={{ width: 100 }} />
              <col />
              <col style={{ width: '18%' }} />
              <col />
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#0d1224' }}>
              <tr>{[t('alerts_notif_col_time'), t('alerts_notif_col_event'), t('alerts_notif_col_rule'), t('alerts_notif_col_ch'), t('alerts_notif_col_status')].map(h =>
                <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={5} style={{ ...S.td, color: '#64748b', textAlign: 'center', padding: 20 }}>{t('alerts_no_notifs')}</td></tr>}
              {history.map((n, i) => (
                <tr key={n.id} style={{ background: !n.ok ? 'rgba(248,113,113,0.04)' : i % 2 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                  <td style={{ ...S.td, fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{new Date(n.sent_at).toLocaleString()}</td>
                  <td style={S.td}><span style={{ color: n.event === 'firing' ? '#f87171' : '#4ade80', fontWeight: 700, fontSize: 11 }}>{n.event === 'firing' ? 'FIRING' : 'RESOLVED'}</span></td>
                  <td style={{ ...S.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.rule_name ?? n.rule_id}</td>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{n.channel_id}</td>
                  <td style={S.td}>
                    {n.ok ? <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 11 }}>OK</span>
                      : <span style={{ color: '#f87171', fontSize: 11 }} title={n.error ?? ''}>ERROR</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
