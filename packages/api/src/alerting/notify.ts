import nodemailer from 'nodemailer';
import { isPrivateUrl } from '../ssrf-guard.js';

export type SmtpConfig = {
  host: string; port: number; secure: boolean;
  user: string; pass: string; from: string;
};

export type NotifyPayload = {
  event:     'firing' | 'resolved';
  rule_name: string;
  asset_id:  string | null;
  namespace: string | null;
  metric:    string | null;
  condition: any;
  value:     number | null;
  severity:  string;
  fired_at:  string;
};

export async function sendWebhook(
  url: string,
  headers: Record<string, string>,
  payload: NotifyPayload
): Promise<void> {
  // C3-fix: SSRF protection — block private/internal URLs
  if (await isPrivateUrl(url)) {
    throw new Error('webhook URL targets a private or reserved address');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`webhook HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

export async function sendTelegram(
  bot_token: string,
  chat_id: string,
  payload: NotifyPayload
): Promise<void> {
  const icon = payload.event === 'firing' ? '🚨' : '✅';
  const condText = payload.condition.kind === 'threshold'
    ? `${payload.condition.agg ?? 'avg'} ${payload.condition.op} ${payload.condition.value} (últimos ${payload.condition.window_min}min)`
    : `ausência de dados (${payload.condition.window_min}min)`;

  const lines: string[] = [
    `${icon} <b>${payload.event.toUpperCase()} — ${payload.rule_name}</b>`,
    payload.asset_id  ? `Asset: <code>${payload.asset_id}</code>`       : '',
    payload.namespace ? `Namespace: <code>${payload.namespace}</code>`  : '',
    payload.metric    ? `Métrica: <code>${payload.metric}</code>`       : '',
    `Condição: ${condText}`,
    payload.value !== null ? `Valor: <b>${payload.value.toFixed(2)}</b>` : '',
    `Severidade: <b>${payload.severity.toUpperCase()}</b>`,
    `Hora: <code>${payload.fired_at}</code>`,
  ].filter(Boolean);

  const res = await fetch(
    `https://api.telegram.org/bot${bot_token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id, text: lines.join('\n'), parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(8_000),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`telegram HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

export async function sendEmail(
  smtp: SmtpConfig,
  recipients: string[],
  payload: NotifyPayload
): Promise<void> {
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000,
  });

  const icon = payload.event === 'firing' ? '🚨' : '✅';
  const sevColor: Record<string, string> = {
    critical: '#f87171', high: '#fb923c', medium: '#fbbf24', low: '#34d399', info: '#55f3ff',
  };
  const color = sevColor[payload.severity] ?? '#55f3ff';
  const borderColor = payload.event === 'firing' ? '#f87171' : '#4ade80';

  const condText = payload.condition.kind === 'threshold'
    ? `${payload.condition.agg ?? 'avg'} ${payload.condition.op} ${payload.condition.value} (${payload.condition.window_min}min)`
    : `no data (${payload.condition.window_min}min)`;

  const rows = [
    payload.asset_id  ? `<tr><td style="color:#8892b0;padding:4px 12px 4px 0">Asset</td><td>${payload.asset_id}</td></tr>` : '',
    payload.namespace ? `<tr><td style="color:#8892b0;padding:4px 12px 4px 0">Namespace</td><td>${payload.namespace}</td></tr>` : '',
    payload.metric    ? `<tr><td style="color:#8892b0;padding:4px 12px 4px 0">Metric</td><td>${payload.metric}</td></tr>` : '',
    `<tr><td style="color:#8892b0;padding:4px 12px 4px 0">Condition</td><td style="font-family:monospace">${condText}</td></tr>`,
    payload.value !== null ? `<tr><td style="color:#8892b0;padding:4px 12px 4px 0">Value</td><td><b>${payload.value.toFixed(2)}</b></td></tr>` : '',
    `<tr><td style="color:#8892b0;padding:4px 12px 4px 0">Severity</td><td><span style="background:${color};color:#040713;padding:2px 8px;border-radius:4px;font-weight:700;font-size:12px">${payload.severity.toUpperCase()}</span></td></tr>`,
    `<tr><td style="color:#8892b0;padding:4px 12px 4px 0">Time</td><td style="font-family:monospace;font-size:12px">${payload.fired_at}</td></tr>`,
  ].filter(Boolean).join('');

  const html = `
<div style="background:#040713;padding:24px;font-family:'Inter',-apple-system,sans-serif;color:#e2e8f0">
  <div style="max-width:520px;margin:0 auto;border:1px solid ${borderColor};border-radius:12px;overflow:hidden">
    <div style="background:${borderColor}15;padding:16px 20px;border-bottom:1px solid ${borderColor}40">
      <span style="font-size:20px">${icon}</span>
      <span style="font-size:16px;font-weight:700;margin-left:8px">${payload.event.toUpperCase()} — ${payload.rule_name}</span>
    </div>
    <div style="padding:16px 20px">
      <table style="border-collapse:collapse;font-size:14px">${rows}</table>
    </div>
    <div style="padding:12px 20px;border-top:1px solid #1a2540;font-size:11px;color:#475569">
      Orbit Core Alert System
    </div>
  </div>
</div>`;

  await transport.sendMail({
    from: smtp.from,
    to: recipients.join(','),
    subject: `${icon} ${payload.event.toUpperCase()} — ${payload.rule_name}`,
    html,
  });
}
