/**
 * orbit-core UI — OpenTelemetry browser instrumentation
 *
 * Instruments the orbit-ui React app with OpenTelemetry traces and
 * sends them to the orbit-core OTLP receiver (/otlp/v1/traces).
 *
 * Tracks:
 *  - Document / page load timing (LCP proxy, TTFB, resource durations)
 *  - Fetch/XHR calls to the orbit-core API (duration, errors, status codes)
 *
 * Call initTelemetry() once at app startup before React renders.
 */

import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export function initTelemetry(): void {
  // Only run in browser environments
  if (typeof window === 'undefined') return;

  const serviceName = 'orbit-ui';

  // In production the app lives at /orbit-core (Vite base).
  // The API (orbit-core backend) is on the same origin under /orbit-core/.
  // For local dev with the Vite proxy the target is http://localhost:3000.
  const apiBase = import.meta.env.VITE_API_BASE ?? '/orbit-core';
  const apiKey  = import.meta.env.VITE_API_KEY ?? '';

  const exporter = new OTLPTraceExporter({
    url: `${apiBase}/otlp/v1/traces`,
    headers: apiKey ? { 'x-api-key': apiKey } : {},
    // Keep batches small — the browser keeps connections idle and we don't
    // want to delay page unload with pending flushes.
    timeoutMillis: 5_000,
  });

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
    }),
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        scheduledDelayMillis: 2_000,
        maxExportBatchSize:   20,
        maxQueueSize:         100,
      }),
    ],
  });

  provider.register();

  registerInstrumentations({
    instrumentations: [
      // Page load: captures navigation timing, resource timings (JS, CSS, images)
      new DocumentLoadInstrumentation(),

      // Fetch API: captures duration, HTTP status, errors for all fetch() calls.
      // Only propagates trace context to same-origin orbit-core API calls.
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: [new RegExp(`${apiBase}/`)],
        clearTimingResources: true,
      }),
    ],
  });
}
