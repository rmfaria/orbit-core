# orbit-core — Arquitetura (atual)

Atualizado: 2026-02-24

## 1) Visão geral

**orbit-core** é um core de telemetria + eventos **API-first** + **Postgres**, com schema canônico para:

- **Ativos** (`assets`)
- **Séries temporais** (`metric_points`) + **rollups** (`metric_rollup_5m`, `metric_rollup_1h`)
- **Eventos** (`orbit_events`)
- **Dashboards** (`dashboards`)

Conectores (Nagios, Wazuh, Fortigate, n8n) enviam dados via endpoints de ingestão.
Consumidores consultam via `POST /api/v1/query`.
Um **AI agent** interpreta prompts em linguagem natural, consulta o catálogo do banco
e gera `DashboardSpec` via API Anthropic Claude.

## 2) Componentes

### 2.1 Edge (reverse proxy)

Configuração típica de produção (Traefik / Nginx):

- Terminação TLS
- Autenticação por API Key (`X-Api-Key` header) — gerenciada pelo container da API, não pelo proxy
- Roteamento por subpath (ex: `/orbit-core/`)
- Redirect `/orbit-core` → `/orbit-core/` para evitar problemas de path relativo no SPA

### 2.2 API (Node 22 / Express)

Rotas principais:

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/health` | Health + build info + status do banco |
| GET | `/api/v1/metrics` | Métricas internas (JSON) |
| GET | `/api/v1/metrics/prom` | Métricas internas (Prometheus) |
| POST | `/api/v1/ingest/metrics` | Ingestão de métricas em batch |
| POST | `/api/v1/ingest/events` | Ingestão de eventos em batch |
| POST | `/api/v1/query` | Queries OrbitQL |
| GET | `/api/v1/catalog/assets` | Catálogo de ativos |
| GET | `/api/v1/catalog/metrics` | Catálogo de métricas por ativo |
| GET | `/api/v1/catalog/dimensions` | Valores de dimensões |
| GET | `/api/v1/catalog/events` | Catálogo de namespaces de eventos |
| CRUD | `/api/v1/dashboards/*` | Gerenciamento de dashboards (JSONB) |
| POST | `/api/v1/ai/dashboard` | Proxy Anthropic + geração de DashboardSpec |
| GET | `/api/v1/correlations` | Correlação de eventos |

**Autenticação:** `X-Api-Key` header (variável `ORBIT_API_KEY` no servidor).
BasicAuth é suportado como fallback para compatibilidade.

**Limite de payload:** `express.json({ limit: '1mb' })` — manter `BATCH_SIZE` ≤ 100 em eventos
grandes (ex: Wazuh) para não exceder o limite.

### 2.3 UI (Vite + React)

Interface de observabilidade completa:

| Aba | Conteúdo |
|-----|----------|
| **Home** | KPIs, gráficos de série temporal (CPU, Disk, Net, Suricata), EPS do Wazuh, live feed consolidado |
| **Dashboards** | Builder com AI assistant, lista de dashboards salvos, modo view em grid, rotação/slideshow |
| **Métricas** | Query builder para `timeseries` e `timeseries_multi` com seleção de ativo/namespace/métrica |
| **Eventos** | Tabela filtrada de eventos com suporte a namespace, severidade e range de tempo |
| **Correlações** | Feed de correlações de eventos detectadas automaticamente |
| **Nagios** | Aba dedicada: métricas Nagios por host |
| **Wazuh** | Aba dedicada: EPS chart + tabela de alertas Wazuh |
| **Fortigate** | Aba dedicada: feed de eventos Fortigate (via namespace wazuh/kind=fortigate) |
| **n8n** | Aba dedicada: falhas e execuções travadas de workflows |
| **Admin** | API Key, configuração do AI Agent (Anthropic key + modelo), status das fontes |

A API Key é persistida em `localStorage` e pode ser pré-configurada em build via
`VITE_ORBIT_API_KEY` (`.env` no pacote UI).

### 2.4 Postgres

Schema canônico com rollups e retenção automática:

| Tabela | Conteúdo | Retenção |
|--------|----------|----------|
| `assets` | Catálogo de ativos com nome, tipo, tags | — |
| `metric_points` | Métricas RAW (valor + dimensões JSONB) | 14 dias |
| `metric_rollup_5m` | Rollup 5 minutos | 90 dias |
| `metric_rollup_1h` | Rollup 1 hora | 180 dias |
| `orbit_events` | Eventos normalizados (ts, asset_id, namespace, kind, severity, title, message, attributes, fingerprint) | — |
| `orbit_correlations` | Correlações detectadas automaticamente | — |
| `dashboards` | Specs de dashboards como JSONB (id text PK, spec jsonb) | — |

## 3) Fluxo de dados

### 3.1 Conectores → orbit-core

```
Nagios perfdata spool  → ship_metrics.py  → POST /api/v1/ingest/metrics
Nagios HARD events     → ship_events.py   → POST /api/v1/ingest/events
Wazuh alerts.json      → ship_events.py   → POST /api/v1/ingest/events
n8n REST API           → ship_events.py   → POST /api/v1/ingest/events
Fortigate syslog → Wazuh → ship_events.py → POST /api/v1/ingest/events
```

Todos os conectores são **determinísticos** (sem IA), seguros para cron,
com rastreamento de estado via arquivo (byte-offset ou timestamp ISO 8601).

### 3.2 AI Agent — fluxo end-to-end

```
1. UI: usuário digita prompt → POST /api/v1/ai/dashboard
   Headers: X-Ai-Key (Anthropic), X-Ai-Model (ex: claude-sonnet-4-6)
   Body: { prompt: string }

2. API: 6 queries paralelas ao banco
   - asset_metrics: métricas por ativo (namespace, metric, pts)
   - asset_names: nomes legíveis dos ativos
   - eventNsStats: namespaces de eventos com total + last_seen
   - eventKinds: tipos de evento por namespace
   - eventAgents: agentes por namespace
   - eventSevs: distribuição de severidade por namespace

3. API: monta system prompt com catálogo real + schema + guias

4. API: POST https://api.anthropic.com/v1/messages
   Headers: x-api-key, anthropic-version: 2023-06-01
   Body: { model, max_tokens: 4096, system, messages }

5. API: extrai JSON da resposta, valida com DashboardSpecSchema (Zod)

6. API: retorna { ok: true, spec: DashboardSpec }

7. UI: preenche builder com os widgets gerados (editável)
```

### 3.3 Query → seleção automática de fonte (RAW vs rollup)

O backend seleciona a tabela com base no range solicitado:

| Range | Tabela |
|-------|--------|
| ≤ 14 dias | `metric_points` (RAW) |
| 14–90 dias | `metric_rollup_5m` |
| > 90 dias | `metric_rollup_1h` |

A resposta inclui `meta.source_table`.

## 4) OrbitQL — tipos de query

### 4.1 `timeseries`

Série temporal única com downsample e agregação opcional (`avg`/`min`/`max`/`sum`).
**Requer `asset_id`.**

```json
{
  "kind": "timeseries",
  "asset_id": "host:servidor1",
  "namespace": "nagios",
  "metric": "load1",
  "from": "2026-02-24T00:00:00Z",
  "to": "2026-02-24T01:00:00Z"
}
```

### 4.2 `timeseries_multi`

Múltiplas séries. **Requer `series` array com `asset_id` por entrada.**
Suporta:
- `group_by_dimension` — split por dimensão (ex: `"service"`)
- `top_n` (padrão 20), `top_by` (`count` ou `last`), `top_lookback_days` (padrão 7)

```json
{
  "kind": "timeseries_multi",
  "series": [
    { "asset_id": "host:srv1", "namespace": "nagios", "metric": "load1", "label": "srv1" },
    { "asset_id": "host:srv2", "namespace": "nagios", "metric": "load1", "label": "srv2" }
  ],
  "from": "...", "to": "..."
}
```

### 4.3 `events`

Busca filtrada de eventos. Filtros: `namespace`, `asset_id`, `severities`, `kinds`, range de tempo.

```json
{
  "kind": "events",
  "namespace": "wazuh",
  "severities": ["high", "critical"],
  "from": "...", "to": "...",
  "limit": 50
}
```

### 4.4 `event_count`

Contagem de eventos em buckets de tempo — usado para calcular EPS (eventos/segundo).
Retorna `ts` + `value` (count / bucket_sec). `bucket_sec` é selecionado automaticamente
com base no range se não especificado.

## 5) DashboardSpec

Dashboards são salvos como JSONB na tabela `dashboards`. Schema (Zod):

```typescript
DashboardSpec = {
  id: string,
  name: string,
  description?: string,
  version: "v1",
  time: { preset: "60m" | "6h" | "24h" | "7d" | "30d" },
  tags: string[],
  widgets: WidgetSpec[]   // 1-60
}

WidgetSpec = {
  id: string,
  title: string,
  kind: "timeseries" | "timeseries_multi" | "events" | "eps" | "kpi",
  layout: { x: number, y: number, w: 1 | 2, h: number },
  query: OrbitQlQuery   // SEM from/to — adicionados em runtime pelo renderer
}
```

## 6) Operações

### 6.1 Rollups + retenção

Jobs de background executados pelo próprio processo da API:
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

### 6.3 Deploy script

```bash
bash /root/.openclaw/workspace/orbit-core/deploy.sh
```

O script faz: git pull → build (core-contracts → api → ui) → migrations → restart systemd + Docker service → health check.

## 7) Conectores

Ver [docs/connectors.md](connectors.md) para visão geral completa.

| Conector | Namespace | Script | Modo |
|----------|-----------|--------|------|
| Nagios | `nagios` | `ship_metrics.py`, `ship_events.py` | Passivo (arquivo local) |
| Wazuh | `wazuh` | `ship_events.py` | Passivo (arquivo local) |
| Wazuh | `wazuh` | `ship_events_opensearch.py` | Ativo (OpenSearch REST) |
| Fortigate | `wazuh` / `kind=fortigate` | via Wazuh | Passivo |
| n8n | `n8n` | `ship_events.py` | Ativo (polling REST API) |
