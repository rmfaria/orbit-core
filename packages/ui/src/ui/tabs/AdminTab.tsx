import React from 'react';
import { t } from '../i18n';
import { S, Tab, apiHeaders, apiGetHeaders } from '../shared';

const codeStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  padding: '1px 5px',
  borderRadius: 4,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
};

const preStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(140,160,255,0.15)',
  borderRadius: 10,
  padding: '12px 14px',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#a5f3fc',
  overflowX: 'auto',
  margin: 0,
  lineHeight: 1.6,
};

export function AdminTab({ setTab }: { setTab: (t: Tab) => void }) {
  const [apiKey, setApiKey]         = React.useState(() => localStorage.getItem('orbit_api_key') ?? '');
  const [saved, setSaved]           = React.useState(false);
  const [apiProtected, setApiProtected] = React.useState<boolean | null>(null);
  const [checking, setChecking]     = React.useState(true);

  React.useEffect(() => {
    setChecking(true);
    // Unauthenticated fetch — no localStorage key used
    fetch('api/v1/catalog/assets?limit=1')
      .then(r => { setApiProtected(r.status === 401); })
      .catch(() => setApiProtected(null))
      .finally(() => setChecking(false));
  }, []);

  function saveKey() {
    localStorage.setItem('orbit_api_key', apiKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div>
      <div style={S.card}>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>{t('admin_title')}</div>
        <div style={{ color: 'rgba(233,238,255,0.78)', fontSize: 13 }}>{t('admin_api_desc')}</div>
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>API Protection</div>
        {checking ? (
          <div style={{ color: '#64748b', fontSize: 13 }}>{t('admin_checking')}</div>
        ) : apiProtected === null ? (
          <div style={{ color: '#f87171', fontSize: 13 }}>{t('admin_api_check_err')}</div>
        ) : apiProtected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
            <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 13 }}>{t('admin_api_protected')}</span>
            <span style={{ color: '#64748b', fontSize: 12 }}>{t('admin_api_server_key')}</span>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f87171', display: 'inline-block' }} />
              <span style={{ color: '#f87171', fontWeight: 700, fontSize: 13 }}>{t('admin_api_open')}</span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{t('admin_api_no_auth')}</span>
            </div>
            <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.7 }}>
              Any request can read and ingest data without authentication.<br />
              {t('admin_api_protect_hint')}{' '}
              <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4 }}>ORBIT_API_KEY</code>
              {' '}{t('admin_api_protect_hint2')}
            </div>
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>API Key (client)</div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
          Key sent in this UI's requests via header <code style={codeStyle}>X-Api-Key</code>.
          Persistida no <code style={codeStyle}>localStorage</code> do browser.
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            placeholder="ORBIT_API_KEY (deixe vazio se sem auth)"
            style={{ ...S.input, flex: 1 }}
          />
          <button onClick={saveKey} style={S.btnSm}>{saved ? t('saved') : t('save')}</button>
        </div>
      </div>

      <LicenseCard />

      <AiConfigCard />
    </div>
  );
}

function LicenseCard() {
  const [info, setInfo] = React.useState<{ status: string; plan: string | null; email: string | null; deployment_id: string | null } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [removing, setRemoving] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  function load() {
    setLoading(true);
    fetch('api/v1/license/status')
      .then(r => r.json())
      .then(j => { if (j.ok) setInfo(j.license); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  React.useEffect(() => { load(); }, []);

  async function removeLicense() {
    setRemoving(true);
    try {
      await fetch('api/v1/license', { method: 'DELETE', headers: apiHeaders() });
      setConfirmRemove(false);
      load();
    } catch {}
    finally { setRemoving(false); }
  }

  const isActive = info?.status === 'valid';
  const isGrace = info?.status === 'grace';

  return (
    <div style={S.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{t('admin_license_title')}</div>
      {loading ? (
        <div style={{ color: '#64748b', fontSize: 13 }}>{t('admin_checking')}</div>
      ) : !info ? (
        <div style={{ color: '#f87171', fontSize: 13 }}>{t('admin_license_error')}</div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: isActive ? '#4ade80' : isGrace ? '#55f3ff' : '#f87171', display: 'inline-block' }} />
            <span style={{ color: isActive ? '#4ade80' : isGrace ? '#55f3ff' : '#f87171', fontWeight: 700, fontSize: 13 }}>
              {isActive ? t('license_valid') : isGrace ? t('license_grace') : t('license_expired')}
            </span>
          </div>
          {isActive && (
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.8 }}>
              <div><strong style={{ color: '#e9eeff' }}>Plan:</strong> {info.plan}</div>
              <div><strong style={{ color: '#e9eeff' }}>Email:</strong> {info.email}</div>
              <div><strong style={{ color: '#e9eeff' }}>Deployment ID:</strong> <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{info.deployment_id}</code></div>
            </div>
          )}
          {isGrace && (
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.8 }}>
              <div>{t('admin_license_no_key')}</div>
              <a href="https://orbit-core.org/register.html" target="_blank" rel="noreferrer" style={{ color: '#55f3ff', fontSize: 12 }}>{t('license_get_free')}</a>
            </div>
          )}
          {isActive && (
            <div style={{ marginTop: 14 }}>
              {!confirmRemove ? (
                <button onClick={() => setConfirmRemove(true)} style={{ ...S.btnSm, borderColor: 'rgba(248,113,113,0.4)', color: '#f87171', background: 'rgba(248,113,113,0.08)' }}>{t('admin_license_remove')}</button>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: '#f87171', fontSize: 12 }}>{t('admin_license_confirm')}</span>
                  <button onClick={removeLicense} disabled={removing} style={{ ...S.btnSm, borderColor: 'rgba(248,113,113,0.6)', color: '#f87171', background: 'rgba(248,113,113,0.15)' }}>{removing ? '...' : t('confirm')}</button>
                  <button onClick={() => setConfirmRemove(false)} style={S.btnSm}>{t('cancel')}</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AiConfigCard() {
  const [aiKey,   setAiKey]   = React.useState(() => localStorage.getItem('ai_api_key') ?? '');
  const [aiModel, setAiModel] = React.useState(() => localStorage.getItem('ai_model') ?? 'claude-sonnet-4-6');
  const [saved,   setSaved]   = React.useState(false);

  function save() {
    localStorage.setItem('ai_api_key', aiKey.trim());
    localStorage.setItem('ai_model',   aiModel.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div style={S.card}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>AI Agent — Dashboard Builder</div>
      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12, lineHeight: 1.7 }}>
        API key and model used by the AI agent to generate dashboards automatically.
        Stored in <code style={codeStyle}>localStorage</code> — sent via headers <code style={codeStyle}>X-Ai-Key</code> / <code style={codeStyle}>X-Ai-Model</code>.
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={S.label}>
          Anthropic API Key
          <input
            type="password"
            value={aiKey}
            onChange={e => setAiKey(e.target.value)}
            placeholder="sk-ant-..."
            style={{ ...S.input, width: 280 }}
          />
        </label>
        <label style={S.label}>
          Model
          <select value={aiModel} onChange={e => setAiModel(e.target.value)} style={S.select}>
            <option value="claude-opus-4-6">claude-opus-4-6</option>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6 (recommended)</option>
            <option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001</option>
          </select>
        </label>
        <button onClick={save} style={S.btnSm}>{saved ? t('saved') : t('save')}</button>
      </div>
    </div>
  );
}
