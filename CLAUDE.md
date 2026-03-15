# Orbit Core — Claude Code Instructions

## Project Overview
Orbit Core is an observability platform (events + metrics) for security/infrastructure monitoring.
Monorepo managed with pnpm workspaces + Turborepo. Node >= 22, pnpm 9.x.

## Tech Stack
- **API**: Express + TypeScript (`packages/api/`)
- **UI**: React SPA (`packages/ui/`) — single-file App.tsx (~6200 lines)
- **DB**: PostgreSQL 16, migrations in `packages/storage-pg/migrations/`
- **Connectors**: Python shippers (`connectors/`) + TypeScript pull engine (`connectors/n8n/`)
- **Contracts**: Shared types (`packages/core-contracts/`)
- **Deploy**: Docker multi-stage, Docker Swarm + Traefik in production

## Commands
```bash
pnpm dev          # Start all services (turbo)
pnpm api:dev      # API only
pnpm ui:dev       # UI only
pnpm build        # Build all packages
pnpm test         # Run all tests
pnpm lint         # Lint all packages
pnpm typecheck    # TypeScript check
pnpm db:migrate   # Run SQL migrations
```

## Critical Rules
- **NEVER run stress tests, benchmarks, or load tests against prod.nesecurity.com.br** — use `docker-compose.staging.yml` locally or on a staging VPS instead. The prod server has only 8GB RAM shared with other services.
- **NEVER run VACUUM FULL on prod** without first checking available RAM and disk. Use regular VACUUM instead.
- **NEVER scale all services to 0 and back up simultaneously** on the 8GB prod server — start PG first, then API, then the rest.

## Conventions
- Language: code, commits, and comments in **English**
- Commit style: short imperative (`add X`, `fix Y`, `update Z`)
- Migrations: sequential numbered SQL files (`0001_init.sql` ... `0024_threat_indicators.sql`). Next = `0025_*.sql`
- API routes: `/api/v1/<resource>` — RESTful, JSON body
- Auth: `X-Api-Key` header or `Authorization: Bearer <key>`
- Environment variables validated with Zod (`packages/api/src/env.ts`)
- No auto-push — only push when explicitly asked

## Architecture Quick Ref
- Middleware chain: CORS → JSON → Pino → metrics → reqId → health → license → auth → rate-limit → routes
- Ingest: POST `/api/v1/ingest/events` and `/api/v1/ingest/metrics` (batch)
- Query: POST `/api/v1/query` (timeseries, events, multi)
- AI features: connector generation, smart dashboards (Anthropic API)
- orbit-viz.js: standalone vanilla JS chart engine for AI-generated dashboards

## Important Files
- `packages/api/src/index.ts` — API entry point
- `packages/api/src/routes/` — all route handlers
- `packages/ui/src/ui/App.tsx` — entire SPA
- `packages/storage-pg/migrations/` — DB schema
- `docker-compose.yml` — local dev stack
- `Dockerfile` — multi-stage production build
- `deploy.sh` — production deploy script
