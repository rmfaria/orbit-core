import type { MetricPoint, Event, IngestMetricsRequest, IngestEventsRequest } from '@orbit/core-contracts';

export async function sendMetrics(apiUrl: string, metrics: MetricPoint[]): Promise<void> {
  const body: IngestMetricsRequest = { metrics };
  const res = await fetch(`${apiUrl}/api/v1/ingest/metrics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ingest/metrics failed: HTTP ${res.status} — ${text}`);
  }
}

export async function sendEvents(apiUrl: string, events: Event[]): Promise<void> {
  const body: IngestEventsRequest = { events };
  const res = await fetch(`${apiUrl}/api/v1/ingest/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ingest/events failed: HTTP ${res.status} — ${text}`);
  }
}
