# @orbit/api

Servidor Express para o Orbit Core — API REST completa para ingestão, query,
catálogo, dashboards e AI agent.

## Endpoints

### Infraestrutura

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/health` | Health check + build info + status do banco |
| GET | `/api/v1/metrics` | Métricas internas (JSON) |
| GET | `/api/v1/metrics/prom` | Métricas internas (Prometheus text/plain) |

### Ingestão

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/v1/ingest/metrics` | Ingestão de métricas em batch |
| POST | `/api/v1/ingest/events` | Ingestão de eventos em batch |

### Query

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/v1/query` | Query OrbitQL (timeseries / timeseries_multi / events / event_count) |

### Catálogo

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/catalog/assets` | Lista ativos (`?q=<filtro>&limit=<n>`) |
| GET | `/api/v1/catalog/metrics` | Métricas de um ativo (`?asset_id=...&namespace=...`) |
| GET | `/api/v1/catalog/dimensions` | Valores de dimensões (`?asset_id=...&namespace=...&metric=...&key=...`) |
| GET | `/api/v1/catalog/events` | Namespaces de eventos com kinds, agents e severities |

### Dashboards

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/dashboards` | Listar dashboards (id, name, widget_count, updated_at) |
| GET | `/api/v1/dashboards/:id` | Buscar dashboard completo |
| POST | `/api/v1/dashboards` | Criar dashboard (corpo: DashboardSpec) |
| PUT | `/api/v1/dashboards/:id` | Atualizar dashboard |
| DELETE | `/api/v1/dashboards/:id` | Deletar dashboard |
| POST | `/api/v1/dashboards/validate` | Validar spec sem persistir |

### AI Agent

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/v1/ai/dashboard` | Gerar DashboardSpec via Claude (Anthropic) |

Headers obrigatórios: `X-Ai-Key` (Anthropic API key), `X-Ai-Model` (ex: `claude-sonnet-4-6`)
Body: `{ "prompt": "descreva o dashboard..." }`

### Correlações

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/correlations` | Correlações de eventos detectadas automaticamente |

## Autenticação

Configure `ORBIT_API_KEY` no ambiente. A API exige o header `X-Api-Key: <chave>` em
todos os endpoints (exceto `/api/v1/health`). BasicAuth é suportado como fallback.

## Dev

```bash
pnpm --filter @orbit/api dev
```

## Build

```bash
# Obrigatório: build core-contracts antes da API
pnpm --filter @orbit/core-contracts build
pnpm --filter @orbit/api build
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta de escuta |
| `DATABASE_URL` | — | Connection string Postgres |
| `ORBIT_API_KEY` | — | Chave de autenticação (obrigatória em prod) |
| `NODE_ENV` | `development` | Ambiente |
| `LOG_LEVEL` | `info` | Nível de log (pino) |
