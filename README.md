# orbit-core (OSS)

**orbit-core** is the Orbit product core: an **API-first telemetry + events core** backed by **Postgres**. It is designed for data ingestion (Nagios/Wazuh/etc.), fast exploration (timeseries + events), and evolution into a product (dashboard builder, catalog, connectors).

- Monorepo: **pnpm + Turborepo**
- Backend: **Node/TypeScript + Express**
- Storage: **Plain Postgres (no TimescaleDB in MVP1)**
- License: **Apache-2.0**

## Packages

- `@orbit/core-contracts` — shared types and HTTP contracts
- `@orbit/engine` — orbitql (query engine/types)
- `@orbit/storage-pg` — schema + migrations + helpers
- `@orbit/api` — Express API
- `@orbit/ui` — Vite + React UI (core validation UI)

## Endpoints (MVP)

- Health: `GET /api/v1/health`
- Metrics (JSON): `GET /api/v1/metrics`
- Metrics (Prometheus): `GET /api/v1/metrics/prom`
- Ingest: `POST /api/v1/ingest/metrics`, `POST /api/v1/ingest/events`
- Query: `POST /api/v1/query` (orbitql: `timeseries`, `timeseries_multi`, `events`)
- Catalog: `GET /api/v1/catalog/assets|metrics|dimensions`

## Retention + rollups (no-AI)

- RAW: `metric_points` (≤ 14d)
- Rollup 5m: `metric_rollup_5m` (≤ 90d)
- Rollup 1h: `metric_rollup_1h` (≤ 180d)

`/api/v1/query` automatically selects the source table based on the requested time range and returns `meta.source_table`.

## Quickstart (dev)

### 1) Install

```bash
pnpm install
```

### 2) Start Postgres (optional)

```bash
docker compose -f scripts/dev-postgres.docker-compose.yml up -d
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/orbit'
```

### 3) Run API + UI

```bash
pnpm dev
```

- API: http://localhost:3000/api/v1/health
- UI: http://localhost:5173

## Docs

- Architecture (current): `docs/ARCHITECTURE.md`
- Architecture RFC: `docs/rfc-0001-architecture.md`
- Product MVP1: `docs/product-mvp1.md`
- Wazuh query notes: `docs/wazuh-queries.md`
