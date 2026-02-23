# RFC-0001: Orbit Core Architecture (MVP)

- Status: Draft
- Owner: Orbit Core OSS
- Updated: 2026-02-22

## Summary

Orbit Core is a modular search/analytics core for security telemetry (starting with Wazuh events). This RFC proposes a monorepo architecture that keeps **contracts + engine + storage** independent from the **API + UI**.

## Goals (MVP1)

- Provide a stable HTTP API for:
  - health (`GET /api/v1/health`)
  - query execution (`POST /api/v1/query`)
- Store raw events in Postgres (JSONB) with minimal indexing.
- Keep query semantics in a dedicated engine package.
- Enable optional ClickHouse later without rewriting the API.

## Non-goals (MVP1)

- Multi-tenant authZ/authN (define hooks, not full implementation)
- Streaming queries
- Complex ingestion pipeline (shipper/collector)

## Monorepo Layout

```
packages/
  core-contracts/   # shared types + wire contracts
  engine/           # query language + compiler -> plan
  storage-pg/       # postgres adapter + migrations
  api/              # express server: routes, auth, wiring
  ui/               # vite+react UI
```

## Key Interfaces

### Contracts (`@orbit/core-contracts`)

- `QueryRequest` / `QueryResponse`
- `HealthResponse`
- Standard error envelope (future)

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

- `runPlan(pool, plan)`
- Migrations in `migrations/*.sql`
- MVP schema: `events` table with `raw jsonb`

## Data Model (MVP)

- `events.raw` holds full Wazuh event JSON
- promote a few common fields for indexing:
  - `event_time`, `agent_id`, `rule_id`, `level`

## API Responsibilities

- Validate incoming payloads (zod)
- Call `engine.compileQuery()`
- Call storage adapter to execute query plan
- Return results in contract shape

## ClickHouse Option (Future)

- Add `@orbit/storage-ch` package
- Engine chooses plan target based on dataset, query features, retention, cost.

## Security Considerations

- SQL injection: MVP should treat SQL as **unsafe**; only allow in trusted deployments or behind admin flag.
- Future: implement allowlisted SQL, or OrbitQL compilation that produces safe parameterized SQL.

## Observability

- HTTP logging via `pino-http`
- Later: metrics + tracing.

## Open Questions

1. Do we accept raw SQL in MVP (admin-only), or require OrbitQL from day one?
2. Multi-tenant: how will tenant filters be expressed (engine injection vs storage views)?
3. Expected event volume and retention targets (impacts ClickHouse prioritization).
