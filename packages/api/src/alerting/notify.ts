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
