import React from 'react';
import { t } from '../i18n';
import { S, Tab, apiHeaders, apiGetHeaders, fmtTs } from '../shared';
import { SourcesTab } from './SourcesTab';

// ─── CONNECTORS TAB ───────────────────────────────────────────────────────────

type Connector = {
  id: string; source_id: string; mode: 'push' | 'pull'; type: 'metric' | 'event';
  spec: object; status: 'draft' | 'approved' | 'disabled'; auto: boolean;
  description: string | null; pull_url: string | null; pull_interval_min: number;
  created_at: string; updated_at: string;
};
type ConnectorRun = {
  id: string; source_id: string; started_at: string; finished_at: string | null;
  status: 'ok' | 'error'; ingested: number; raw_size: number | null; error: string | null;
};

const CONNECTOR_TEMPLATES: {
  id: string; name: string; source_id: string; mode: 'push' | 'pull'; type: 'metric' | 'event';
  description: string; spec: object; pull_url?: string; pull_interval_min?: string;
}[] = [
  {
    id: 'nagios-metrics', name: 'Nagios Metrics', source_id: 'nagios', mode: 'push', type: 'metric',
    description: 'Performance data (CPU, disk, memory) from Nagios perfdata output',
    spec: { type: 'metric', items_path: 'metrics', mappings: { ts: { path: '$.timestamp', transform: 'iso8601' }, asset_id: { path: '$.host' }, namespace: { value: 'nagios' }, metric: { path: '$.metric' }, value: { path: '$.value', transform: 'number' }, unit: { path: '$.unit' } } },
  },
  {
    id: 'nagios-events', name: 'Nagios Events', source_id: 'nagios', mode: 'push', type: 'event',
    description: 'Host/service state changes, notifications and alerts',
    spec: { type: 'event', items_path: 'events', mappings: { ts: { path: '$.timestamp' }, asset_id: { path: '$.host' }, namespace: { value: 'nagios' }, kind: { path: '$.state' }, severity: { path: '$.state_type', transform: 'severity_map' }, title: { path: '$.service_description' }, message: { path: '$.plugin_output' }, fingerprint: { path: '$.id' } } },
  },
  {
    id: 'wazuh-alerts', name: 'Wazuh Alerts', source_id: 'wazuh', mode: 'push', type: 'event',
    description: 'Security alerts, rule matches and audit logs from Wazuh/OSSEC',
    spec: { type: 'event', items_path: 'alerts', mappings: { ts: { path: '$.timestamp' }, asset_id: { path: '$.agent.name' }, namespace: { value: 'wazuh' }, kind: { path: '$.rule.description' }, severity: { path: '$.rule.level', transform: 'severity_map' }, title: { path: '$.rule.description' }, message: { path: '$.full_log' }, fingerprint: { path: '$.id' } } },
  },
  {
    id: 'fortigate-logs', name: 'Fortigate Logs', source_id: 'fortigate', mode: 'push', type: 'event',
    description: 'Firewall traffic, UTM and system logs via syslog',
    spec: { type: 'event', items_path: 'logs', mappings: { ts: { path: '$.timestamp' }, asset_id: { path: '$.devname' }, namespace: { value: 'fortigate' }, kind: { path: '$.type' }, severity: { path: '$.level', transform: 'severity_map' }, title: { path: '$.action' }, message: { path: '$.msg' }, fingerprint: { path: '$.logid' } } },
  },
  {
    id: 'n8n-workflows', name: 'n8n Workflows', source_id: 'n8n', mode: 'push', type: 'event',
    description: 'Failed and stuck workflow executions from n8n Error Trigger',
    spec: { type: 'event', items_path: 'events', mappings: { ts: { path: '$.timestamp' }, asset_id: { value: 'n8n' }, namespace: { value: 'n8n' }, kind: { path: '$.workflow.name' }, severity: { value: 'high' }, title: { path: '$.error.message' }, message: { path: '$.error.stack' }, fingerprint: { path: '$.execution.id' } } },
  },
  {
    id: 'otel-metrics', name: 'OTel Metrics', source_id: 'otel', mode: 'push', type: 'metric',
    description: 'OpenTelemetry metrics via OTLP/HTTP protocol',
    spec: { type: 'metric', items_path: 'resourceMetrics[*].scopeMetrics[*].metrics[*]', mappings: { ts: { path: '$.dataPoints[0].timeUnixNano', transform: 'nano_to_iso' }, asset_id: { path: '$.resource.attributes[?(@.key=="host.name")].value.stringValue' }, namespace: { value: 'otel' }, metric: { path: '$.name' }, value: { path: '$.dataPoints[0].asDouble', transform: 'number' }, unit: { path: '$.unit' } } },
  },
  {
    id: 'otel-traces', name: 'OTel Traces', source_id: 'otel', mode: 'push', type: 'event',
    description: 'OpenTelemetry spans/traces via OTLP/HTTP protocol',
    spec: { type: 'event', items_path: 'resourceSpans[*].scopeSpans[*].spans[*]', mappings: { ts: { path: '$.startTimeUnixNano', transform: 'nano_to_iso' }, asset_id: { path: '$.resource.attributes[?(@.key=="service.name")].value.stringValue' }, namespace: { value: 'otel' }, kind: { path: '$.name' }, severity: { path: '$.status.code', transform: 'severity_map' }, title: { path: '$.name' }, message: { path: '$.status.message' }, fingerprint: { path: '$.traceId' } } },
  },
  {
    id: 'zabbix-metrics', name: 'Zabbix Metrics', source_id: 'zabbix', mode: 'pull', type: 'metric',
    description: 'Host metrics from Zabbix API (history.get)',
    pull_url: 'http://zabbix-server/api_jsonrpc.php', pull_interval_min: '5',
    spec: { type: 'metric', items_path: 'result', mappings: { ts: { path: '$.clock', transform: 'unix_to_iso' }, asset_id: { path: '$.host' }, namespace: { value: 'zabbix' }, metric: { path: '$.key_' }, value: { path: '$.value', transform: 'number' }, unit: { value: '' } } },
  },
  {
    id: 'openclaw-events', name: 'OpenClaw Events', source_id: 'openclaw', mode: 'push', type: 'event',
    description: 'Commercial pipeline events — leads, proposals, contracts and revenue updates',
    spec: { type: 'event', items_path: 'events', mappings: { ts: { path: '$.timestamp', transform: 'iso8601' }, asset_id: { path: '$.account_id' }, namespace: { value: 'openclaw' }, kind: { path: '$.event_type' }, severity: { path: '$.priority', transform: 'severity_map' }, title: { path: '$.title' }, message: { path: '$.description' }, fingerprint: { path: '$.id' } } },
  },
  {
    id: 'openclaw-metrics', name: 'OpenClaw Metrics', source_id: 'openclaw', mode: 'push', type: 'metric',
    description: 'Sales KPIs — MRR, deal value, conversion rates, pipeline velocity',
    spec: { type: 'metric', items_path: 'metrics', mappings: { ts: { path: '$.timestamp', transform: 'iso8601' }, asset_id: { path: '$.account_id' }, namespace: { value: 'openclaw' }, metric: { path: '$.metric' }, value: { path: '$.value', transform: 'number' }, unit: { path: '$.unit' } } },
  },
  {
    id: 'generic-metric', name: 'Generic Metric', source_id: 'custom', mode: 'push', type: 'metric',
    description: 'Generic template for any JSON metric source',
    spec: { type: 'metric', items_path: 'data.items', mappings: { ts: { path: '$.timestamp', transform: 'iso8601' }, asset_id: { path: '$.host', default: 'unknown' }, namespace: { value: 'my-source' }, metric: { path: '$.metric_name' }, value: { path: '$.value', transform: 'number' }, unit: { path: '$.unit' } } },
  },
  {
    id: 'generic-event', name: 'Generic Event', source_id: 'custom', mode: 'push', type: 'event',
    description: 'Generic template for any JSON event source',
    spec: { type: 'event', items_path: 'alerts', mappings: { ts: { path: '$.timestamp' }, asset_id: { path: '$.host' }, namespace: { value: 'my-source' }, kind: { path: '$.rule.name' }, severity: { path: '$.level', transform: 'severity_map' }, title: { path: '$.rule.name' }, message: { path: '$.full_log' }, fingerprint: { path: '$.id' } } },
  },
];

