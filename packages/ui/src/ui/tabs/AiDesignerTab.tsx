import React from 'react';
import { t } from '../i18n';
import { S, apiHeaders, apiGetHeaders } from '../shared';

type SmartDashboard = {
  id: string; name: string; description: string | null;
  prompt: string; html?: string; metadata: any;
  created_at: string; updated_at: string;
};

function SmartDashboardIframe({ html, timePreset }: { html: string; timePreset: string }) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    const apiKey  = localStorage.getItem('orbit_api_key') ?? '';
    // Strip any filename (*.html) and trailing slashes from pathname to get the app base
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^/]*\.[a-z]+$/i, '').replace(/\/+$/, '');

    const presetMs: Record<string, number> = {
      '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000,
    };
    const rangeMs = presetMs[timePreset] ?? 86400000;
    const to   = new Date().toISOString();
    const from = new Date(Date.now() - rangeMs).toISOString();

    const injection = `<script>
      window.__ORBIT_BASE_URL__ = ${JSON.stringify(baseUrl)};
      window.__ORBIT_API_KEY__  = ${JSON.stringify(apiKey)};
      window.__ORBIT_FROM__     = ${JSON.stringify(from)};
      window.__ORBIT_TO__       = ${JSON.stringify(to)};
    </script>
    <script src="${baseUrl}/orbit-viz.js?v=${Date.now()}"></script>
    <script>
      if (window.OrbitViz) {
        OrbitViz.init({
          baseUrl: ${JSON.stringify(baseUrl + '/api/v1')},
          apiKey:  ${JSON.stringify(apiKey)},
          from:    ${JSON.stringify(from)},
          to:      ${JSON.stringify(to)},
        });
      }
    </script>`;

    const injected = html.replace('</head>', injection + '\n</head>');
    const blob = new Blob([injected], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    setBlobUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [html, timePreset]);

  if (!blobUrl) return null;
  return (
    <iframe
      ref={iframeRef}
      src={blobUrl}
      sandbox="allow-scripts allow-same-origin"
      style={{
        width: '100%', height: 'calc(100vh - 220px)', border: 'none',
        borderRadius: 12, background: '#040713',
      }}
    />
  );
}

