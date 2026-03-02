<div align="center">

<img src="./packages/ui/public/orbitcore-logo.svg" width="72" alt="orbit-core" />

# orbit-core

**Self-hosted telemetry core — metrics + events + AI-generated connectors**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)](https://postgresql.org)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-OTLP%2FHTTP-f5a800?logo=opentelemetry&logoColor=white)](https://opentelemetry.io)

> Ingest metrics + events from **any source**. The AI writes the connector for you.

<br/>

![orbit-core AI Connector Generator demo](./docs/ai-connector-demo.svg)

<br/>

```bash
git clone https://github.com/rmfaria/orbit-core && cd orbit-core
cp .env.example .env && docker compose up -d
# → http://localhost/orbit-core/
```

</div>

---

## What is orbit-core?

orbit-core is a single-binary, Postgres-backed telemetry core that replaces a fragmented stack of Prometheus + Loki + Alertmanager + Grafana with one `docker compose up -d`.

It unifies **timeseries metrics** and **operational/security events** from any source behind a stable API, then lets you query, visualize, correlate anomalies and fire alerts — all without vendor lock-in.

**The standout feature:** the built-in **AI Connector Generator** writes integrations for you. Describe any HTTP API in plain language — the AI produces a ready-to-deploy connector spec, ingestion script and README in seconds.

---

## ✨ AI Connector Generator

Integrate any system — no adapter code required.

```bash
# 1. Describe your source in plain language
POST /api/v1/ai/plugin
{
  "description": "Zabbix API — /api/jsonrpc endpoint, returns JSON array with host, key_, lastvalue fields"
}

# ↳ AI returns:
{
  "connector_spec": { "name": "zabbix", "type": "metric", "pull_url": "...", "mapping": { ... } },
  "agent_script":   "#!/usr/bin/env python3\n...",
  "readme":         "# Zabbix Connector\n..."
}

# 2. Register the connector
POST /api/v1/connectors   { ...connector_spec }

# 3. Approve → data flows automatically every 5 min
POST /api/v1/connectors/zabbix/approve
```

Or use the **Connectors → ✨ Generate with AI** tab in the UI — paste a description, review the generated spec, approve in one click.

Works for anything with an HTTP API: Zabbix, Datadog, CloudWatch, PagerDuty, custom internal APIs, IoT endpoints — if it speaks HTTP, orbit-core can ingest it.

---

## ⚡ Quick Start

Requires Docker ≥ 24 and Docker Compose ≥ 2.20.

```bash
# Clone and configure
git clone https://github.com/rmfaria/orbit-core.git
cd orbit-core
cp .env.example .env
# Optional: set a strong API key
sed -i '' "s/ORBIT_API_KEY=/ORBIT_API_KEY=$(openssl rand -hex 32)/" .env

# Build and start (≈3 min on first run)
docker compose build
docker compose up -d

# Verify
curl http://localhost/orbit-core/api/v1/health
# → {"ok":true,"db":"ok","workers":["rollup","correlate","alerts","connectors"]}
```

Open **http://localhost/orbit-core/** — the UI is live.

See [INSTALL.md](INSTALL.md) for production hardening, TLS, Docker Swarm and reverse proxy setup.

---

## Features

| | Feature | Description |
|---|---|---|
| ✨ | **AI Connector Generator** | Describe any HTTP API → AI generates connector spec + Python agent + README |
| 📡 | **OpenTelemetry OTLP/HTTP** | Built-in receiver for traces, metrics and logs. No Collector required |
| 📊 | **Live dashboards** | Timeseries charts, KPI cards, event feeds — auto-refresh every 30s |
| 🖥️ | **System monitoring** | Live infrastructure panel: CPU, memory, disk usage, network I/O, PostgreSQL I/O & stats, worker health |
| 🔔 | **Alerts** | Threshold + absence rules, evaluated every 60s, dispatched via webhook or Telegram |
| 🔗 | **Auto-correlation** | Z-score anomaly detection links metric spikes to concurrent events |
| 🤖 | **AI dashboard builder** | Claude-powered — describe a dashboard in plain text, it builds the spec from your real catalog |
| 🗄️ | **Rollups + retention** | Automatic 5m and 1h rollups; query engine picks the best source table |
| 🐳 | **Docker standalone** | Single `docker compose up -d` — migrations run automatically on first boot |
| 🔑 | **API-first** | Every feature exposed via stable REST API; UI is optional |
| 🌐 | **Multilingual UI (EN/PT/ES)** | Language switcher in the UI header |
| 📱 | **Mobile-responsive** | Full mobile layout across all tabs |
| 🔑 | **Hybrid License System** | Ed25519 JWT license verification with 7-day grace period; inline activation banner + Licensed badge |
| ⚙️ | **Engine Dispatch** | Built-in connector engines (n8n); registry pattern for zero-config pull connectors |
| 📋 | **Connector Templates** | 10 pre-built templates with one-click import + Download Plugin (connector_spec.json + README) |

---

## Architecture

```
Sources                     orbit-core                       Consumers
─────────               ──────────────────────           ─────────────────
Nagios    ──push──▶     /ingest/metrics                  Dashboard UI
Wazuh     ──push──▶     /ingest/events      ──▶  PG ──▶  Alert engine
OTel SDK  ──push──▶     /otlp/v1/*                       AI builder
Any API   ──pull──▶     connector worker                 OrbitQL API
Custom    ──push──▶     /ingest/raw/:id                  Prometheus /prom
```

Four background workers run continuously: `rollup` · `correlate` · `alerts` · `connectors`

<img width="1800" alt="orbit-core architecture diagram" src="./docs/orbit-core-architecture.png" />

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full breakdown.

---

## Connectors

| Source | Mode | Namespace | Guide |
|--------|------|-----------|-------|
| Nagios | push (cron + event handler) | `nagios` | [connectors/nagios](connectors/nagios/INSTALL.md) |
| Wazuh | push (webhook) | `wazuh` | [connectors/wazuh](connectors/wazuh/INSTALL.md) |
| Fortigate | via Wazuh syslog | `wazuh/fortigate` | [connectors/fortigate](connectors/fortigate/INSTALL.md) |
| n8n | push (Error Trigger) | `n8n` | [connectors/n8n](connectors/n8n/INSTALL.md) |
| macOS | push (LaunchAgent) | `macos` | via AI-generated connector + LaunchAgent |
| OpenTelemetry | push (OTLP/HTTP) | `otel` | [OTLP receiver](#opentelemetry-otlp-receiver) |
| **Any HTTP API** | **AI-generated** | any | [AI Connector Generator](#-ai-connector-generator) |

### OpenTelemetry OTLP receiver

Point any OTel SDK exporter at orbit-core — no Collector required:

| Endpoint | Payload | Stored as |
|----------|---------|-----------|
| `POST /otlp/v1/traces` | ResourceSpans | `metric_points` (span duration) + `orbit_events` (errors) |
| `POST /otlp/v1/metrics` | ResourceMetrics | `metric_points` |
| `POST /otlp/v1/logs` | ResourceLogs | `orbit_events` |

---

## OrbitQL

Query your data without writing SQL:

```jsonc
// Timeseries — auto-selects raw/rollup based on range
{ "kind": "timeseries", "asset_id": "host:srv1", "namespace": "nagios",
  "metric": "load1", "from": "2024-01-01T00:00:00Z", "to": "2024-01-02T00:00:00Z" }

// Multi-series comparison
{ "kind": "timeseries_multi", "from": "...", "to": "...",
  "series": [
    { "asset_id": "host:srv1", "namespace": "nagios", "metric": "cpu", "label": "srv1" },
    { "asset_id": "host:srv2", "namespace": "nagios", "metric": "cpu", "label": "srv2" }
  ]}

// Security events
{ "kind": "events", "namespace": "wazuh", "severities": ["high","critical"],
  "from": "...", "to": "...", "limit": 100 }

// Events per second (EPS)
{ "kind": "event_count", "namespace": "wazuh", "from": "...", "to": "...", "bucket_sec": 60 }
```

---

## API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/v1/health` | Health, DB status, worker list |
| `GET` | `/api/v1/system` | Live infra metrics (CPU, memory, disk, network, DB pool, pg_stats, workers) |
| `POST` | `/api/v1/ingest/metrics` | Batch ingest metric points |
| `POST` | `/api/v1/ingest/events` | Batch ingest events (fingerprint dedup) |
| `POST` | `/api/v1/ingest/raw/:id` | Push raw payload to a registered connector |
| `POST` | `/api/v1/query` | OrbitQL query |
| `GET` | `/api/v1/catalog/*` | Assets, metrics, dimensions |
| `GET` | `/api/v1/correlations` | Anomaly ↔ event links |
| `*` | `/api/v1/alerts/rules` | Alert rules CRUD |
| `*` | `/api/v1/alerts/channels` | Notification channels CRUD |
| `GET` | `/api/v1/alerts/history` | Notification log |
| `*` | `/api/v1/dashboards` | Dashboard CRUD (JSON spec) |
| `POST` | `/api/v1/ai/dashboard` | AI-assisted dashboard generation |
| `*` | `/api/v1/connectors` | Connector specs CRUD |
| `POST` | `/api/v1/connectors/:id/approve` | Approve a connector |
| `POST` | `/api/v1/connectors/:id/test` | Dry-run test |
| `POST` | `/api/v1/ai/plugin` | AI Connector Generator |
| `GET` | `/api/v1/license/status` | License status, plan, email, deployment ID |
| `POST` | `/api/v1/license/activate` | Activate license key |
| `DELETE` | `/api/v1/license` | Remove license key (auth required) |
| `POST` | `/otlp/v1/traces` | OTLP/HTTP traces receiver |
| `POST` | `/otlp/v1/metrics` | OTLP/HTTP metrics receiver |
| `POST` | `/otlp/v1/logs` | OTLP/HTTP logs receiver |
| `GET` | `/api/v1/metrics/prom` | Prometheus exporter |

**Auth:** `X-Api-Key: <key>` — set `ORBIT_API_KEY` on the server; UI stores key in `localStorage`.

---

## Data Retention

| Table | Retention | Used for |
|-------|-----------|----------|
| `metric_points` (raw) | 14 days | Ranges ≤ 2h |
| `metric_rollup_5m` | 90 days | Ranges ≤ 14d |
| `metric_rollup_1h` | 180 days | Ranges > 14d |

Query engine selects the best source table automatically.

---

## Dev Setup

```bash
pnpm install

# Start Postgres
docker compose -f scripts/dev-postgres.docker-compose.yml up -d
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/orbit'

pnpm db:migrate
pnpm dev          # api :3000 + ui :5173 with hot reload
```

---

## Documentation

- [INSTALL.md](INSTALL.md) — production deployment, Docker Swarm, Traefik
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — deep architecture overview
- [docs/connectors.md](docs/connectors.md) — connector authoring guide
- [docs/dashboard-playbook.md](docs/dashboard-playbook.md) — DashboardSpec reference
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution guide
- [SECURITY.md](SECURITY.md) — security policy

---

## Contributing

orbit-core aims to be easy to run, easy to understand, and safe by default.

- Check [issues](https://github.com/rmfaria/orbit-core/issues) for `good first issue` labels
- Open a [discussion](https://github.com/rmfaria/orbit-core/discussions) for ideas or questions
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a PR

**Project stance:** operational flows stay deterministic (no AI in automated pipelines). AI is assistive only. API-first contracts — the UI is optional. Postgres is the default.

---

## License

Apache-2.0 — see [LICENSE](LICENSE).

**Creator:** Rodrigo Menchio · [rodrigomenchio@gmail.com](mailto:rodrigomenchio@gmail.com)
