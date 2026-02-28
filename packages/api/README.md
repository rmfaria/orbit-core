# @orbit/api

**Creator:** Rodrigo Menchio <rodrigomenchio@gmail.com>

Servidor Express para o Orbit Core — API REST completa para ingestão, query,
catálogo, dashboards, alertas, connectors, AI agent e receptor OTLP.

## Endpoints

### Infraestrutura

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/health` | Health check + build info + status do banco |
| GET | `/api/v1/metrics` | Métricas internas (JSON) |
| GET | `/api/v1/metrics/prom` | Métricas internas (Prometheus text/plain) |
| GET | `/api/v1/system` | Métricas live de infraestrutura: cpu, memory, disk, network I/O, db pool, pg_stats, workers |

### Ingestão

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/v1/ingest/metrics` | Ingestão de métricas em batch |
| POST | `/api/v1/ingest/events` | Ingestão de eventos em batch |
| POST | `/api/v1/ingest/raw/:id` | Envia payload bruto a um connector spec registrado |

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

### Alertas

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/alerts/rules` | Listar regras de alerta |
| POST | `/api/v1/alerts/rules` | Criar regra de alerta |
| GET | `/api/v1/alerts/rules/:id` | Buscar regra de alerta |
| PUT | `/api/v1/alerts/rules/:id` | Atualizar regra de alerta |
| DELETE | `/api/v1/alerts/rules/:id` | Deletar regra de alerta |
| PATCH | `/api/v1/alerts/rules/:id` | Silenciar regra de alerta |
| GET | `/api/v1/alerts/channels` | Listar canais de notificação |
| POST | `/api/v1/alerts/channels` | Criar canal de notificação |
| GET | `/api/v1/alerts/channels/:id` | Buscar canal de notificação |
| PUT | `/api/v1/alerts/channels/:id` | Atualizar canal de notificação |
| DELETE | `/api/v1/alerts/channels/:id` | Deletar canal de notificação |
| GET | `/api/v1/alerts/history` | Log de notificações disparadas |

### Connectors

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/connectors` | Listar connectors registrados |
| POST | `/api/v1/connectors` | Criar connector |
| GET | `/api/v1/connectors/:id` | Buscar connector |
| PUT | `/api/v1/connectors/:id` | Atualizar connector |
| DELETE | `/api/v1/connectors/:id` | Deletar connector |
| POST | `/api/v1/connectors/:id/approve` | Promover connector de draft → active |
| POST | `/api/v1/connectors/:id/test` | Dry-run de teste do connector |

### AI Agent

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/v1/ai/dashboard` | Gerar DashboardSpec via Claude (Anthropic) |
| POST | `/api/v1/ai/plugin` | Gerar connector_spec + agent_script + README para qualquer HTTP API (Anthropic) |

Headers obrigatórios para `/api/v1/ai/dashboard`: `X-Ai-Key` (Anthropic API key), `X-Ai-Model` (ex: `claude-sonnet-4-6`)
Body: `{ "prompt": "descreva o dashboard..." }`

Para `/api/v1/ai/plugin`, a chave pode ser fornecida via header `X-Ai-Key` ou pela variável de ambiente `ANTHROPIC_API_KEY`.
Body: `{ "prompt": "descreva a API ou fonte de dados..." }`

### Correlações

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/correlations` | Correlações de eventos detectadas automaticamente |

### OTLP Receiver

Receptor OTLP/HTTP nativo — não exige OpenTelemetry Collector.

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/otlp/v1/traces` | Receber traces (Protobuf ou JSON) |
| POST | `/otlp/v1/metrics` | Receber métricas (Protobuf ou JSON) |
| POST | `/otlp/v1/logs` | Receber logs (Protobuf ou JSON) |

Content-Type aceito: `application/x-protobuf` ou `application/json`.

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
| `ANTHROPIC_API_KEY` | — | Chave da API Anthropic para funcionalidades de AI (opcional; pode ser enviada por header) |