const SPEC_TEMPLATE_METRIC = `{
  "type": "metric",
  "items_path": "data.items",
  "mappings": {
    "ts":        { "path": "$.timestamp", "transform": "iso8601" },
    "asset_id":  { "path": "$.host", "default": "unknown" },
    "namespace": { "value": "my-source" },
    "metric":    { "path": "$.metric_name" },
    "value":     { "path": "$.value", "transform": "number" },
    "unit":      { "path": "$.unit" }
  }
}`;

const SPEC_TEMPLATE_EVENT = `{
  "type": "event",
  "items_path": "alerts",
  "mappings": {
    "ts":          { "path": "$.timestamp" },
    "asset_id":    { "path": "$.host" },
    "namespace":   { "value": "my-source" },
    "kind":        { "path": "$.rule.name" },
    "severity":    { "path": "$.level", "transform": "severity_map" },
    "title":       { "path": "$.rule.name" },
    "message":     { "path": "$.full_log" },
    "fingerprint": { "path": "$.id" }
  }
}`;

function statusBadge(status: string) {
  const cfg: Record<string, { bg: string; fg: string; label: string }> = {
    approved: { bg: '#052e16', fg: '#4ade80', label: 'APROVADO' },
    draft:    { bg: '#451a03', fg: '#fbbf24', label: 'DRAFT' },
    disabled: { bg: '#1e293b', fg: '#64748b', label: 'DESATIV.' },
  };
  const c = cfg[status] ?? cfg.draft;
  return <span style={{ background: c.bg, color: c.fg, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{c.label}</span>;
}

function modeBadge(mode: string) {
  return <span style={{ background: mode === 'pull' ? '#1e1040' : '#0c1a3a', color: mode === 'pull' ? '#a78bfa' : '#38bdf8', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{mode.toUpperCase()}</span>;
}

export function ConnectorsTab({ setTab }: { setTab: (t: Tab) => void }) {
  const [subtab, setSubtab] = React.useState<'list' | 'create' | 'ai' | 'plugin' | 'sources' | 'templates'>('list');
  const [connectors, setConnectors] = React.useState<Connector[]>([]);
  const [loading, setLoading]       = React.useState(false);
  const [err, setErr]               = React.useState<string | null>(null);
  const [toast, setToast]           = React.useState<{ msg: string; ok: boolean } | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [runs, setRuns]             = React.useState<ConnectorRun[]>([]);
  const [runsLoading, setRunsLoading] = React.useState(false);

  // ── Test panel (dry-run, pull) ──
  const [testId, setTestId]           = React.useState<string | null>(null);
  const [testPayload, setTestPayload] = React.useState('');
  const [testLoading, setTestLoading] = React.useState(false);
  const [testResult, setTestResult]   = React.useState<any>(null);
  const [testErr, setTestErr]         = React.useState<string | null>(null);

  // ── Push panel (real ingest, push connectors) ──
  const [pushId, setPushId]           = React.useState<string | null>(null);
  const [pushPayload, setPushPayload] = React.useState('');
  const [pushLoading, setPushLoading] = React.useState(false);
  const [pushResult, setPushResult]   = React.useState<any>(null);
  const [pushErr, setPushErr]         = React.useState<string | null>(null);
  const [pushCopied, setPushCopied]   = React.useState(false);

  // ── Create form ──
  const [cf, setCf] = React.useState({
    id: '', source_id: '', mode: 'push', type: 'metric', description: '',
    pull_url: '', pull_interval_min: '5', spec: SPEC_TEMPLATE_METRIC,
  });

  // ── AI Generate form ──
  const [af, setAf] = React.useState({
    aiKey:      localStorage.getItem('orbit_ai_key') ?? '',
    aiModel:    'claude-sonnet-4-6',
    sourceType: '',
    type:       '',
    id:         '',
    description: '',
    payload:    '',
  });
  const [aiLoading, setAiLoading]   = React.useState(false);
  const [aiResult, setAiResult]     = React.useState<{ id: string; source_id: string; spec: object; next_step: string } | null>(null);
  const [aiErr, setAiErr]           = React.useState<string | null>(null);

  // ── Template download ──
  const [selectedTemplate, setSelectedTemplate] = React.useState<typeof CONNECTOR_TEMPLATES[number] | null>(null);

  // ── Plugin Generator form ──
  const [pf, setPf] = React.useState({
    aiKey:       localStorage.getItem('orbit_ai_key') ?? '',
    aiModel:     'claude-sonnet-4-6',
    description: '',
  });
  const [pluginLoading, setPluginLoading]                                                          = React.useState(false);
  const [pluginResult, setPluginResult] = React.useState<{ connector_spec: object; agent_script: string; readme: string } | null>(null);
  const [pluginErr, setPluginErr]       = React.useState<string | null>(null);

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('api/v1/connectors', { headers: apiGetHeaders() });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setConnectors(j.connectors);
    } catch (e: any) { setErr(String(e)); } finally { setLoading(false); }
  }

  React.useEffect(() => { load(); }, []);

  async function approve(id: string) {
    await fetch(`api/v1/connectors/${id}/approve`, { method: 'POST', headers: apiHeaders() });
    showToast('Connector approved!', true); load();
  }
  async function disable(id: string) {
    await fetch(`api/v1/connectors/${id}/disable`, { method: 'POST', headers: apiHeaders() });
    showToast('Connector disabled', true); load();
  }
  async function del(id: string) {
    if (!confirm(`Remover connector "${id}"?`)) return;
    await fetch(`api/v1/connectors/${id}`, { method: 'DELETE', headers: apiGetHeaders() });
    showToast('Removed', true); load();
  }

  async function toggleRuns(conn: Connector) {
    if (expandedId === conn.id) { setExpandedId(null); return; }
    setExpandedId(conn.id); setRunsLoading(true);
    try {
      const r = await fetch(`api/v1/connectors/${conn.id}/runs`, { headers: apiGetHeaders() });
      const j = await r.json();
      setRuns(j.ok ? j.runs : []);
    } catch { setRuns([]); } finally { setRunsLoading(false); }
  }

  function toggleTest(c: Connector) {
    if (testId === c.id) { setTestId(null); setTestResult(null); setTestErr(null); return; }
    setTestId(c.id); setTestPayload(''); setTestResult(null); setTestErr(null);
  }

  async function runTest(c: Connector) {
    setTestLoading(true); setTestResult(null); setTestErr(null);
    try {
      const body: any = {};
      if (testPayload.trim()) {
        try { body.payload = JSON.parse(testPayload); } catch { setTestErr('Invalid JSON'); setTestLoading(false); return; }
      }
      const r = await fetch(`api/v1/connectors/${c.id}/test`, {
        method: 'POST', headers: apiHeaders(), body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setTestResult(j);
    } catch (e: any) { setTestErr(String(e)); } finally { setTestLoading(false); }
  }

  function togglePush(c: Connector) {
    if (pushId === c.id) { setPushId(null); setPushResult(null); setPushErr(null); return; }
    setPushId(c.id); setPushPayload(''); setPushResult(null); setPushErr(null); setPushCopied(false);
  }

  async function runPush(c: Connector) {
    if (!pushPayload.trim()) { setPushErr('Enter the JSON payload'); return; }
    let payloadObj: unknown;
    try { payloadObj = JSON.parse(pushPayload); } catch { setPushErr('Invalid JSON'); return; }
    setPushLoading(true); setPushResult(null); setPushErr(null);
    try {
      const r = await fetch(`api/v1/ingest/raw/${encodeURIComponent(c.source_id)}`, {
        method: 'POST', headers: apiHeaders(), body: JSON.stringify(payloadObj),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setPushResult(j);
    } catch (e: any) { setPushErr(String(e)); } finally { setPushLoading(false); }
  }

  function curlExample(c: Connector): string {
    const base = `${window.location.origin}/orbit-core`;
    const key  = localStorage.getItem('orbit_api_key') ?? 'YOUR_API_KEY';
    const body = pushPayload.trim() || '{"your": "payload"}';
    return [
      `curl -s -X POST '${base}/api/v1/ingest/raw/${c.source_id}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      key !== 'YOUR_API_KEY' ? `  -H 'X-Api-Key: ${key}' \\` : `  -H 'X-Api-Key: YOUR_API_KEY' \\`,
      `  -d '${body}'`,
    ].join('\n');
  }

  async function create() {
    let specObj: unknown;
    try { specObj = JSON.parse(cf.spec); } catch (e) { showToast(`Invalid Spec JSON: ${(e as Error).message}`, false); return; }
    const body: any = {
      id: cf.id, source_id: cf.source_id || cf.id, mode: cf.mode,
      type: cf.type, spec: specObj,
      pull_interval_min: parseInt(cf.pull_interval_min) || 5,
    };
    if (cf.description) body.description = cf.description;
    if (cf.mode === 'pull' && cf.pull_url) body.pull_url = cf.pull_url;
    const r = await fetch('api/v1/connectors', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) { showToast('Error: ' + JSON.stringify(j.error), false); return; }
    showToast('Connector saved as draft!', true);
    setCf({ id: '', source_id: '', mode: 'push', type: 'metric', description: '', pull_url: '', pull_interval_min: '5', spec: SPEC_TEMPLATE_METRIC });
    setSubtab('list'); load();
  }

  async function pluginGenerate() {
    const aiKey = pf.aiKey.trim();
    if (!aiKey) { setPluginErr('Enter the Anthropic API Key'); return; }
    if (!pf.description.trim()) { setPluginErr('Descreva a fonte de dados'); return; }
    localStorage.setItem('orbit_ai_key', aiKey);
    setPluginLoading(true); setPluginErr(null); setPluginResult(null);
    try {
      const r = await fetch('api/v1/ai/plugin', {
        method: 'POST',
        headers: { ...apiHeaders(), 'x-ai-key': aiKey, 'x-ai-model': pf.aiModel.trim() },
        body: JSON.stringify({ description: pf.description }),
      });
      const text = await r.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Invalid response (HTTP ${r.status}): ${text.slice(0, 200)}`); }
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setPluginResult({ connector_spec: j.connector_spec, agent_script: j.agent_script, readme: j.readme });
    } catch (e: any) { setPluginErr(String(e)); } finally { setPluginLoading(false); }
  }

  function downloadText(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function generateTemplateReadme(tmpl: typeof CONNECTOR_TEMPLATES[number]): string {
    const specJson = JSON.stringify(tmpl.spec, null, 2);
    const flow = tmpl.mode === 'push'
      ? `${tmpl.source_id} --> POST /api/v1/ingest/raw/${tmpl.source_id} --> orbit-core`
      : `orbit-core pulls from ${tmpl.pull_url || '<pull-url>'} every ${tmpl.pull_interval_min || '5'} min`;
    return `# ${tmpl.name} → orbit-core

**Mode:** ${tmpl.mode} | **Type:** ${tmpl.type}

${tmpl.description}

## Data Flow

\`\`\`
${flow}
\`\`\`

## 1 — Import connector spec

### Via UI
1. Go to **Connectors → Create** in the orbit-core UI
2. Set **ID** to \`${tmpl.id}\` and **Source ID** to \`${tmpl.source_id}\`
3. Paste the contents of \`connector_spec.json\` into the **Spec DSL** field
4. Click **Save as Draft**, then **Approve**

### Via API
\`\`\`bash
curl -X POST \$ORBIT_URL/api/v1/connectors \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: \$ORBIT_API_KEY" \\
  -d '{
    "id": "${tmpl.id}",
    "source_id": "${tmpl.source_id}",
    "mode": "${tmpl.mode}",
    "type": "${tmpl.type}",
    "spec": ${specJson}
  }'

# Approve the connector
curl -X POST \$ORBIT_URL/api/v1/connectors/${tmpl.id}/approve \\
  -H "X-Api-Key: \$ORBIT_API_KEY"
\`\`\`

## 2 — Configure agent

Set these environment variables on the host running the collection agent:

| Variable | Description |
|----------|-------------|
| \`ORBIT_URL\` | orbit-core API base URL (e.g. \`https://orbit.example.com\`) |
| \`ORBIT_API_KEY\` | API key for authentication |
| \`ORBIT_SOURCE_ID\` | \`${tmpl.source_id}\` |
${tmpl.mode === 'push' ? `
### Sending data (push mode)

\`\`\`bash
curl -X POST \$ORBIT_URL/api/v1/ingest/raw/${tmpl.source_id} \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: \$ORBIT_API_KEY" \\
  -d '{ ... your ${tmpl.source_id} payload ... }'
\`\`\`
` : `
### Pull mode

orbit-core will automatically fetch data from the configured pull URL every ${tmpl.pull_interval_min || '5'} minutes.
`}
## 3 — Verify

\`\`\`bash
# Check connector status
curl -s -H "X-Api-Key: \$ORBIT_API_KEY" \\
  \$ORBIT_URL/api/v1/connectors/${tmpl.id}

# Query recent data
curl -s -H "X-Api-Key: \$ORBIT_API_KEY" \\
  -X POST \$ORBIT_URL/api/v1/query \\
  -H "Content-Type: application/json" \\
  -d '{
    "kind": "${tmpl.type === 'metric' ? 'metrics' : 'events'}",
    "namespace": "${(tmpl.spec as any).mappings?.namespace?.value || tmpl.source_id}",
    "limit": 5
  }'
\`\`\`

## Spec Reference

\`\`\`json
${specJson}
\`\`\`

---
Generated by orbit-core Templates
`;
  }

  async function aiGenerate() {
    if (!af.aiKey) { setAiErr('Enter the Anthropic API Key'); return; }
    let payloadObj: unknown;
    try { payloadObj = JSON.parse(af.payload); } catch { setAiErr('Invalid Payload JSON'); return; }
    localStorage.setItem('orbit_ai_key', af.aiKey);
    setAiLoading(true); setAiErr(null); setAiResult(null);
    try {
      const body: any = { payload: payloadObj };
      if (af.sourceType) body.source_type = af.sourceType;
      if (af.type)       body.type        = af.type;
      if (af.id)         body.id          = af.id;
      if (af.description) body.description = af.description;
      const r = await fetch('api/v1/connectors/generate', {
        method: 'POST',
        headers: { ...apiHeaders(), 'x-ai-key': af.aiKey, 'x-ai-model': af.aiModel },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? JSON.stringify(j));
      setAiResult({ id: j.id, source_id: j.source_id, spec: j.spec, next_step: j.next_step });
    } catch (e: any) { setAiErr(String(e)); } finally { setAiLoading(false); }
  }

  const subtabBtn = (t: 'list' | 'create' | 'ai' | 'plugin' | 'sources' | 'templates', label: string) => (
    <button onClick={() => setSubtab(t)} style={{
      background: subtab === t ? 'rgba(85,243,255,0.15)' : 'transparent',
      border: subtab === t ? '1px solid rgba(85,243,255,0.4)' : '1px solid transparent',
      borderRadius: 8, color: subtab === t ? '#55f3ff' : '#94a3b8',
      padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    }}>{label}</button>
  );

  return (
    <div>
      {toast && (
        <div style={{ position: 'fixed', top: 18, right: 24, zIndex: 9999, padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: toast.ok ? '#052e16' : '#450a0a', color: toast.ok ? '#4ade80' : '#f87171', border: `1px solid ${toast.ok ? '#4ade80' : '#f87171'}`, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
          {toast.msg}
        </div>
      )}

      {/* ── Subtab bar ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' as const }}>
        {subtabBtn('list',      t('conn_title'))}
        {subtabBtn('sources',   t('conn_subtab_sources'))}
        {subtabBtn('templates', t('conn_subtab_templates'))}
        {subtabBtn('create',    '+ Criar')}
        {subtabBtn('ai',        '✨ Generate with AI')}
        {subtabBtn('plugin',    '⬇ Plugin AI')}
      </div>

      {/* ── LIST ── */}
      {subtab === 'list' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>{connectors.length} connector(s)</span>
            <button onClick={load} style={{ ...S.btnSm, fontSize: 12 }}>{t('reload')}</button>
          </div>
          {err && <div style={S.err}>{err}</div>}
          {loading && <div style={{ color: '#94a3b8', fontSize: 13 }}>Carregando…</div>}
          {!loading && connectors.length === 0 && (
            <div style={{ ...S.card, textAlign: 'center', color: '#64748b', padding: 40 }}>
              No connectors. Create one manually or use <strong>✨ Generate with AI</strong>.
            </div>
          )}
          {connectors.map(c => (
            <div key={c.id} style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
              {/* Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', flexWrap: 'wrap' as const }}>
                {/* expand toggle */}
                <button onClick={() => toggleRuns(c)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14, padding: '2px 6px', borderRadius: 4 }} title="Ver runs">
                  {expandedId === c.id ? '▼' : '▶'}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#e9eeff' }}>{c.id}</span>
                    {modeBadge(c.mode)}
                    <span style={{ background: '#0f172a', color: '#94a3b8', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{c.type.toUpperCase()}</span>
                    {statusBadge(c.status)}
                    {c.auto && <span style={{ background: '#1a1540', color: '#c084fc', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>✨ AI</span>}
                  </div>
                  {c.description && <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{c.description}</div>}
                  <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>
                    source: <code style={{ color: '#7dd3fc' }}>{c.source_id}</code>
                    {c.mode === 'pull' && c.pull_url && <> · pull: <code style={{ color: '#a78bfa' }}>{c.pull_url}</code> ({c.pull_interval_min}min)</>}
                    {c.mode === 'push' && <> · webhook: <code style={{ color: '#34d399' }}>/api/v1/ingest/raw/{c.source_id}</code></>}
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {(c.status === 'draft' || c.status === 'disabled') && (
                    <button onClick={() => approve(c.id)} style={{ ...S.btnSm, color: '#4ade80', borderColor: 'rgba(74,222,128,0.35)' }} title={t('conn_approve')}>{t('conn_approve')}</button>
                  )}
                  {c.status === 'approved' && (
                    <button onClick={() => disable(c.id)} style={{ ...S.btnSm, color: '#94a3b8' }} title={t('conn_btn_disable_tt')}>{t('conn_btn_disable')}</button>
                  )}
                  {c.mode === 'push' && (
                    <button onClick={() => togglePush(c)} style={{ ...S.btnSm, color: '#34d399', borderColor: 'rgba(52,211,153,0.30)', background: pushId === c.id ? 'rgba(52,211,153,0.10)' : 'transparent' }} title={t('conn_btn_push_tt')}>📤 Push</button>
                  )}
                  <button onClick={() => toggleTest(c)} style={{ ...S.btnSm, color: '#fbbf24', borderColor: 'rgba(251,191,36,0.30)', background: testId === c.id ? 'rgba(251,191,36,0.10)' : 'transparent' }} title={t('conn_btn_test_tt')}>{t('conn_btn_test')}</button>
                  <button onClick={() => del(c.id)} style={{ ...S.btnSm, color: '#f87171', borderColor: 'rgba(248,113,113,0.30)' }} title={t('remove')}>🗑</button>
                </div>
              </div>

              {/* Runs panel */}
              {expandedId === c.id && (
                <div style={{ borderTop: '1px solid rgba(140,160,255,0.12)', padding: '12px 16px', background: 'rgba(4,7,19,0.4)' }}>
                  <div style={{ color: '#55f3ff', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t('conn_runs_history')}</div>
                  {runsLoading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Carregando…</div>}
                  {!runsLoading && runs.length === 0 && <div style={{ color: '#475569', fontSize: 12 }}>{t('conn_no_runs')}</div>}
                  {!runsLoading && runs.length > 0 && (
                    <table style={{ ...S.table, fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={S.th}>{t('conn_runs_start')}</th>
                          <th style={S.th}>Status</th>
                          <th style={S.th}>{t('conn_runs_ingested')}</th>
                          <th style={S.th}>Raw Size</th>
                          <th style={S.th}>{t('conn_runs_duration')}</th>
                          <th style={S.th}>{t('conn_runs_error')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runs.map(r => {
                          const dur = r.finished_at ? Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime())) : null;
                          return (
                            <tr key={r.id}>
                              <td style={S.td}>{fmtTs(r.started_at)}</td>
                              <td style={S.td}>
                                {r.status === 'ok'
                                  ? <span style={{ color: '#4ade80', fontWeight: 700 }}>✓ ok</span>
                                  : <span style={{ color: '#f87171', fontWeight: 700 }}>✗ error</span>
                                }
                              </td>
                              <td style={S.td}>{r.ingested}</td>
                              <td style={S.td}>{r.raw_size ? `${r.raw_size}b` : '—'}</td>
                              <td style={S.td}>{dur !== null ? `${dur}ms` : '—'}</td>
                              <td style={{ ...S.td, color: '#f87171', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{r.error ?? '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Push panel */}
              {pushId === c.id && (
                <div style={{ borderTop: '1px solid rgba(52,211,153,0.15)', padding: '12px 16px', background: 'rgba(4,7,19,0.4)' }}>
                  <div style={{ color: '#34d399', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t('conn_push_title')}</div>
                  {/* Webhook URL row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' as const }}>
                    <code style={{ fontSize: 11, color: '#94a3b8', background: 'rgba(15,23,42,0.6)', padding: '4px 8px', borderRadius: 6, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                      POST {window.location.origin}/orbit-core/api/v1/ingest/raw/{c.source_id}
                    </code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(curlExample(c)); setPushCopied(true); setTimeout(() => setPushCopied(false), 2000); }}
                      style={{ ...S.btnSm, color: pushCopied ? '#4ade80' : '#34d399', borderColor: 'rgba(52,211,153,0.30)', flexShrink: 0, fontSize: 11 }}
                    >{pushCopied ? t('conn_push_copied') : t('conn_push_copy_curl')}</button>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>
                    Payload will be mapped by spec and saved to DB. The connector must be <strong style={{ color: '#4ade80' }}>approved</strong>.
                  </div>
                  <textarea
                    style={{ ...S.input, width: '100%', minHeight: 100, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' as const, boxSizing: 'border-box' as const, marginBottom: 8 }}
                    value={pushPayload} onChange={e => setPushPayload(e.target.value)}
                    placeholder={'{\n  "your": "raw payload here"\n}'}
                  />
                  {pushErr && <div style={{ ...S.err, marginBottom: 8, fontSize: 11 }}>✗ {pushErr}</div>}
                  <button onClick={() => runPush(c)} disabled={pushLoading} style={{ ...S.btnSm, color: '#34d399', borderColor: 'rgba(52,211,153,0.35)' }}>
                    {pushLoading ? t('conn_push_sending') : t('conn_push_send')}
                  </button>
                  {pushResult && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' as const }}>
                      <span style={{ color: '#4ade80', fontWeight: 700 }}>✓ ingested: {pushResult.ingested ?? pushResult.inserted ?? 0}</span>
                      {(pushResult.skipped ?? 0) > 0 && <span style={{ color: '#f87171' }}>✗ skipped: {pushResult.skipped}</span>}
                      {pushResult.errors?.length > 0 && (
                        <div style={{ color: '#f87171', fontSize: 11, width: '100%' }}>
                          {pushResult.errors.slice(0, 3).map((e: string, i: number) => <div key={i}>{e}</div>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Test panel */}
              {testId === c.id && (
                <div style={{ borderTop: '1px solid rgba(251,191,36,0.15)', padding: '12px 16px', background: 'rgba(4,7,19,0.4)' }}>
                  <div style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t('conn_test_dry_run')}</div>
                  <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>
                    {c.mode === 'pull'
                      ? <>Optional payload — empty will fetch from <code style={{ color: '#a78bfa' }}>{c.pull_url ?? 'pull_url'}</code></>
                      : 'Provide a JSON payload to simulate the mapping without saving to DB.'}
                  </div>
                  <textarea
                    style={{ ...S.input, width: '100%', minHeight: 90, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' as const, boxSizing: 'border-box' as const, marginBottom: 8 }}
                    value={testPayload} onChange={e => setTestPayload(e.target.value)}
                    placeholder={c.mode === 'pull' ? '{ ... } — optional' : '{ ... } — required'}
                  />
                  {testErr && <div style={{ ...S.err, marginBottom: 8, fontSize: 11 }}>✗ {testErr}</div>}
                  <button onClick={() => runTest(c)} disabled={testLoading} style={{ ...S.btnSm, color: '#fbbf24', borderColor: 'rgba(251,191,36,0.35)' }}>
                    {testLoading ? t('conn_test_testing') : t('conn_test_run_btn')}
                  </button>
                  {testResult && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 12, flexWrap: 'wrap' as const }}>
                        <span style={{ color: '#4ade80' }}>✓ valid: <strong>{testResult.valid}</strong></span>
                        {testResult.skipped > 0 && <span style={{ color: '#f87171' }}>✗ invalid: <strong>{testResult.skipped}</strong></span>}
                        <span style={{ color: '#64748b' }}>source: <strong>{testResult.source}</strong></span>
                        <span style={{ color: '#64748b' }}>type: <strong>{testResult.type}</strong></span>
                      </div>
                      {testResult.errors?.length > 0 && (
                        <div style={{ color: '#f87171', fontSize: 11, marginBottom: 8 }}>
                          {testResult.errors.slice(0, 3).map((e: string, i: number) => <div key={i}>{e}</div>)}
                        </div>
                      )}
                      {testResult.mapped?.length > 0 && (
                        <pre style={{ background: 'rgba(4,7,19,0.6)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: 8, padding: 10, fontSize: 11, color: '#fef3c7', overflowX: 'auto' as const, maxHeight: 200, margin: 0 }}>
                          {JSON.stringify(testResult.mapped[0], null, 2)}{testResult.mapped.length > 1 ? `\n… +${testResult.mapped.length - 1} more` : ''}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── CREATE ── */}
      {subtab === 'create' && (
        <div style={{ ...S.card, border: '1px solid rgba(85,243,255,0.20)' }}>
          <div style={{ fontWeight: 700, color: '#55f3ff', marginBottom: 16, fontSize: 15 }}>{t('conn_new_title')}</div>
          <div className="orbit-grid-2" style={{ marginBottom: 12 }}>
            <label style={S.label}>ID (slug)
              <input style={S.input} value={cf.id} onChange={e => setCf(p => ({ ...p, id: e.target.value }))} placeholder="nagios-perf" />
            </label>
            <label style={S.label}>Source ID
              <input style={S.input} value={cf.source_id} onChange={e => setCf(p => ({ ...p, source_id: e.target.value }))} placeholder="same as ID if not provided" />
            </label>
          </div>
          <div className="orbit-grid-4" style={{ marginBottom: 12 }}>
            <label style={S.label}>{t('mode')}
              <select style={S.select} value={cf.mode} onChange={e => setCf(p => ({ ...p, mode: e.target.value }))}>
                <option value="push">push</option>
                <option value="pull">pull</option>
              </select>
            </label>
            <label style={S.label}>{t('type')}
              <select style={S.select} value={cf.type}
                onChange={e => setCf(p => ({ ...p, type: e.target.value, spec: e.target.value === 'event' ? SPEC_TEMPLATE_EVENT : SPEC_TEMPLATE_METRIC }))}>
                <option value="metric">metric</option>
                <option value="event">event</option>
              </select>
            </label>
            {cf.mode === 'pull' && <>
              <label style={{ ...S.label, gridColumn: 'span 2' }}>Pull URL
                <input style={S.input} value={cf.pull_url} onChange={e => setCf(p => ({ ...p, pull_url: e.target.value }))} placeholder="http://host/metrics" />
              </label>
            </>}
          </div>
          {cf.mode === 'pull' && (
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>{t('conn_pull_interval')}
                <input style={{ ...S.input, width: 100 }} type="number" min={1} max={1440} value={cf.pull_interval_min}
                  onChange={e => setCf(p => ({ ...p, pull_interval_min: e.target.value }))} />
              </label>
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>{t('description')}
              <input style={S.input} value={cf.description} onChange={e => setCf(p => ({ ...p, description: e.target.value }))} placeholder={t('optional')} />
            </label>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...S.label, marginBottom: 4 }}>{t('conn_spec_dsl')}</label>
            <textarea style={{ ...S.input, width: '100%', minHeight: 220, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' as const, boxSizing: 'border-box' as const }}
              value={cf.spec} onChange={e => setCf(p => ({ ...p, spec: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={create} style={S.btn}>{t('conn_save_draft')}</button>
            <button onClick={() => setSubtab('list')} style={S.btnSm}>{t('cancel')}</button>
          </div>
        </div>
      )}

      {/* ── AI GENERATE ── */}
      {subtab === 'ai' && (
        <div style={{ ...S.card, border: '1px solid rgba(155,124,255,0.25)' }}>
          <div style={{ fontWeight: 700, color: '#c084fc', marginBottom: 4, fontSize: 15 }}>{t('conn_ai_title')}</div>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 16 }}>
            Paste an example payload. Claude will analyze the structure and generate the mapping spec automatically.
          </div>

          <div className="orbit-grid-2" style={{ marginBottom: 12 }}>
            <label style={S.label}>API Key Anthropic
              <input style={{ ...S.input, fontFamily: 'monospace' }} type="password" value={af.aiKey}
                onChange={e => setAf(p => ({ ...p, aiKey: e.target.value }))} placeholder="sk-ant-..." />
            </label>
            <label style={S.label}>{t('conn_ai_model')}
              <input style={S.input} value={af.aiModel} onChange={e => setAf(p => ({ ...p, aiModel: e.target.value }))} placeholder="claude-sonnet-4-6" />
            </label>
          </div>
          <div className="orbit-grid-4" style={{ marginBottom: 12 }}>
            <label style={S.label}>Source Type (hint)
              <input style={S.input} value={af.sourceType} onChange={e => setAf(p => ({ ...p, sourceType: e.target.value }))} placeholder="nagios, wazuh, snmp…" />
            </label>
            <label style={S.label}>Type (optional)
              <select style={S.select} value={af.type} onChange={e => setAf(p => ({ ...p, type: e.target.value }))}>
                <option value="">AI infers</option>
                <option value="metric">metric</option>
                <option value="event">event</option>
              </select>
            </label>
            <label style={S.label}>ID (optional)
              <input style={S.input} value={af.id} onChange={e => setAf(p => ({ ...p, id: e.target.value }))} placeholder="auto-generated" />
            </label>
            <label style={S.label}>Description (optional)
              <input style={S.input} value={af.description} onChange={e => setAf(p => ({ ...p, description: e.target.value }))} />
            </label>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...S.label, marginBottom: 4 }}>Example Payload (JSON)</label>
            <textarea style={{ ...S.input, width: '100%', minHeight: 200, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' as const, boxSizing: 'border-box' as const }}
              value={af.payload} onChange={e => setAf(p => ({ ...p, payload: e.target.value }))}
              placeholder={'{\n  "host": "server-01",\n  "service": "cpu",\n  "value": 72.4,\n  "ts": 1740576000\n}'} />
          </div>

          {aiErr && <div style={{ ...S.err, marginBottom: 12 }}>✗ {aiErr}</div>}

          <div style={{ display: 'flex', gap: 10, marginBottom: aiResult ? 20 : 0 }}>
            <button onClick={aiGenerate} disabled={aiLoading} style={{ ...S.btn, background: 'linear-gradient(135deg, rgba(155,124,255,0.30), rgba(85,243,255,0.18))', borderColor: 'rgba(155,124,255,0.50)' }}>
              {aiLoading ? t('conn_ai_generating') : t('conn_ai_generate')}
            </button>
          </div>

          {aiResult && (
            <div style={{ marginTop: 20, borderTop: '1px solid rgba(155,124,255,0.20)', paddingTop: 16 }}>
              <div style={{ color: '#c084fc', fontWeight: 700, marginBottom: 8, fontSize: 13 }}>✓ Spec gerado — ID: <code style={{ color: '#e9eeff' }}>{aiResult.id}</code></div>
              <div style={{ position: 'relative' as const }}>
                <pre style={{ background: 'rgba(4,7,19,0.6)', border: '1px solid rgba(155,124,255,0.20)', borderRadius: 10, padding: 14, fontSize: 12, color: '#a5b4fc', overflowX: 'auto' as const, maxHeight: 300, margin: 0 }}>
                  {JSON.stringify(aiResult.spec, null, 2)}
                </pre>
                <button
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(aiResult.spec, null, 2)).then(() => showToast('Copiado!', true))}
                  style={{ position: 'absolute' as const, top: 8, right: 8, background: 'rgba(155,124,255,0.18)', border: '1px solid rgba(155,124,255,0.35)', borderRadius: 6, color: '#c084fc', fontSize: 11, padding: '3px 10px', cursor: 'pointer' }}>
                  Copy
                </button>
              </div>
              <div style={{ color: '#64748b', fontSize: 12, margin: '10px 0' }}>
                {aiResult.next_step}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
                <button
                  onClick={() => {
                    setCf(p => ({ ...p, id: aiResult.id, source_id: aiResult.source_id, spec: JSON.stringify(aiResult.spec, null, 2) }));
                    setSubtab('create');
                  }}
                  style={{ ...S.btn, background: 'linear-gradient(135deg, rgba(85,243,255,0.22), rgba(85,243,255,0.10))', borderColor: 'rgba(85,243,255,0.40)', color: '#55f3ff' }}>
                  Use this Spec
                </button>
                <button onClick={() => { setSubtab('list'); load(); setAiResult(null); }} style={S.btn}>
                  View in List
                </button>
                <button onClick={() => approve(aiResult.id)} style={{ ...S.btn, background: 'linear-gradient(135deg, rgba(74,222,128,0.25), rgba(74,222,128,0.15))', borderColor: 'rgba(74,222,128,0.40)', color: '#4ade80' }}>
                  ✓ Approve Now
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PLUGIN GENERATOR ── */}
      {subtab === 'plugin' && (
        <div style={{ ...S.card, border: '1px solid rgba(85,243,255,0.20)' }}>
          <div style={{ fontWeight: 700, color: '#55f3ff', marginBottom: 4, fontSize: 15 }}>⬇ AI Plugin Generator</div>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 16 }}>
            Describe your data source. The AI generates a collection agent, connector spec and install instructions — all ready to download.
          </div>

          <div className="orbit-grid-2" style={{ marginBottom: 12 }}>
            <label style={S.label}>API Key Anthropic
              <input style={{ ...S.input, fontFamily: 'monospace' }} type="password" value={pf.aiKey}
                onChange={e => setPf(p => ({ ...p, aiKey: e.target.value }))} placeholder="sk-ant-..." />
            </label>
            <label style={S.label}>Model
              <input style={S.input} value={pf.aiModel} onChange={e => setPf(p => ({ ...p, aiModel: e.target.value }))} />
            </label>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ ...S.label, marginBottom: 4 }}>Data source description
              <textarea
                style={{ ...S.input, width: '100%', minHeight: 120, resize: 'vertical' as const, boxSizing: 'border-box' as const, marginTop: 4 }}
                value={pf.description}
                onChange={e => setPf(p => ({ ...p, description: e.target.value }))}
                placeholder={'Examples:\n• Linux server — CPU, memory and disk via /proc and df\n• Node.js app with Express — latency and error rate per endpoint\n• Cisco switch — interface traffic via SNMP walk\n• PostgreSQL database — slow queries and active connections'}
              />
            </label>
          </div>

          {pluginErr && <div style={{ ...S.err, marginBottom: 12 }}>✗ {pluginErr}</div>}

          <button onClick={pluginGenerate} disabled={pluginLoading}
            style={{ ...S.btn, background: 'linear-gradient(135deg, rgba(85,243,255,0.25), rgba(85,243,255,0.12))', borderColor: 'rgba(85,243,255,0.45)', color: '#55f3ff', marginBottom: pluginResult ? 20 : 0 }}>
            {pluginLoading ? '⏳ Generating plugin...' : '⬇ Generate Plugin'}
          </button>

          {pluginResult && (
            <div style={{ marginTop: 20, borderTop: '1px solid rgba(85,243,255,0.15)', paddingTop: 16 }}>
              <div style={{ color: '#55f3ff', fontWeight: 700, marginBottom: 14, fontSize: 13 }}>
                ✓ Plugin gerado — 3 arquivos prontos para download
              </div>

              {/* File cards */}
              {([
                { label: 'connector_spec.json', icon: '📋', content: JSON.stringify(pluginResult.connector_spec, null, 2), color: '#a78bfa', hint: 'Importe no orbit-core → Connectors → Criar (cole o JSON no campo Spec)' },
                { label: 'agent.py',            icon: '🐍', content: pluginResult.agent_script,                            color: '#38bdf8', hint: 'Rode no servidor monitorado. Edite as variáveis ORBIT_URL, ORBIT_SOURCE_ID e ORBIT_API_KEY.' },
                { label: 'README.md',           icon: '📄', content: pluginResult.readme,                                  color: '#4ade80', hint: 'Instruções de instalação completas.' },
              ] as const).map(f => (
                <div key={f.label} style={{ marginBottom: 12, border: `1px solid ${f.color}28`, borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: `${f.color}10` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{f.icon}</span>
                      <code style={{ color: f.color, fontWeight: 700, fontSize: 13 }}>{f.label}</code>
                    </div>
                    <button onClick={() => downloadText(f.content, f.label)}
                      style={{ ...S.btnSm, borderColor: `${f.color}60`, color: f.color, background: `${f.color}15`, fontSize: 12 }}>
                      ⬇ Download
                    </button>
                  </div>
                  <div style={{ padding: '4px 14px 8px', color: '#64748b', fontSize: 11 }}>{f.hint}</div>
                  <pre style={{ margin: 0, padding: '10px 14px', background: 'rgba(4,7,19,0.55)', fontSize: 11, color: '#94a3b8', maxHeight: 160, overflowY: 'auto' as const, overflowX: 'auto' as const, borderTop: '1px solid rgba(140,160,255,0.08)' }}>
                    {f.content.length > 800 ? f.content.slice(0, 800) + '\n…' : f.content}
                  </pre>
                </div>
              ))}

              <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(85,243,255,0.06)', border: '1px solid rgba(85,243,255,0.15)', fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
                <strong style={{ color: '#55f3ff' }}>Next steps:</strong>{' '}
                1) Importe o <code style={{ color: '#a78bfa' }}>connector_spec.json</code> em Connectors → Criar.{' '}
                2) Copie <code style={{ color: '#38bdf8' }}>agent.py</code> para <code>/opt/orbit-agents/</code> no servidor e edite as variáveis de configuração.{' '}
                3) Agende via cron: <code>*/2 * * * * python3 /opt/orbit-agents/agent.py</code>
              </div>

              <button onClick={() => setPluginResult(null)} style={{ ...S.btnSm, marginTop: 12, color: '#64748b' }}>
                Generate new
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── SOURCES ── */}
      {subtab === 'sources' && <SourcesTab setTab={setTab} />}

      {/* ── TEMPLATES ── */}
      {subtab === 'templates' && (
        <div>
          <div style={S.card}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>{t('templates_title')}</div>
            <div style={{ color: 'rgba(233,238,255,0.78)', marginTop: 6, fontSize: 13 }}>{t('templates_desc')}</div>
          </div>
          <div style={S.card}>
            <div className="orbit-grid-3">
              {CONNECTOR_TEMPLATES.map(tmpl => (
                <div key={tmpl.id} style={{ ...S.card, border: selectedTemplate?.id === tmpl.id ? '1px solid rgba(85,243,255,0.4)' : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ fontWeight: 900 }}>{tmpl.name}</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {modeBadge(tmpl.mode)}
                      <span style={{ background: tmpl.type === 'metric' ? '#0c2a1a' : '#1a0c2a', color: tmpl.type === 'metric' ? '#4ade80' : '#c084fc', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{tmpl.type.toUpperCase()}</span>
                    </div>
                  </div>
                  <div style={{ color: 'rgba(233,238,255,0.65)', fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>{tmpl.description}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setCf({ id: tmpl.id, source_id: tmpl.source_id, mode: tmpl.mode, type: tmpl.type, description: tmpl.description, pull_url: tmpl.pull_url || '', pull_interval_min: tmpl.pull_interval_min || '5', spec: JSON.stringify(tmpl.spec, null, 2) }); setSubtab('create'); }} style={S.btnSm}>{t('templates_use')}</button>
                    <button onClick={() => setSelectedTemplate(selectedTemplate?.id === tmpl.id ? null : tmpl)} style={{ ...S.btnSm, borderColor: 'rgba(85,243,255,0.3)', color: '#55f3ff', background: 'rgba(85,243,255,0.08)' }}>{t('templates_download')}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Download preview card ── */}
          {selectedTemplate && (() => {
            const specContent = JSON.stringify({ id: selectedTemplate.id, source_id: selectedTemplate.source_id, mode: selectedTemplate.mode, type: selectedTemplate.type, spec: selectedTemplate.spec, ...(selectedTemplate.pull_url ? { pull_url: selectedTemplate.pull_url } : {}), ...(selectedTemplate.mode === 'pull' ? { pull_interval_min: parseInt(selectedTemplate.pull_interval_min || '5') } : {}) }, null, 2);
            const readmeContent = generateTemplateReadme(selectedTemplate);
            return (
              <div style={{ ...S.card, border: '1px solid rgba(85,243,255,0.20)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ color: '#55f3ff', fontWeight: 700, fontSize: 15 }}>{t('templates_dl_title')}: {selectedTemplate.name}</div>
                  <button onClick={() => setSelectedTemplate(null)} style={{ ...S.btnSm, color: '#64748b', borderColor: 'rgba(140,160,255,0.2)' }}>✕</button>
                </div>

                {([
                  { label: 'connector_spec.json', icon: '📋', content: specContent, color: '#a78bfa', hint: t('templates_dl_spec') },
                  { label: 'README.md',           icon: '📄', content: readmeContent, color: '#4ade80', hint: t('templates_dl_readme') },
                ] as const).map(f => (
                  <div key={f.label} style={{ marginBottom: 12, border: `1px solid ${f.color}28`, borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: `${f.color}10` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{f.icon}</span>
                        <code style={{ color: f.color, fontWeight: 700, fontSize: 13 }}>{f.label}</code>
                      </div>
                      <button onClick={() => downloadText(f.content, f.label)}
                        style={{ ...S.btnSm, borderColor: `${f.color}60`, color: f.color, background: `${f.color}15`, fontSize: 12 }}>
                        ⬇ Download
                      </button>
                    </div>
                    <div style={{ padding: '4px 14px 8px', color: '#64748b', fontSize: 11 }}>{f.hint}</div>
                    <pre style={{ margin: 0, padding: '10px 14px', background: 'rgba(4,7,19,0.55)', fontSize: 11, color: '#94a3b8', maxHeight: 160, overflowY: 'auto' as const, overflowX: 'auto' as const, borderTop: '1px solid rgba(140,160,255,0.08)', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-all' as const }}>
                      {f.content.length > 1200 ? f.content.slice(0, 1200) + '\n…' : f.content}
                    </pre>
                  </div>
                ))}

                <button onClick={() => {
                  setCf({ id: selectedTemplate.id, source_id: selectedTemplate.source_id, mode: selectedTemplate.mode, type: selectedTemplate.type, description: selectedTemplate.description, pull_url: selectedTemplate.pull_url || '', pull_interval_min: selectedTemplate.pull_interval_min || '5', spec: JSON.stringify(selectedTemplate.spec, null, 2) });
                  setSelectedTemplate(null);
                  setSubtab('create');
                }} style={{ ...S.btnSm, marginTop: 4 }}>{t('templates_dl_use')}</button>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
