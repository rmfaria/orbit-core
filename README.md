# orbit-core

**orbit-core** é um core de telemetria + eventos **API-first**, com backend em Postgres.
Ingere dados de Nagios, Wazuh, Fortigate, n8n e qualquer fonte via conectores determinísticos,
e expõe uma UI de observabilidade com dashboards personalizados, gráficos, feed de eventos
ao vivo, EPS e um **AI agent** para geração automática de dashboards via Claude.

- Monorepo: **pnpm + Turborepo**
- Backend: **Node 22 / TypeScript + Express**
- Storage: **Postgres 16** (sem TimescaleDB)
- Licença: **Apache-2.0**

## Pacotes

| Pacote | Descrição |
|--------|-----------|
| `@orbit/core-contracts` | Tipos compartilhados e contratos HTTP (Zod) |
| `@orbit/engine` | OrbitQL — tipos e engine de queries |
| `@orbit/storage-pg` | Schema Postgres + migrations + helpers |
| `@orbit/api` | Servidor Express (porta 3000) |
| `@orbit/ui` | UI Vite + React |
| `@orbit/nagios-shipper` | Shipper TypeScript alternativo para Nagios |

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/health` | Health check + build info + status do banco |
| GET | `/api/v1/metrics` | Métricas internas (JSON) |
| GET | `/api/v1/metrics/prom` | Métricas internas (Prometheus text/plain) |
| POST | `/api/v1/ingest/metrics` | Ingestão de métricas em batch |
| POST | `/api/v1/ingest/events` | Ingestão de eventos em batch |
| POST | `/api/v1/query` | Queries OrbitQL |
| GET | `/api/v1/catalog/assets` | Catálogo de ativos |
| GET | `/api/v1/catalog/metrics` | Catálogo de métricas por ativo |
| GET | `/api/v1/catalog/dimensions` | Valores de dimensões |
| GET | `/api/v1/catalog/events` | Catálogo de namespaces de eventos (kinds, agents, severities) |
| GET | `/api/v1/dashboards` | Listar dashboards salvos |
| GET | `/api/v1/dashboards/:id` | Buscar dashboard por ID |
| POST | `/api/v1/dashboards` | Criar dashboard |
| PUT | `/api/v1/dashboards/:id` | Atualizar dashboard |
| DELETE | `/api/v1/dashboards/:id` | Deletar dashboard |
| POST | `/api/v1/dashboards/validate` | Validar spec (sem persistência) |
| POST | `/api/v1/ai/dashboard` | Gerar DashboardSpec via AI (Claude) |
| GET | `/api/v1/correlations` | Correlação de eventos |

## Autenticação

A API aceita autenticação via **API Key** (recomendado) ou **BasicAuth** (legado):

```
X-Api-Key: <sua-chave>
```

Configure a chave no servidor com a variável de ambiente `ORBIT_API_KEY`.
No cliente, a chave é armazenada no `localStorage` sob a chave `orbit_api_key`.

## OrbitQL — tipos de query

```jsonc
// Série temporal única — requer asset_id
{ "kind": "timeseries", "asset_id": "host:srv1", "namespace": "nagios", "metric": "load1", "from": "...", "to": "..." }

// Múltiplas séries
{ "kind": "timeseries_multi", "series": [{"asset_id": "...", "namespace": "nagios", "metric": "load1", "label": "srv1"}], "from": "...", "to": "..." }

// Eventos filtrados
{ "kind": "events", "namespace": "wazuh", "from": "...", "to": "...", "severities": ["high", "critical"], "limit": 100 }

// Contagem de eventos por bucket de tempo (EPS)
{ "kind": "event_count", "namespace": "wazuh", "from": "...", "to": "...", "bucket_sec": 60 }
```

## Dashboard Builder + AI Agent

A aba **Dashboards** permite criar painéis com widgets de qualquer fonte.

**Modos:**
- **Lista** — dashboards salvos com Abrir / Editar / Deletar e modo rotação (slideshow)
- **Builder** — criador/editor com assistente de IA e adição manual de widgets
- **View** — renderização em grid com atualização por preset de tempo

**Widgets disponíveis:**

| Kind | Descrição | Span |
|------|-----------|------|
| `timeseries` | Gráfico de linha — série única | 1 (metade) |
| `timeseries_multi` | Gráfico de linha — múltiplas séries | 2 (inteiro) |
| `events` | Feed de eventos filtrado | 1 ou 2 |
| `eps` | Gráfico EPS (eventos/segundo) | 2 |
| `kpi` | Valor instantâneo (último ponto) | 1 |

**AI Agent:**
1. Configure a **Anthropic API Key** e o **modelo** em Admin → AI Agent
2. Em Dashboards → Criar, descreva o dashboard em linguagem natural
3. Clique **⚡ Gerar com IA** — o AI consulta o catálogo real do banco e gera a spec
4. Revise os widgets no builder, ajuste e clique **Salvar**

O endpoint `POST /api/v1/ai/dashboard` recebe `X-Ai-Key` + `X-Ai-Model` nos headers
e `{ prompt: string }` no body. Retorna `{ ok: true, spec: DashboardSpec }`.

## Retenção + rollups

| Tabela | Retenção | Uso |
|--------|----------|-----|
| `metric_points` (RAW) | 14 dias | Range ≤ 14d |
| `metric_rollup_5m` | 90 dias | Range 14–90d |
| `metric_rollup_1h` | 180 dias | Range > 90d |

`/api/v1/query` seleciona a tabela automaticamente e retorna `meta.source_table`.

## Quickstart (dev)

### 1) Instalar dependências

```bash
pnpm install
```

### 2) Subir Postgres

```bash
docker compose -f scripts/dev-postgres.docker-compose.yml up -d
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/orbit'
```

### 3) Rodar migrations

```bash
pnpm db:migrate
```

### 4) Iniciar API + UI

```bash
pnpm dev
```

- API: http://localhost:3000/api/v1/health
- UI: http://localhost:5173

## Conectores

| Conector | Namespace | Instalação |
|----------|-----------|------------|
| Nagios (métricas + eventos) | `nagios` | [connectors/nagios/INSTALL.md](connectors/nagios/INSTALL.md) |
| Wazuh (alertas de segurança) | `wazuh` | [connectors/wazuh/INSTALL.md](connectors/wazuh/INSTALL.md) |
| Fortigate (via Wazuh syslog) | `wazuh` / `kind=fortigate` | [connectors/fortigate/INSTALL.md](connectors/fortigate/INSTALL.md) |
| n8n (falhas de workflow) | `n8n` | [connectors/n8n/INSTALL.md](connectors/n8n/INSTALL.md) |

Ver [docs/connectors.md](docs/connectors.md) para visão geral e guia de desenvolvimento.

## Documentação

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Arquitetura atual
- [docs/connectors.md](docs/connectors.md) — Guia de conectores
- [docs/dashboard-playbook.md](docs/dashboard-playbook.md) — Padrões de dashboards
- [docs/wazuh-queries.md](docs/wazuh-queries.md) — Exemplos de queries Wazuh
- [docs/rfc-0001-architecture.md](docs/rfc-0001-architecture.md) — RFC de arquitetura (histórico)
- [docs/product-mvp1.md](docs/product-mvp1.md) — Product doc atual
