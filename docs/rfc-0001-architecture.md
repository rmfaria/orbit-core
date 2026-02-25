# RFC-0001 — Architecture

> Note: this RFC documents early architecture decisions.
> For the current implementation, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Summary

orbit-core is a modular core for telemetry (security + ops) analytics:

- Stable HTTP API (health, ingest, query)
- Postgres storage (JSONB) with a canonical schema for metrics + events
- Observability UI (charts, event feed, dashboards)
- Deterministic connectors (no AI) for Nagios, Wazuh, Fortigate (via Wazuh), and n8n

## Non-goals (MVP)

- ClickHouse (planned for a future version)

## Repository layout

```
orbit-core/
  packages/
    core-contracts/
    engine/
    storage-pg/
    api/
    ui/
  connectors/
    nagios/
    wazuh/
    fortigate/        # integration via Wazuh syslog
    n8n/
  docs/
  site/
  studio/
```

## Data model

### Metrics

Timeseries points:

- `asset_id` (e.g. `host:vm002`)
- `namespace` (e.g. `nagios`)
- `metric` (e.g. `load1`)
- `value` (double)
- `dimensions` (JSONB)

### Events

Normalized event record:

- `ts` (timestamp)
- `asset_id`
- `namespace`
- `kind`
- `severity`
- `title`
- `message`
- `attributes` (JSONB)
- `fingerprint` (deduplication)

## API

### Ingest

- `POST /api/v1/ingest/metrics`
- `POST /api/v1/ingest/events`

### Query

- `POST /api/v1/query` with OrbitQL

### Catalog

- `GET /api/v1/catalog/*`

### AI (optional)

- AI proxy endpoint that uses the live catalog as context
- outputs a strict DashboardSpec validated server-side

### Authentication

- `X-Api-Key` (recommended)
- BasicAuth (legacy / edge)

## Security considerations

- `ORBIT_API_KEY` should be required in production
- keep secrets server-side
- safe limits (payload size, query limits, bounded group-bys)
- internal metrics via `/api/v1/metrics` (JSON) and `/api/v1/metrics/prom` (Prometheus)
