# orbit-core (OSS)

**orbit-core** é o núcleo do Orbit: um **core de telemetria/eventos** com **API-first** + **Postgres**, pensado para ingestão de dados (Nagios/Wazuh/etc.), consultas rápidas (timeseries + eventos) e evolução para um produto (builder de dashboards, catálogo, conectores).

- Monorepo: **pnpm + Turborepo**
- Backend: **Node/TypeScript + Express**
- Storage: **Postgres puro (sem TimescaleDB no MVP1)**
- Licença: **Apache-2.0**

## Packages

- `@orbit/core-contracts` — tipos e contratos de API
- `@orbit/engine` — orbitql (query engine/types)
- `@orbit/storage-pg` — schema + migrations + helpers
- `@orbit/api` — API Express
- `@orbit/ui` — UI (Vite + React) para validar o core

## Endpoints (MVP)

- Health: `GET /api/v1/health`
- Metrics (JSON): `GET /api/v1/metrics`
- Metrics (Prometheus): `GET /api/v1/metrics/prom`
- Ingest: `POST /api/v1/ingest/metrics`, `POST /api/v1/ingest/events`
- Query: `POST /api/v1/query` (orbitql: `timeseries`, `timeseries_multi`, `events`)
- Catalog: `GET /api/v1/catalog/assets|metrics|dimensions`

## Retenção + rollups (no-AI)

- RAW: `metric_points` (≤ 14d)
- Rollup 5m: `metric_rollup_5m` (≤ 90d)
- Rollup 1h: `metric_rollup_1h` (≤ 180d)

O `/api/v1/query` seleciona automaticamente a fonte com base no range e retorna `meta.source_table`.

## Quickstart (dev)

### 1) Instalar

```bash
pnpm install
```

### 2) Subir Postgres (opcional)

```bash
docker compose -f scripts/dev-postgres.docker-compose.yml up -d
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/orbit'
```

### 3) Rodar API + UI

```bash
pnpm dev
```

- API: http://localhost:3000/api/v1/health
- UI: http://localhost:5173

## Docs

- Arquitetura (atual): `docs/ARCHITECTURE.md`
- RFC de arquitetura: `docs/rfc-0001-architecture.md`
- Product MVP1: `docs/product-mvp1.md`
- Wazuh query notes: `docs/wazuh-queries.md`
