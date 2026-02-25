# orbit-core

**Creator:** Rodrigo Menchio <rodrigomenchio@gmail.com>

API-first telemetry core for **metrics + events**, backed by **Postgres**.

orbit-core ingests signals from Nagios, Wazuh, Fortigate (via Wazuh) and n8n through deterministic, cron-friendly connectors, and exposes an observability UI with dashboards, live event feeds, EPS charts and an optional AI-assisted dashboard builder.

- Monorepo: **pnpm + Turborepo**
- Backend: **Node 22 / TypeScript + Express**
- Storage: **Postgres 16** (no TimescaleDB)
- License: **Apache-2.0**

## Packages

| Package | Description |
|---|---|
| `@orbit/core-contracts` | Shared types + HTTP contracts (Zod) |
| `@orbit/engine` | OrbitQL query types + engine |
| `@orbit/storage-pg` | Postgres schema + migrations + helpers |
| `@orbit/api` | Express API server (port 3000) |
| `@orbit/ui` | Vite + React UI |
| `@orbit/nagios-shipper` | Optional TypeScript shipper for Nagios |

## HTTP API (v1)

| Method | Route | Description |
|---|---|---|
| GET | `/api/v1/health` | Health + build info + DB status |
| GET | `/api/v1/metrics` | Internal metrics (JSON) |
| GET | `/api/v1/metrics/prom` | Internal metrics (Prometheus text/plain) |
| POST | `/api/v1/ingest/metrics` | Batch ingest MetricPoints |
| POST | `/api/v1/ingest/events` | Batch ingest Events |
| POST | `/api/v1/query` | OrbitQL query endpoint |
| GET | `/api/v1/catalog/assets` | Assets catalog |
| GET | `/api/v1/catalog/metrics` | Metrics catalog by asset |
| GET | `/api/v1/catalog/dimensions` | Dimension values |
| GET | `/api/v1/catalog/events` | Events catalog (namespaces/kinds/agents/severities) |
| GET | `/api/v1/dashboards` | List dashboards |
| GET | `/api/v1/dashboards/:id` | Get dashboard by id |
| POST | `/api/v1/dashboards` | Create dashboard |
| PUT | `/api/v1/dashboards/:id` | Update dashboard |
| DELETE | `/api/v1/dashboards/:id` | Delete dashboard |
| POST | `/api/v1/dashboards/validate` | Validate DashboardSpec (no persistence) |
| POST | `/api/v1/ai/dashboard` | Generate DashboardSpec via AI (Claude) |
| GET | `/api/v1/correlations` | Event correlations |

## Authentication

The API supports **API Key** (recommended) and **BasicAuth** (legacy / edge-only).

### API key

Send the key on every request:

```
X-Api-Key: <your-key>
```

Server-side configuration:

- `ORBIT_API_KEY` (environment variable)

Client-side:

- the UI stores the key in `localStorage` under `orbit_api_key`

## OrbitQL query examples

```jsonc
// Single timeseries (requires asset_id)
{ "kind": "timeseries", "asset_id": "host:srv1", "namespace": "nagios", "metric": "load1", "from": "...", "to": "..." }

// Multi-series
{ "kind": "timeseries_multi", "series": [{"asset_id": "host:srv1", "namespace": "nagios", "metric": "load1", "label": "srv1"}], "from": "...", "to": "..." }

// Filtered events
{ "kind": "events", "namespace": "wazuh", "from": "...", "to": "...", "severities": ["high", "critical"], "limit": 100 }

// Events per second (EPS)
{ "kind": "event_count", "namespace": "wazuh", "from": "...", "to": "...", "bucket_sec": 60 }
```

## Dashboards + AI builder

The **Dashboards** tab lets you create panels composed of widgets from any source.

Modes:
- **List** — saved dashboards with open/edit/delete + rotation mode (slideshow)
- **Builder** — editor with optional AI assistant + manual widget authoring
- **View** — grid renderer that refreshes by a time preset

Widget types:

| Kind | Description | Span |
|---|---|---|
| `timeseries` | Line chart (single series) | 1 (half) |
| `timeseries_multi` | Line chart (multi-series) | 2 (full) |
| `events` | Filtered events feed | 1 or 2 |
| `eps` | EPS chart (events/sec) | 2 |
| `kpi` | Instant value (last point) | 1 |
| `gauge` | Gauge (half donut) | 1 |

AI flow (high level):
1. Configure **Anthropic API Key** + **model** in Admin → AI Agent
2. Describe the dashboard in natural language
3. Click **⚡ Generate with AI** — the API queries the real catalog and produces a DashboardSpec
4. Review/edit in the builder, then **Save**

`POST /api/v1/ai/dashboard` accepts:
- headers: `X-Ai-Key` + `X-Ai-Model`
- body: `{ "prompt": "..." }`

## Retention + rollups

| Table | Retention | Used for |
|---|---:|---|
| `metric_points` (raw) | 14 days | ranges ≤ 14d |
| `metric_rollup_5m` | 90 days | ranges 14–90d |
| `metric_rollup_1h` | 180 days | ranges > 90d |

`POST /api/v1/query` automatically selects the best source table and returns `meta.source_table`.

## Quickstart (dev)

### 1) Install dependencies

```bash
pnpm install
```

### 2) Start Postgres

```bash
docker compose -f scripts/dev-postgres.docker-compose.yml up -d
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/orbit'
```

### 3) Run migrations

```bash
pnpm db:migrate
```

### 4) Start API + UI

```bash
pnpm dev
```

- API: http://localhost:3000/api/v1/health
- UI:  http://localhost:5173

## Connectors

| Connector | Namespace | Install |
|---|---|---|
| Nagios (metrics + HARD events) | `nagios` | [`connectors/nagios/INSTALL.md`](connectors/nagios/INSTALL.md) |
| Wazuh (security alerts) | `wazuh` | [`connectors/wazuh/INSTALL.md`](connectors/wazuh/INSTALL.md) |
| Fortigate (via Wazuh syslog) | `wazuh` / `kind=fortigate` | [`connectors/fortigate/INSTALL.md`](connectors/fortigate/INSTALL.md) |
| n8n (workflow failures) | `n8n` | [`connectors/n8n/INSTALL.md`](connectors/n8n/INSTALL.md) |

See [`docs/connectors.md`](docs/connectors.md) for an overview and connector authoring guidelines.

## Documentation

Start here:
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current architecture
- [`docs/connectors.md`](docs/connectors.md) — connectors overview + patterns
- [`docs/dashboard-playbook.md`](docs/dashboard-playbook.md) — dashboard spec playbook/guardrails

Additional:
- [`docs/wazuh-queries.md`](docs/wazuh-queries.md) — Wazuh query examples
- [`docs/rfc-0001-architecture.md`](docs/rfc-0001-architecture.md) — historical architecture RFC
- [`docs/product-mvp1.md`](docs/product-mvp1.md) — product notes
