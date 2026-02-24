# orbit-core — Arquitetura (atual)

Atualizado: 2026-02-24

## 1) Visão geral

**orbit-core** é um core de telemetria + eventos **API-first** + **Postgres**, com schema canônico para:

- **Ativos** (`assets`)
- **Séries temporais** (`metric_points`) + **rollups** (`metric_rollup_5m`, `metric_rollup_1h`)
- **Eventos** (`orbit_events`)

Conectores (Nagios, Wazuh, Fortigate, n8n) enviam dados via endpoints de ingestão.
Consumidores consultam via `POST /api/v1/query`.

## 2) Diagrama

![orbit-core diagram](./diagrams/orbit-core-architecture.png)

Fonte: `docs/diagrams/orbit-core-architecture.dot`

## 3) Componentes

### 3.1 Edge (reverse proxy)

Configuração típica de produção (Traefik / Nginx):

- Terminação TLS
- Autenticação por API Key (`X-Api-Key` header) — gerenciada pelo container da API, não pelo proxy
- Roteamento por subpath (ex: `/orbit-core/`)
- Redirect `/orbit-core` → `/orbit-core/` para evitar problemas de path relativo no SPA

### 3.2 API (Node/Express)

Rotas principais:

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/health` | Health + build info + status do banco |
| GET | `/api/v1/metrics` | Métricas internas (JSON) |
| GET | `/api/v1/metrics/prom` | Métricas internas (Prometheus) |
| POST | `/api/v1/ingest/metrics` | Ingestão de métricas em batch |
| POST | `/api/v1/ingest/events` | Ingestão de eventos em batch |
| POST | `/api/v1/query` | Queries OrbitQL |
| GET | `/api/v1/catalog/*` | Catálogo de ativos, métricas e dimensões |
| GET/POST | `/api/v1/dashboards/*` | Gerenciamento de dashboards |
| GET/POST | `/api/v1/correlations/*` | Correlação de eventos |

**Autenticação:** `X-Api-Key` header (variável `ORBIT_API_KEY` no servidor).
BasicAuth é suportado como fallback para compatibilidade.

**Limite de payload:** `express.json({ limit: '1mb' })` — manter `BATCH_SIZE` ≤ 100 em eventos
grandes (ex: Wazuh) para não exceder o limite.

### 3.3 UI (Vite + React)

Interface de observabilidade completa:

| Aba | Conteúdo |
|-----|----------|
| **Home** | KPIs, gráficos de série temporal (CPU, Disk, Net, Suricata), EPS do Wazuh, live feed consolidado |
| **Métricas** | Query builder para `timeseries` e `timeseries_multi` com seleção de ativo/namespace/métrica |
| **Eventos** | Tabela filtrada de eventos com suporte a namespace, severidade e range de tempo |
| **Wazuh** | Aba dedicada: EPS chart + tabela de alertas Wazuh |
| **Dashboards** | Builder de dashboards salvos |
| **Admin** | Configuração da API Key |

A API Key é persistida em `localStorage` e pode ser pré-configurada em build via
`VITE_ORBIT_API_KEY` (`.env` no pacote UI).

### 3.4 Postgres

Schema canônico com rollups e retenção automática:

| Tabela | Conteúdo | Retenção |
|--------|----------|----------|
| `assets` | Catálogo de ativos | — |
| `metric_points` | Métricas RAW | 14 dias |
| `metric_rollup_5m` | Rollup 5 minutos | 90 dias |
| `metric_rollup_1h` | Rollup 1 hora | 180 dias |
| `orbit_events` | Eventos normalizados | — |
| `correlations` | Correlação de eventos | — |

## 4) Fluxo de dados

### 4.1 Conectores → orbit-core

```
Nagios perfdata spool  → ship_metrics.py  → POST /api/v1/ingest/metrics
Nagios HARD events     → ship_events.py   → POST /api/v1/ingest/events
Wazuh alerts.json      → ship_events.py   → POST /api/v1/ingest/events
n8n REST API           → ship_events.py   → POST /api/v1/ingest/events
Fortigate syslog → Wazuh → ship_events.py → POST /api/v1/ingest/events
```

Todos os conectores são **determinísticos** (sem IA), seguros para cron,
com rastreamento de estado via arquivo (byte-offset ou timestamp ISO 8601).

### 4.2 Query → seleção automática de fonte (RAW vs rollup)

O backend seleciona a tabela com base no range solicitado:

| Range | Tabela |
|-------|--------|
| ≤ 14 dias | `metric_points` (RAW) |
| 14–90 dias | `metric_rollup_5m` |
| > 90 dias | `metric_rollup_1h` |

A resposta inclui `meta.source_table`.

## 5) OrbitQL — tipos de query

### 5.1 `timeseries`

Série temporal única com downsample e agregação opcional (`avg`/`min`/`max`/`sum`).

### 5.2 `timeseries_multi`

Múltiplas séries. Suporta:
- `group_by_dimension` — split por dimensão (ex: `"service"`)
- `top_n` (padrão 20), `top_by` (`count` ou `last`), `top_lookback_days` (padrão 7)

### 5.3 `events`

Busca filtrada de eventos. Filtros: `namespace`, `asset_id`, `severities`, `kinds`, range de tempo.

### 5.4 `event_count`

Contagem de eventos em buckets de tempo — usado para calcular EPS (eventos/segundo).
Retorna `ts` + `value` (count / bucket_sec). `bucket_sec` é selecionado automaticamente
com base no range se não especificado.

## 6) Operações

### 6.1 Rollups + retenção

Jobs executados via SQL scheduled (ou cron externo):
- RAW → 5m: a cada 5 minutos
- 5m → 1h: a cada hora
- Retenção (purge): diariamente

### 6.2 Deploy de produção (Docker Swarm + Traefik)

```
Internet → Traefik (TLS) → /orbit-core/api/* → orbitcore_api (Node, porta 3000)
                         → /orbit-core/*      → orbitcore_ui  (Nginx, servindo dist/)
```

Variáveis de ambiente do container da API:
- `DATABASE_URL` — connection string do Postgres
- `ORBIT_API_KEY` — chave de autenticação
- `NODE_ENV=production`

## 7) Conectores

Ver [docs/connectors.md](connectors.md) para visão geral completa.

| Conector | Namespace | Script | Modo |
|----------|-----------|--------|------|
| Nagios | `nagios` | `ship_metrics.py`, `ship_events.py` | Passivo (arquivo local) |
| Wazuh | `wazuh` | `ship_events.py` | Passivo (arquivo local) |
| Wazuh | `wazuh` | `ship_events_opensearch.py` | Ativo (OpenSearch REST) |
| Fortigate | `wazuh` / `kind=fortigate` | via Wazuh | Passivo |
| n8n | `n8n` | `ship_events.py` | Ativo (polling REST API) |
