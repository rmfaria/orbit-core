# @orbit/storage-pg — Claude Code Instructions

## Overview
PostgreSQL 16 migrations and migration runner.

## Structure
```
migrations/       — Sequential SQL files (0001 to 0023)
migrate.ts        — Migration runner (tracks applied in DB)
```

## Conventions
- Migration files: `NNNN_descriptive_name.sql` (zero-padded 4 digits)
- Next available number: **0025**
- Migrations are forward-only (no down migrations)
- Each migration runs in a transaction
- Key tables: `orbit_events`, `metric_points`, `orbit_settings`, `connector_specs`, `dashboards`, `alert_rules`, `alert_channels`, `threat_indicators`
- `orbit_settings`: key-value store (license, admin auth, deployment ID)

## Creating a New Migration
1. Create `migrations/0024_your_name.sql`
2. Write idempotent SQL when possible (`IF NOT EXISTS`, `CREATE INDEX CONCURRENTLY`)
3. Run: `pnpm db:migrate` (from root)
