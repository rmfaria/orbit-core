# RFC-0001: Orbit Core Architecture

- Status: **Implemented** (superseded por [ARCHITECTURE.md](ARCHITECTURE.md))
- Owner: Orbit Core OSS
- Criado: 2026-02-22 | Atualizado: 2026-02-24

> **Nota:** Este RFC documenta as decisões de arquitetura tomadas no início do projeto.
> Para o estado atual da implementação, consulte [ARCHITECTURE.md](ARCHITECTURE.md).

## Sumário

Orbit Core é um core modular de busca/analytics para telemetria de segurança e operações.
Este RFC propõe uma arquitetura monorepo que mantém **contracts + engine + storage**
independentes do **API + UI**, permitindo troca de backend de storage futuramente (ClickHouse).

## Objetivos (MVP)

- HTTP API estável com health, ingestão e query
- Storage em Postgres (JSONB) com schema canônico para métricas e eventos
- Query engine dedicado (OrbitQL) — evita SQL raw exposto
- UI de observabilidade com gráficos, feed de eventos e dashboards
- Conectores determinísticos (sem IA) para Nagios, Wazuh, Fortigate, n8n

## Não-objetivos (MVP)

- Multi-tenant AuthZ/AuthN completo
- Streaming queries
- ClickHouse (previsto para versão futura)

## Layout do Monorepo

```
packages/
  core-contracts/   # tipos compartilhados + contratos HTTP (Zod)
  engine/           # OrbitQL — tipos e compilador de queries
  storage-pg/       # schema Postgres + migrations + helpers
  api/              # Express: rotas, auth, wiring
  ui/               # Vite + React
  nagios-shipper/   # Shipper TypeScript alternativo para Nagios
connectors/
  nagios/           # Python: ship_metrics.py, ship_events.py
  wazuh/            # Python: ship_events.py, ship_events_opensearch.py
  fortigate/        # Integração via Wazuh syslog
  n8n/              # Python: ship_events.py + orbit_error_reporter.json
```

## Interfaces-chave

### Contracts (`@orbit/core-contracts`)

- `OrbitQlQuery` = `TimeseriesQuery | TimeseriesMultiQuery | EventsQuery | EventCountQuery`
- `DashboardSpec` / `WidgetSpec` — specs de dashboards persistidos
- `QueryRequest` / `QueryResponse`
- `HealthResponse`

### Engine (`@orbit/engine`)

- Input: `QueryRequest`
- Output: `QueryPlan`

```ts
interface QueryPlan {
  target: 'postgres' | 'clickhouse';
  statement: string;
  params: unknown[];
}
```

### Storage (Postgres) (`@orbit/storage-pg`)

- Migrations em `migrations/*.sql`
- Schema canônico: `assets`, `metric_points`, `orbit_events`, `dashboards`, rollup tables

## Modelo de dados

### Métricas

```sql
metric_points (
  ts         timestamptz,
  asset_id   text,      -- ex: "host:servidor1"
  namespace  text,      -- ex: "nagios"
  metric     text,      -- ex: "load1"
  value      double precision,
  dimensions jsonb      -- ex: {"service": "CPU Load"}
)
```

### Eventos

```sql
orbit_events (
  ts          timestamptz,
  asset_id    text,
  namespace   text,      -- "wazuh", "nagios", "n8n", etc.
  kind        text,      -- ex: "authentication_failed", "state_change"
  severity    text,      -- "info" | "low" | "medium" | "high" | "critical"
  title       text,
  message     text,
  fingerprint text,      -- deduplicação
  attributes  jsonb      -- campos originais da fonte
)
```

### Dashboards

```sql
dashboards (
  id         text PRIMARY KEY,
  spec       jsonb NOT NULL,   -- DashboardSpec completo
  created_at timestamptz,
  updated_at timestamptz
)
```

## Responsabilidades da API

- Validar payloads (Zod)
- Selecionar tabela automaticamente (RAW vs rollup) baseado no range da query
- Proxy para Anthropic API com catálogo do banco como contexto (AI agent)
- Autenticação por `X-Api-Key` ou BasicAuth

## Opção ClickHouse (Futuro)

- Adicionar `@orbit/storage-ch`
- Engine escolhe o target baseado no dataset, features da query, retenção e custo

## Considerações de segurança

- SQL injection: OrbitQL compila para SQL parametrizado — sem SQL raw exposto
- AI agent: chave Anthropic passa nos headers do cliente (nunca armazenada no servidor)
- `ORBIT_API_KEY` obrigatório em produção

## Observabilidade

- HTTP logging via `pino-http`
- Métricas internas em `/api/v1/metrics` (JSON) e `/api/v1/metrics/prom` (Prometheus)
