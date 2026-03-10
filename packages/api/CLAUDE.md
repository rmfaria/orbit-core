# @orbit/api — Claude Code Instructions

## Overview
Express REST API (TypeScript). Entry point: `src/index.ts`.

## Structure
```
src/
├── index.ts          — App bootstrap, middleware chain
├── auth.ts           — API key validation middleware
├── db.ts             — pg Pool (max 20, 30s idle timeout)
├── env.ts            — Zod schema for env vars
├── routes/
│   ├── auth.ts       — Admin setup/login/status (public)
│   ├── connectors.ts — AI connector framework + CRUD
│   ├── ingest.ts     — Events + metrics ingestion
│   ├── query.ts      — Timeseries + events query
│   ├── catalog.ts    — Assets, metrics, events catalog
│   ├── dashboards.ts — Dashboard CRUD
│   ├── alerts.ts     — Alert rules + channels
│   ├── ai.ts         — AI agent proxy (Anthropic)
│   ├── otlp.ts       — OpenTelemetry receiver
│   └── system.ts     — System metrics
├── license/          — License verification (JWT)
└── connectors/       — Pull connector engine + DSL
```

## Conventions
- All routes mounted under `/api/v1/`
- Public routes (no auth): `/health`, `/api/v1/auth/*`, `/api/v1/license/*`
- All other routes require `X-Api-Key` or `Authorization: Bearer`
- Rate limit: 300 req/min after auth
- Request body validated inline (no separate validation layer)
- Database queries use raw SQL via `pg` Pool — no ORM
- Logging via Pino (structured JSON)

## Key Patterns
- Ingest endpoints accept batches: `{ events: [...] }` or `{ metrics: [...] }`
- Query endpoint supports `type: "timeseries" | "events" | "multi"`
- AI routes proxy to Anthropic API using caller-provided `X-Ai-Key`
- Connector DSL maps raw input fields to orbit schema

## Dev
```bash
pnpm --filter @orbit/api dev    # or from root: pnpm api:dev
```
