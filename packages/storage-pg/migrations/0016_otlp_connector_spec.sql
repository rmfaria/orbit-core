-- Migration 0016: register the OTLP/HTTP receiver as a built-in connector spec
--
-- The OTLP receiver (/otlp/v1/traces|metrics|logs) is a passive push endpoint,
-- not a pull connector.  This record makes it visible in the Connectors tab and
-- lets connector_runs rows (logged per ingest batch) show up with run history.

INSERT INTO connector_specs (id, source_id, mode, type, spec, status, description)
VALUES (
  'otlp-receiver',
  'otlp',
  'push',
  'event',
  '{}',
  'approved',
  'OpenTelemetry OTLP/HTTP push receiver — accepts traces, metrics and logs from instrumented apps via /otlp/v1/{traces,metrics,logs}'
)
ON CONFLICT (id) DO NOTHING;
