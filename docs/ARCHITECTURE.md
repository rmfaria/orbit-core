# orbit-core — Architecture (current)

Last updated: 2026-02-24

## 1) Overview

**orbit-core** is an API-first telemetry core backed by Postgres, with a canonical schema for:

- **Assets** (`assets`)
- **Timeseries metrics** (`metric_points`) + **rollups** (`metric_rollup_5m`, `metric_rollup_1h`)
- **Events** (`orbit_events`)
- **Dashboards** (`dashboards`)

Deterministic connectors (Nagios, Wazuh, Fortigate via Wazuh, n8n) ship data to ingest endpoints.
Consumers query data via `POST /api/v1/query`.

An optional **AI agent** can assist with dashboard authoring by:
- querying the live catalog
- producing a strict `DashboardSpec`
- validating it server-side before persistence

## 2) Diagram

![orbit-core diagram](./diagrams/orbit-core-architecture.png)

Diagram source: `docs/diagrams/orbit-core-architecture.dot`.

This diagram is intentionally **educational**:
- it separates **sources** from **connectors**
- it highlights the **edge boundary** (TLS/auth/subpath)
- it shows how everything converges on the same ingest API and Postgres schema

## 3) Components

### 3.1 Edge (reverse proxy)

Typical production setup (Traefik / Nginx):

- TLS termination
- **API key authentication** (`X-Api-Key`) enforced by the API container (recommended)
- optional BasicAuth at the edge (legacy / extra layer)
- subpath routing (e.g. `/orbit-core/`)
- redirect `/orbit-core` → `/orbit-core/` to avoid SPA relative-path bugs

### 3.2 API (Node 22 / Express)

Primary routes:

| Method | Route | Description |
|---|---|---|
| GET | `/api/v1/health` | Health + build info + DB status |
| GET | `/api/v1/metrics` | Internal metrics (JSON) |
| GET | `/api/v1/metrics/prom` | Internal metrics (Prometheus) |
| POST | `/api/v1/ingest/metrics` | Batch ingest metrics |
| POST | `/api/v1/ingest/events` | Batch ingest events |
| POST | `/api/v1/query` | OrbitQL queries |
| GET | `/api/v1/catalog/assets` | Assets catalog |
| GET | `/api/v1/catalog/metrics` | Metrics catalog by asset |
| GET | `/api/v1/catalog/dimensions` | Dimension values |
| GET | `/api/v1/catalog/events` | Events catalog |
| CRUD | `/api/v1/dashboards/*` | Dashboard persistence (JSONB) |
| POST | `/api/v1/dashboards/validate` | Validate DashboardSpec |
| POST | `/api/v1/ai/dashboard` | Anthropic proxy + DashboardSpec generation |
| GET | `/api/v1/correlations` | Event correlations |

Authentication:
- recommended: `X-Api-Key` header (`ORBIT_API_KEY`)
- legacy: BasicAuth (edge-only / compatibility)

Payload limits:
- `express.json({ limit: '1mb' })` → keep connector batches bounded (events can be large)

### 3.3 UI (Vite + React)

Main tabs:

| Tab | Content |
|---|---|
| **Home** | KPIs, charts, EPS, consolidated live feed |
| **Dashboards** | Builder (AI-assisted optional), saved dashboards, rotation/view mode |
| **Metrics** | Query builder for `timeseries` and `timeseries_multi` |
| **Events** | Filtered events table |
| **Correlations** | Automatically detected event correlations |
| **Sources** | Source cards and status |
| **Admin** | API key, AI agent config, operational info |

The API key is stored in `localStorage` and can be preconfigured at build time via:
- `VITE_ORBIT_API_KEY` (UI package `.env`)

### 3.4 Postgres

Canonical schema with automated rollups and retention:

| Table | Content | Retention |
|---|---|---:|
| `assets` | Asset catalog (name, type, tags) | — |
| `metric_points` | Raw metrics (value + JSONB dimensions) | 14 days |
| `metric_rollup_5m` | 5-minute rollup | 90 days |
| `metric_rollup_1h` | 1-hour rollup | 180 days |
| `orbit_events` | Normalized events | — |
| `orbit_correlations` | Correlation records | — |
| `dashboards` | Dashboard specs as JSONB | — |

## 4) Data flow

### 4.1 Connectors → orbit-core

```
Nagios perfdata spool   → connectors/nagios/ship_metrics.py → POST /api/v1/ingest/metrics
Nagios HARD event spool → connectors/nagios/ship_events.py  → POST /api/v1/ingest/events
Wazuh alerts.json       → connectors/wazuh/ship_events.py   → POST /api/v1/ingest/events
n8n REST API polling    → connectors/n8n/ship_events.py     → POST /api/v1/ingest/events
Fortigate syslog → Wazuh → connectors/wazuh/ship_events.py  → POST /api/v1/ingest/events
```

All connectors are **deterministic** (no AI), cron-friendly, and track state using a local file:
- byte-offset cursors for local JSONL files
- ISO timestamp cursors for API polling

### 4.2 AI dashboard builder (end-to-end)

High-level flow:

1. UI sends a prompt to `POST /api/v1/ai/dashboard`
2. API queries the live catalog (assets/metrics/event namespaces)
3. API builds a system prompt with contracts + catalog + playbooks
4. The model produces a `DashboardSpec`
5. API validates it server-side (Zod) and returns it to the UI

## 5) Query engine notes

### 5.1 `timeseries`

Single series with optional aggregation and downsampling.

### 5.2 `timeseries_multi`

Multiple series with optional:
- `group_by_dimension` (splits a series into multiple)
- Top‑N limiting (`top_n`, `top_by`, `top_lookback_days`) to control cardinality

### 5.3 RAW vs rollup selection

The query engine selects the source table automatically based on the requested time range.
The response includes `meta.source_table`.

## 6) Operations

### 6.1 Rollups + retention

Rollups and retention are executed as background jobs (API workers) or via cron scripts,
depending on the deployment.

### 6.2 Production deploy (Docker Swarm + Traefik)

See `deploy.sh` and the stack files under `docker/` for the server reference deployment.

Key API container environment variables:
- `DATABASE_URL`
- `ORBIT_API_KEY`
- (optional) AI settings for `/api/v1/ai/dashboard`

## 7) Connectors

See [`docs/connectors.md`](connectors.md) for the full overview and authoring standards.
