# orbit-core — Architecture (current)

This document describes the current **system architecture** of orbit-core, focusing on backend components and data flows.

## 1) Overview

**orbit-core** is the Orbit product core: an **API-first core** + **Postgres** with a canonical schema for:

- **Assets** (`assets`)
- **Time series** (`metric_points`) + **rollups** (`metric_rollup_5m`, `metric_rollup_1h`)
- **Events** (`orbit_events`)

Connectors (Nagios, Wazuh/OpenSearch, etc.) send data via ingest endpoints and Orbit consumers query via `/api/v1/query`.

## 2) Diagram

![orbit-core diagram](./diagrams/orbit-core-architecture.png)

Diagram source: `docs/diagrams/orbit-core-architecture.dot`.

This diagram is intentionally **educational**:
- it separates **sources** from **connectors**
- it highlights the **edge boundary** (TLS/auth/subpath)
- it shows how everything converges on the same ingest API and Postgres schema

## 3) Components

### 3.1 Edge (reverse proxy)
Typical production setup:
- TLS termination
- Authentication (BasicAuth, SSO, etc.)
- Subpath deployments supported (e.g. `/orbit-core/`)
- Optional redirect `/orbit-core` → `/orbit-core/` to avoid SPA relative-path issues

### 3.2 API (Node/Express)
Main routes:
- `GET /api/v1/health` (includes build info)
- `GET /api/v1/metrics` (JSON)
- `GET /api/v1/metrics/prom` (Prometheus text/plain)
- `POST /api/v1/ingest/metrics`
- `POST /api/v1/ingest/events`
- `POST /api/v1/query` (orbitql)
- `GET /api/v1/catalog/*` (assets, metrics, dimensions)

### 3.3 UI (Vite/React)
The UI is an MVP (query runner). It acts as an “oscilloscope” to validate the core.

### 3.4 Postgres
Canonical schema and rollups:
- `metric_points` (RAW) — retention: **14 days**
- `metric_rollup_5m` — retention: **90 days**
- `metric_rollup_1h` — retention: **180 days**

## 4) Data flows

### 4.1 Nagios → orbit-core
- Perfdata and HARD events are collected by shippers (cron, no-AI)
- Shippers `POST` to `/api/v1/ingest/*`

### 4.2 Query → automatic source selection (RAW vs rollup)
The backend automatically selects the source table:
- range ≤ 14d → `metric_points`
- 14–90d → `metric_rollup_5m`
- > 90d → `metric_rollup_1h`

The response includes `meta.source_table`.

## 5) Query (orbitql)

### 5.1 `timeseries`
- Single series
- Downsample + aggregation (avg/min/max/sum)

### 5.2 `timeseries_multi`
- Multi-series
- Optional `group_by_dimension`
- `top_n` (default 20), `top_by` (default count), `top_lookback_days` (default 7)

## 6) Ops (no-AI)

### 6.1 Rollups + retention
Cron jobs:
- raw→5m every 5 minutes
- 5m→1h every hour
- retention daily

## 7) Next steps
- Wazuh/OpenSearch connector (depends on network reachability)
- Dashboard builder consuming orbit-core
- Advanced catalog (dimension keys/values + server-side topN)