export function AiDesignerTab() {
  const [mode, setMode]     = React.useState<'list' | 'create' | 'view'>('list');
  const [dashboards, setDashboards] = React.useState<SmartDashboard[]>([]);
  const [loading, setLoading]       = React.useState(false);
  const [err, setErr]               = React.useState<string | null>(null);

  // Create mode state
  const [prompt, setPrompt]         = React.useState('');
  const [generating, setGenerating] = React.useState(false);
  const [genHtml, setGenHtml]       = React.useState<string | null>(null);
  const [genName, setGenName]       = React.useState('');
  const [genDesc, setGenDesc]       = React.useState('');
  const [genErr, setGenErr]         = React.useState<string | null>(null);
  const [saving, setSaving]         = React.useState(false);

  // View mode state
  const [viewDash, setViewDash]     = React.useState<SmartDashboard | null>(null);
  const [timePreset, setTimePreset] = React.useState('24h');

  const fetchList = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('api/v1/smart-dashboards', { headers: apiGetHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.ok) setDashboards(j.dashboards ?? []);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetchList(); }, [fetchList]);

  async function handleGenerate() {
    const aiKey   = (localStorage.getItem('ai_api_key') ?? '').trim();
    const aiModel = (localStorage.getItem('ai_model') ?? 'claude-sonnet-4-6').trim();
    if (!aiKey) { setGenErr(t('alerts_no_api_key')); return; }
    if (!prompt.trim()) return;

    setGenerating(true); setGenErr(null); setGenHtml(null);
    try {
      const r = await fetch('api/v1/ai/smart-dashboard', {
        method: 'POST',
        headers: { ...apiHeaders(), 'x-ai-key': aiKey, 'x-ai-model': aiModel },
        body: JSON.stringify({ prompt }),
      });
      const text = await r.text();
      let j: any;
      try { j = JSON.parse(text); } catch {
        throw new Error(`Invalid server response (HTTP ${r.status}): ${text.slice(0, 150)}`);
      }
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setGenHtml(j.html);
      setGenName(j.name ?? 'AI Dashboard');
      setGenDesc(j.description ?? prompt);
    } catch (e: any) {
      setGenErr(String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!genHtml) return;
    setSaving(true);
    try {
      const r = await fetch('api/v1/smart-dashboards', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ name: genName, description: genDesc, prompt, html: genHtml }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? 'Save failed');
      setMode('list');
      setGenHtml(null); setPrompt(''); setGenName(''); setGenDesc('');
      fetchList();
    } catch (e: any) {
      setGenErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('aid_confirm_del'))) return;
    await fetch(`api/v1/smart-dashboards/${id}`, { method: 'DELETE', headers: apiGetHeaders() });
    fetchList();
  }

  async function openDashboard(d: SmartDashboard) {
    try {
      const r = await fetch(`api/v1/smart-dashboards/${d.id}`, { headers: apiGetHeaders() });
      const j = await r.json();
      if (j.ok && j.dashboard) {
        setViewDash(j.dashboard);
        setMode('view');
      }
    } catch {}
  }

  const presets = ['1h', '6h', '24h', '7d', '30d'];

  // ── VIEW MODE ──
  if (mode === 'view' && viewDash?.html) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={() => { setMode('list'); setViewDash(null); }}
            style={{ ...S.btnSm, borderColor: 'rgba(85,243,255,.25)', color: '#55f3ff' }}>
            {t('aid_back')}
          </button>
          <h2 style={{ margin: 0, fontSize: 18, color: '#e5e7eb' }}>{viewDash.name}</h2>
          <div style={{ flex: 1 }} />
          {presets.map(p => (
            <button key={p} onClick={() => setTimePreset(p)}
              style={{
                ...S.btnSm,
                background: p === timePreset ? 'rgba(85,243,255,.15)' : 'transparent',
                borderColor: p === timePreset ? '#55f3ff' : 'rgba(255,255,255,.1)',
                color: p === timePreset ? '#55f3ff' : '#9ca3af',
              }}>
              {p}
            </button>
          ))}
        </div>
        <SmartDashboardIframe html={viewDash.html} timePreset={timePreset} />
      </div>
    );
  }

  // ── CREATE MODE ──
  if (mode === 'create') {
    return (
      <div style={{ padding: 20, maxWidth: 1200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button onClick={() => { setMode('list'); setGenHtml(null); setGenErr(null); }}
            style={{ ...S.btnSm, borderColor: 'rgba(85,243,255,.25)', color: '#55f3ff' }}>
            {t('aid_back')}
          </button>
          <h2 style={{ margin: 0, fontSize: 18, color: '#e5e7eb' }}>{t('aid_title')}</h2>
        </div>
        <p style={{ color: '#9ca3af', marginBottom: 16, fontSize: 13 }}>{t('aid_desc')}</p>

        {/* Prompt input */}
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={t('aid_placeholder')}
          rows={3}
          style={{
            width: '100%', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,.1)',
            background: '#0a0e1a', color: '#e5e7eb', fontSize: 14, resize: 'vertical',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={handleGenerate} disabled={generating || !prompt.trim()}
            style={{
              ...S.btnSm, background: 'rgba(85,243,255,.12)', borderColor: '#55f3ff',
              color: '#55f3ff', opacity: generating || !prompt.trim() ? 0.5 : 1,
            }}>
            {generating ? t('aid_generating') : t('aid_generate')}
          </button>
          {genHtml && (
            <button onClick={handleGenerate} disabled={generating}
              style={{ ...S.btnSm, borderColor: 'rgba(155,124,255,.3)', color: '#9b7cff' }}>
              {t('aid_regenerate')}
            </button>
          )}
        </div>

        {genErr && <div style={{ color: '#f87171', marginTop: 12, fontSize: 13 }}>{genErr}</div>}

        {/* Preview */}
        {genHtml && (
          <div style={{ marginTop: 20 }}>
            <h3 style={{ color: '#e5e7eb', fontSize: 15, marginBottom: 8 }}>{t('aid_preview')}</h3>

            {/* Editable name / description */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <input value={genName} onChange={e => setGenName(e.target.value)}
                placeholder={t('name')}
                style={{
                  flex: 1, minWidth: 120, padding: '8px 12px', borderRadius: 8,
                  border: '1px solid rgba(255,255,255,.1)', background: '#0a0e1a',
                  color: '#e5e7eb', fontSize: 14,
                }}
              />
              <input value={genDesc} onChange={e => setGenDesc(e.target.value)}
                placeholder={t('description')}
                style={{
                  flex: 2, minWidth: 120, padding: '8px 12px', borderRadius: 8,
                  border: '1px solid rgba(255,255,255,.1)', background: '#0a0e1a',
                  color: '#e5e7eb', fontSize: 14,
                }}
              />
            </div>

            {/* Time preset selector */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {presets.map(p => (
                <button key={p} onClick={() => setTimePreset(p)}
                  style={{
                    ...S.btnSm,
                    background: p === timePreset ? 'rgba(85,243,255,.15)' : 'transparent',
                    borderColor: p === timePreset ? '#55f3ff' : 'rgba(255,255,255,.1)',
                    color: p === timePreset ? '#55f3ff' : '#9ca3af',
                  }}>
                  {p}
                </button>
              ))}
            </div>

            <SmartDashboardIframe html={genHtml} timePreset={timePreset} />

            <button onClick={handleSave} disabled={saving}
              style={{
                ...S.btnSm, marginTop: 12, background: 'rgba(16,185,129,.12)',
                borderColor: '#10b981', color: '#10b981', opacity: saving ? 0.5 : 1,
              }}>
              {saving ? t('saving') : t('aid_save')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── LIST MODE ──
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, color: '#e5e7eb' }}>{t('aid_title')}</h2>
        <span style={{ color: '#9ca3af', fontSize: 13 }}>{t('aid_desc')}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setMode('create')}
          style={{ ...S.btnSm, background: 'rgba(85,243,255,.12)', borderColor: '#55f3ff', color: '#55f3ff' }}>
          {t('aid_new')}
        </button>
      </div>

      {loading && <div style={{ color: '#9ca3af' }}>{t('loading')}</div>}
      {err && <div style={{ color: '#f87171', fontSize: 13 }}>{err}</div>}

      {!loading && dashboards.length === 0 && (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>{t('aid_no_dashboards')}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 16 }}>
        {dashboards.map(d => (
          <div key={d.id} style={{
            background: '#0a0e1a', border: '1px solid rgba(255,255,255,.06)',
            borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#e5e7eb' }}>{d.name}</div>
            {d.description && <div style={{ fontSize: 12, color: '#9ca3af' }}>{d.description}</div>}
            <div style={{ fontSize: 11, color: '#6b7280' }}>
              {new Date(d.updated_at).toLocaleString()}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => openDashboard(d)}
                style={{ ...S.btnSm, borderColor: 'rgba(85,243,255,.25)', color: '#55f3ff' }}>
                {t('open')}
              </button>
              <button onClick={() => handleDelete(d.id)}
                style={{ ...S.btnSm, borderColor: 'rgba(248,113,113,.25)', color: '#f87171' }}>
                {t('delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
