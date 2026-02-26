# orbit-core

**Self-hosted observability platform** — ingest metrics and events from any source, visualize in real-time dashboards, fire alerts, and query your data with AI.

> No SaaS. No vendor lock-in. Your infrastructure, your data.

**v1.3.0** · Apache-2.0 · Node 22 · PostgreSQL 16 · Docker

---

## What it does

orbit-core collects telemetry from your existing tools (Nagios, Wazuh, Fortigate, n8n), stores it in Postgres, and gives you:

- **Live dashboards** — timeseries charts, event feeds, KPI widgets, gauges
- **Alerts** — threshold and absence rules, webhooks, Telegram notifications
- **AI query** — describe a dashboard in plain text, Claude builds it from your real catalog
- **Connectors** — pull or push data from any HTTP source via a DSL-based mapping layer
- **Anomaly correlation** — Z-score correlation across namespaces

---

## Architecture

```
Sources                  orbit-core                  You
──────               ─────────────────           ──────────
Nagios    ──push──▶  /ingest/raw/:id  ──▶  DB   Dashboard UI
Wazuh     ──push──▶  /ingest/events   ──▶  PG   AI builder
n8n       ──pull──▶  connector worker      16   Alert rules
Custom    ──push──▶  /ingest/metrics            API / CLI
```

**Stack:** pnpm monorepo · Turborepo · Express · Zod · Vite + React · Vitest · Docker Swarm

---

## Quick start (Docker)

```bash
git clone https://github.com/rmfaria/orbit-core.git
cd orbit-core

cp .env.example .env
# Set ORBIT_API_KEY=$(openssl rand -hex 32)

docker compose build
docker compose up -d
```

- UI: http://localhost
- API health: http://localhost/api/v1/health

See [INSTALL.md](INSTALL.md) for production deployment, Docker Swarm, and Traefik setup.

---

## Quick start (dev)

```bash
pnpm install

# Start Postgres
docker compose -f scripts/dev-postgres.docker-compose.yml up -d
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/orbit'

pnpm db:migrate
pnpm dev
```

- API: http://localhost:3000/api/v1/health
- UI:  http://localhost:5173

---

## Connectors

Connectors define how orbit-core fetches or receives data from external tools.

| Source | Type | Namespace | Guide |
|--------|------|-----------|-------|
| Nagios | push (cron) | `nagios` | [connectors/nagios](connectors/nagios/INSTALL.md) |
| Wazuh | push (webhook) | `wazuh` | [connectors/wazuh](connectors/wazuh/INSTALL.md) |
| Fortigate | push via Wazuh | `wazuh` | [connectors/fortigate](connectors/fortigate/INSTALL.md) |
| n8n | push (webhook) | `n8n` | [connectors/n8n](connectors/n8n/INSTALL.md) |
| Custom | push or pull | any | [docs/connectors.md](docs/connectors.md) |

### AI Connector Framework

Register any HTTP source without writing code — define the mapping in JSON and orbit-core handles polling, validation, and ingestion automatically.

```bash
# Register a connector
POST /api/v1/connectors
{ "name": "my-api", "type": "metric", "pull_url": "https://...", "mapping": { ... } }

# Approve it
POST /api/v1/connectors/:id/approve

# Or push directly
POST /api/v1/ingest/raw/:source_id
```

---

## API reference

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/v1/health` | Health, DB status, worker list |
| POST | `/api/v1/ingest/metrics` | Batch ingest metric points |
| POST | `/api/v1/ingest/events` | Batch ingest events |
| POST | `/api/v1/ingest/raw/:id` | Push raw payload to a registered connector |
| POST | `/api/v1/query` | OrbitQL query (timeseries, events, EPS) |
| GET | `/api/v1/catalog/assets` | Asset catalog |
| GET | `/api/v1/catalog/metrics` | Metrics by asset |
| GET | `/api/v1/catalog/events` | Event namespaces / kinds / severities |
| GET/POST/PUT/DELETE | `/api/v1/dashboards` | Dashboard CRUD |
| POST | `/api/v1/ai/dashboard` | Generate dashboard from natural language |
| GET/POST | `/api/v1/alerts/rules` | Alert rules CRUD |
| GET/POST | `/api/v1/alerts/channels` | Notification channels |
| GET | `/api/v1/correlations` | Anomaly correlations |
| GET/POST | `/api/v1/connectors` | Connector specs CRUD |

### Authentication

```
X-Api-Key: <your-key>
```

Set `ORBIT_API_KEY` in the server environment. The UI stores the key in `localStorage`.

---

## OrbitQL

Query your data without writing SQL:

```jsonc
// Timeseries
{ "kind": "timeseries", "asset_id": "host:srv1", "namespace": "nagios",
  "metric": "load1", "from": "2024-01-01T00:00:00Z", "to": "2024-01-02T00:00:00Z" }

// Multi-series comparison
{ "kind": "timeseries_multi", "from": "...", "to": "...",
  "series": [
    { "asset_id": "host:srv1", "namespace": "nagios", "metric": "load1", "label": "srv1" },
    { "asset_id": "host:srv2", "namespace": "nagios", "metric": "load1", "label": "srv2" }
  ]}

// Security events
{ "kind": "events", "namespace": "wazuh", "severities": ["high", "critical"],
  "from": "...", "to": "...", "limit": 100 }

// Events per second
{ "kind": "event_count", "namespace": "wazuh", "from": "...", "to": "...", "bucket_sec": 60 }
```

---

## Data retention

| Table | Retention | Query range |
|-------|-----------|-------------|
| `metric_points` (raw) | 14 days | ≤ 14d |
| `metric_rollup_5m` | 90 days | 14–90d |
| `metric_rollup_1h` | 180 days | > 90d |

The query engine selects the best source table automatically and reports it in `meta.source_table`.

---

## Packages

| Package | Description |
|---------|-------------|
| `@orbit/api` | Express API + background workers |
| `@orbit/ui` | Vite + React dashboard |
| `@orbit/storage-pg` | Postgres schema + migrations |
| `@orbit/core-contracts` | Shared TypeScript types + Zod schemas |
| `@orbit/engine` | OrbitQL query types |

---

## Documentation

- [INSTALL.md](INSTALL.md) — full installation and production guide
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture overview
- [docs/connectors.md](docs/connectors.md) — connector authoring
- [docs/dashboard-playbook.md](docs/dashboard-playbook.md) — dashboard spec reference
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute
- [SECURITY.md](SECURITY.md) — security policy

---

## License

Apache-2.0 — see [LICENSE](LICENSE).

**Creator:** Rodrigo Menchio &lt;rodrigomenchio@gmail.com&gt;
