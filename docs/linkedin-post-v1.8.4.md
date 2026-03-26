Orbit Core v1.8.4 — Database Scaling Engine (Phase 1)

We hit the wall where a single shared connection pool, unpartitioned rollup tables, and a 512 MB PostgreSQL container couldn't keep up anymore. This release lays the foundation for real scaling.

The biggest change is pool isolation. API requests and background workers (rollup, correlate, alerts, threat-intel, connectors) now run on completely separate pg.Pool instances — 35 connections for the API, 15 for workers. Workers can no longer starve user queries during heavy rollup cycles. Worker timeouts are also 4x longer (120s vs 30s) because a correlate run across 24 hours of data shouldn't be killed by the same timeout that guards a dashboard query.

Both rollup tables (metric_rollup_5m and metric_rollup_1h) are now range-partitioned by month. Before this, every INSERT ON CONFLICT scanned the entire primary key index across 90 days of 5-minute data. Now it only touches the current month's partition. Retention cleanup becomes a single DROP PARTITION instead of DELETE WHERE across millions of rows.

The events catalog endpoint was running 4 parallel GROUP BY queries over 30 days of orbit_events on every single request. We replaced that with a materialized cache table that the rollup worker refreshes every 5 minutes. Catalog response time: ~500ms down to <5ms.

PostgreSQL resources are doubled. Container memory goes from 512 MB to 1 GB. shared_buffers jumps to 384 MB, effective_cache_size to 768 MB, work_mem to 8 MB. The buffer cache hit ratio should improve significantly on repeated time-range queries.

This is Phase 1 of a 3-phase scaling plan. Phase 2 separates workers into their own Docker service, adds Redis as a shared cache layer, and introduces PgBouncer + read replicas. Phase 3 evaluates TimescaleDB for native time-series compression and continuous aggregates.

Self-hosted. Your data stays on your server. Always.

Apache-2.0 — free forever.

https://github.com/rmfaria/orbit-core

#CyberSecurity #SIEM #ThreatIntelligence #OpenSource #InfoSec #SecurityOperations #DevSecOps #Observability #SOC #BlueTeam
