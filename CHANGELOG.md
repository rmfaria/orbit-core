# Changelog

All notable changes to orbit-core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.6.1] - 2026-03-04

### Added

- **Suricata EVE-JSON connector**: push-mode Python shipper that parses Suricata EVE logs (alert, anomaly, HTTP, SSH events) with severity mapping and network context attributes
- **Suricata in UI live feed**: dedicated source tab, namespace filter pills, and color-coded events (#f87171 coral red) in the dashboard
- **First-access password setup**: on first boot, admin creates password via `/api/v1/auth/setup`; subsequent logins via `/api/v1/auth/login` with scrypt-hashed credentials stored in `orbit_settings`
- **Auth middleware DB support**: API key resolution from `orbit_settings` table with 60-second cache, fallback to `ORBIT_API_KEY` env var
- **HTTPS for local Docker Compose**: self-signed TLS certificate, nginx SSL termination on port 443, HTTP→HTTPS redirect
- **Privacy Policy page**: published at orbit-core.org/privacy.html for API compliance
- **LinkedIn Publisher workflow**: n8n webhook-triggered workflow for posting to LinkedIn via OAuth2

### Changed

- **Login page modernized**: replaced BasicAuth with styled dark-theme login page and cookie-based session auth
- **AuthGate component**: SPA always checks `/api/v1/auth/status` on mount — clears stale localStorage if setup incomplete
- **Migration 0020**: added `admin_password_hash` and `admin_api_key` to `orbit_settings` table

---

## [1.6.0] - 2026-03-01

### Added

- **Hybrid license system**: Ed25519 JWT signing/verification using native `node:crypto` — replaced `jsonwebtoken` dependency with zero-dependency implementation
- **Inline license activation banner**: 7-day grace period countdown with inline key entry; "Licensed" badge shown when active
- **License management card in AdminTab**: view license status (plan, email, deployment ID), remove license with confirmation
- **License API endpoints**: `GET /api/v1/license/status`, `POST /api/v1/license/activate`, `DELETE /api/v1/license`
- **Engine dispatch system**: registry pattern for built-in connector engines; `getEngine(name)` dispatches to dedicated executor instead of generic DSL flow
- **Built-in n8n connector engine**: native pull-mode engine with cursor-based pagination, error detection and stuck-workflow detection
- **Connector Templates sub-tab**: 10 pre-built templates (Nagios Metrics, Nagios Events, Wazuh Alerts, Fortigate Logs, n8n Workflows, OTel Metrics, OTel Traces, Zabbix Metrics, Generic Metric, Generic Event) with "Use This Spec" and "Download Plugin" actions
- **Download Plugin feature**: generates downloadable `connector_spec.json` + `README.md` bundle for any template
- **System indicator cards in HomeTab**: real-time CPU load, memory, disk and network I/O KPIs with color-coded thresholds

### Changed

- Replaced `jsonwebtoken` package with native `node:crypto` Ed25519 JWT verification (zero external JWT dependencies)
- Reorganized AdminTab — migrated Sources into Connectors tab

---

## [1.5.0] - 2026-02-28

### Added

- **TimeRangePicker**: modern date range selector with preset pills (1h, 6h, 24h, 7d, 30d), datetime-local inputs and "↻ agora" button — replaces raw ISO text inputs in MetricsTab, EventsTab, NagiosTab and CorrelationsTab
- **System Tab — Disk usage card**: displays total, used and free space in GB with a percent fill bar, sourced from `fs.statfs('/')`
- **System Tab — PostgreSQL I/O & Stats card**: surfaces db size, cache hit %, active connections, reads/s and writes/s via `pg_stat_database`
- Logo assets: `orbitcore-logo-horizontal.svg` and `orbitcore-logo-white.svg`

### Fixed

- Dashboard `timeseries_multi` widgets with an empty `namespace`/`metric` field now emit the correct series format instead of crashing
- macOS metrics charts: canvas DPR rendering corrected — `setupCanvas` now uses `clientWidth`/`clientHeight` instead of raw pixel dimensions
- Memory and disk comparison dashboard widgets now render correctly

---

## [1.4.0] - 2026-02-27

### Added

- **Spanish locale (ES)**: full UI translation covering all tabs and dynamic strings, plus a language switcher (EN / PT / ES)
- **Mobile-responsive UI**: full layout adaptation for small screens across all tabs and navigation elements
- **AI Plugin Generator** (`POST /api/v1/ai/plugin`): describe any HTTP API in plain text and receive a `connector_spec` (ConnectorSpec JSON), `agent_script` (Python) and `readme` (Markdown) in return
- **Connectors tab**: copy button and "Use this Spec" flow for AI-generated results, enabling one-click registration
- **macOS LaunchAgent agent** (`orbit-agent.py`): collects `cpu.usage_pct`, `memory.*` and `disk.*` metrics and pushes them every 120 seconds via `POST /api/v1/ingest/raw/macos`
- Animated SVG demo for the AI Connector Generator (`docs/ai-connector-demo.svg`)
- OpenTelemetry OTLP/HTTP receiver instrumented in orbit-site

### Changed

- All packages bumped to v1.4.0

---

## [1.3.0] - 2026-02-25

### Added

- **Alerts system**: threshold and absence rule types, 60-second evaluation worker, webhook and Telegram dispatch channels
- **AlertsTab** in UI: full CRUD for alert rules and notification channels, notification history view and silence controls
- Migration 0011: `alert_rules`, `alert_channels` and `alert_notifications` tables
- **AI Connector Framework**: connector specs CRUD (create, list, get, update, delete), approve/test/dry-run workflow
- `POST /api/v1/ingest/raw/:id` — push a raw payload to a registered connector and have it mapped automatically
- Connector worker: polls all active connectors every 30 seconds
- Auth: pull connectors support both `X-Api-Key` and BasicAuth authentication modes

---

## [1.2.0] - 2026-02-20

### Added

- **Auto-correlation**: z-score anomaly detection that links metric spikes to concurrent events within the same time window
- **CorrelationsTab** in UI: surfaces correlated metric anomalies and events side by side
- Migration 0009: composite indexes on `(namespace, ts)` for improved query performance on metrics and events tables
- Rollup worker promoted to a background API process — no external cron required

### Fixed

- N+1 queries in `correlate.ts` replaced with batched lookups
- Duplicate ingestion logic in `routes/ingest.ts` delegated to `connectors/ingest.ts`
- Health check (`GET /api/v1/health`) now reports the status of all 4 background workers correctly

---

## [1.1.0] - 2026-02-15

### Added

- **AI Dashboard Builder** (`POST /api/v1/ai/dashboard`): Claude-powered `DashboardSpec` generation from a plain-text description
- Dashboard CRUD with JSON spec persistence in PostgreSQL
- **DashboardTab**: builder UI, live viewer and rotation/slideshow mode for multiple dashboards
- Widget types: Gauge, KPI cards and EPS (Events Per Second) chart
- `timeseries_multi` query kind with `group_by` support and Top-N result limiting
- Event fingerprint deduplication in the ingest pipeline — duplicate events are silently collapsed

---

## [1.0.0] - 2026-02-01

### Added

- Initial release
- Metric ingestion (`POST /api/v1/ingest/metrics`) with JSONB dimensions support
- Event ingestion (`POST /api/v1/ingest/events`) with severity levels (info / low / medium / high / critical)
- **OrbitQL** query engine: `timeseries`, `events` and `event_count` query kinds
- Catalog API: assets, metrics, dimensions and events discovery endpoints
- Automatic 5-minute and 1-hour rollups with transparent query-time selection
- Retention policy: 14 days raw, 90 days 5-minute, 180 days 1-hour
- Built-in connectors: Nagios (perfdata + HARD state events), Wazuh (alerts), n8n (failures), Fortigate (via Wazuh pipeline)
- Docker Compose single-command deploy
- PostgreSQL 16 backend
- Prometheus exporter (`GET /api/v1/metrics/prom`)
- `X-Api-Key` authentication

---

[1.6.0]: https://github.com/rmfaria/orbit-core/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/rmfaria/orbit-core/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/rmfaria/orbit-core/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/rmfaria/orbit-core/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/rmfaria/orbit-core/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/rmfaria/orbit-core/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/rmfaria/orbit-core/releases/tag/v1.0.0
