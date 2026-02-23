# orbit-core — Arquitetura (Atual)

> Documento de arquitetura “estilo arquiteto de sistemas”, com foco no backend e nos fluxos de dados.

## 1) Visão geral

O **orbit-core** é o núcleo do produto Orbit: um **API-first core** + **Postgres** com um schema canônico para:

- **Assets** (`assets`)
- **Séries temporais** (`metric_points`) + **rollups** (`metric_rollup_5m`, `metric_rollup_1h`)
- **Eventos** (`orbit_events`)

Conectores (Nagios, Wazuh/OpenSearch, etc.) enviam dados via endpoints de ingestão e o Orbit consome via `/api/v1/query`.

## 2) Diagrama

![orbit-core diagram](./diagrams/orbit-core-architecture.png)

> Fonte do diagrama: `docs/diagrams/orbit-core-architecture.dot`.

## 3) Componentes

### 3.1 Edge (Traefik)
- Publicação em subpath: `https://prod.nesecurity.com.br/orbit-core/`
- TLS + BasicAuth
- `StripPrefix(/orbit-core)`
- Redirect `/orbit-core` → `/orbit-core/` (evita bug de paths relativos)

### 3.2 API (Node/Express)
Principais rotas:
- `GET /api/v1/health` (inclui build info)
- `GET /api/v1/metrics` (JSON)
- `GET /api/v1/metrics/prom` (Prometheus text/plain)
- `POST /api/v1/ingest/metrics`
- `POST /api/v1/ingest/events`
- `POST /api/v1/query` (orbitql)
- `GET /api/v1/catalog/*` (assets, metrics, dimensions)

### 3.3 UI (Vite/React)
UI é MVP (query runner). Serve como “osciloscópio” para validar o core.

### 3.4 Postgres
Schema canônico e rollups:
- `metric_points` (RAW) — retenção: **14 dias**
- `metric_rollup_5m` — retenção: **90 dias**
- `metric_rollup_1h` — retenção: **180 dias**

## 4) Fluxo de dados

### 4.1 Nagios → orbit-core
- Perfdata e HARD events são coletados por shippers (cron, no-AI)
- Shippers fazem POST em `/api/v1/ingest/*`

### 4.2 Query → seleção automática de fonte (RAW vs rollup)
O backend escolhe automaticamente a tabela:
- range ≤ 14d → `metric_points`
- 14–90d → `metric_rollup_5m`
- > 90d → `metric_rollup_1h`

A resposta inclui `meta.source_table`.

## 5) Query (orbitql)

### 5.1 `timeseries`
- Single series
- Downsample + agregação (avg/min/max/sum)

### 5.2 `timeseries_multi`
- Multi-series
- `group_by_dimension` opcional
- `top_n` (default 20), `top_by` (default count), `top_lookback_days` (default 7)

## 6) Operação (no-AI)

### 6.1 Rollups + retenção
Jobs em cron:
- raw→5m a cada 5 minutos
- 5m→1h a cada hora
- retenção diária

## 7) Próximos passos
- Conector Wazuh/OpenSearch (depende de rede/endpoint reachability)
- Dashboard builder consumindo orbit-core
- Catalog avançado (dim keys/values + topN server-side)
