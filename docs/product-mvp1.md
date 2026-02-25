# orbit-core — Product MVP1

## Problem

Security and operations teams routinely monitor **multiple telemetry sources** (Nagios, Wazuh, Fortigate, n8n), but the data ends up fragmented:

- metrics in one system
- security alerts in another
- automation failures somewhere else
- dashboards glued together with brittle queries

orbit-core is a small, API-first core that unifies **metrics + events** into a single Postgres-backed system with predictable retention and fast, safe queries.

## Target users

- Detection engineers
- SOC / SecOps analysts
- SRE / DevOps teams
- Teams operating n8n automations

## MVP1 scope

### Ingestion + storage

- `POST /api/v1/ingest/metrics` — batch metrics ingestion (timeseries + JSONB dimensions)
- `POST /api/v1/ingest/events` — batch events ingestion
- Automatic rollups: RAW → 5m → 1h
- Retention policy (default): 14d raw, 90d 5m, 180d 1h
- Query engine automatically selects raw vs rollups by time range

### Connectors

| Connector | Data | Namespace | Mode |
|---|---|---|---|
| Nagios | perfdata metrics + HARD state change events | `nagios` | cron (local files) |
| Wazuh | security alerts | `wazuh` | cron (file / OpenSearch optional) |
| Fortigate | firewall logs (via Wazuh syslog pipeline) | `wazuh` + `kind=fortigate` | via Wazuh |
| n8n | workflow failures + stuck executions | `n8n` | cron + Error Trigger |

### Query engine

- `timeseries` — single series with auto-bucket and transparent rollups
- `timeseries_multi` — multi-series with optional `group_by_dimension` + Top-N limiting
- `events` — filtered event feed
- `event_count` — EPS (events/sec) with automatic bucketing

### UI

- Rotation mode (slideshow) with configurable interval
- Uses the live catalog (metrics by asset, event namespaces/kinds/agents/severities)

### Dashboard Builder (assistive)

- CRUD dashboards and widgets
- Optional AI assistant:
  - uses the real catalog
  - outputs a strict `DashboardSpec`
  - validated server-side before saving/applying

### Security

- In production, require `ORBIT_API_KEY` (send `X-Api-Key: ...`)
- Keep secrets server-side; do not ship keys to the browser bundle

## Quality criteria

- Typical queries return in < 2s
- Dimension group-bys are bounded (Top‑N) to avoid cardinality explosions
- AI-generated dashboards must validate against the contracts in a single call
- One-command deploy (`deploy.sh`) with end-of-run health check

## Roadmap (next versions)

- alerting on thresholds / anomalies
- scheduled reports (email/webhook)
- more sources/connectors
- improved correlation rules + explainability
- retention/rollup configuration via admin
