# Orbit Core – Product Doc (MVP1)

Updated: 2026-02-22

## Problem

Security teams need a fast way to explore endpoint/security telemetry (starting with Wazuh) with a consistent query API and a lightweight UI.

## Target Users

- SOC analysts
- Detection engineers
- Platform engineers operating Wazuh

## MVP1 Scope

### Must Have

- API server
  - `GET /api/v1/health`
  - `POST /api/v1/query` (placeholder in scaffold)
- Postgres schema + migrations
  - `events` table storing raw JSON (`jsonb`)
- Minimal UI
  - Shows API health
  - Placeholder for query UI
- Documentation
  - Architecture RFC
  - Wazuh query examples

### Nice to Have

- Basic ingestion endpoint (`POST /api/v1/events`) with batch insert
- Saved queries (in DB)
- Simple auth (API key)

## MVP1 User Journeys

1. Operator starts services (Postgres + API + UI)
2. Operator loads events into `events` table (manual or script)
3. Analyst runs a query to find:
   - top noisy rules
   - events by agent
   - high severity alerts last N hours

## Success Criteria

- Local dev setup under 5 minutes (excluding Postgres)
- Queries return in < 2 seconds for small datasets (10k–100k events)
- Clear extension points for ClickHouse and for ingestion

## Constraints / Assumptions

- MVP stores raw Wazuh JSON and indexes only a few fields.
- SQL execution is risky; MVP should gate raw SQL or restrict it.

## Roadmap (Post-MVP)

- Ingestion service + parsing normalization
- OrbitQL (safe query language)
- ClickHouse storage adapter
- AuthN/AuthZ + multi-tenant
- UI query builder, timepicker, saved views
