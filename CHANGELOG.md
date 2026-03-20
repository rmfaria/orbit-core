# Changelog

All notable changes to orbit-core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.8.0] - 2026-03-20

### Added

- **AI Alert Generator**: natural language alert builder powered by Anthropic — describe what to monitor ("Monitor CPU > 90% on all hosts", "Alert critical Wazuh events") and the AI generates complete alert rules using the RAG catalog context (assets, metrics, events, existing channels)
- **New API endpoint** `POST /api/v1/ai/alerts`: takes a prompt, builds context from 200 assets + 458 metrics + 10 event namespaces, and returns ready-to-apply alert rules
- **Alert test modal**: full test notification panel with animated progress bar, JSON payload preview (especially useful for webhook channels showing the exact POST body), error detail panel, and re-send capability
- **Channel metadata display**: channel cards now show inline URL (webhook), recipients (email), or chat ID (Telegram) with hover highlight effects
- **Firing counter badge**: pulsing animation in alerts header showing count of active firing rules
- **n8n webhook workflow**: pre-built `orbit-alert-email.json` — receives orbit-core alert webhooks and sends formatted HTML email via n8n SMTP
- **Health Map drilldown**: click any asset on the threat intel hex-grid to see severity timeline and IoC matches
- **Health Map caching**: 5-min in-memory cache + request coalescing for health-map queries (65x performance improvement maintained)
- **OpenClaw sales source**: new Source with sales dashboard, KPIs, charts and pipeline funnel
- **MBC WhatsApp bot connector**: push connector for WhatsApp pre-sales bot events

### Changed

- **Alert channel form UX**: auto-generates slug ID from channel name, moved ID field to secondary position, added try/catch with user-friendly error messages
- **Alert section counters**: styled as cyan badge pills instead of plain text
- **AI prompt engineering**: multi-strategy JSON extraction (code block → raw → brace regex), response normalization (array, .rules, .alert_rules, single object), concrete output examples in system prompt
- **Backdrop blur**: all alert modals (SMTP, test) now use backdrop blur for depth
- **Health map query**: pre-selects top-40 assets to avoid timeout on large datasets

### Fixed

- **Channel save error**: webhook channels with email-like IDs (containing `@` or `.`) now show clear validation error instead of crashing
- **Test button**: animated glow effect on hover with scale feedback on click

---

## [1.7.1] - 2026-03-16

### Added

- **Security Health Map**: futuristic hex-grid visualization showing per-asset security posture on the Threat Intel Overview — threat score 0–100 based on IoC matches, severity ratio and event volume; color-coded hexagons with neon glow; pulsing indicators for active IoC hits; hover tooltip with severity breakdown, event sources and matched IPs
- **New API endpoint** `GET /threat-intel/health-map`: returns per-asset security health data with event severity counts, IoC match counts and matched values
- **New API endpoint** `GET /threat-intel/feed`: returns last N hours of MISP activity (new indicators, ioc.new events, ioc.hit events)
- **Indicator filters**: type dropdown with live counts from stats, tag search (JSONB ILIKE), source filter, enabled/disabled toggle, enter-to-search on all inputs, clear all button
- **Match filters**: inline TimeRangePicker, matched value search, asset filter, clear all button
- **API filter params**: `tag` filter on indicators endpoint, `matched_value` and `namespace` filters on matches endpoint
- **Indicator breakdown bars**: always-visible horizontal bar chart on Overview showing IoC type distribution with counts
- **No-matches hint**: informational message on Overview when correlation engine has no results yet

### Changed

- **Chart initialization rewritten**: charts now lazy-create when canvas element mounts (previously `useEffect([])` ran before stats loaded, so canvas didn't exist and charts were never created — Overview appeared blank)
- **EPS tracking**: threat-intel indicator ingest now tracks events-per-second
- **Query MAX_ROWS cap**: hard limit of 100,000 rows on any single query to prevent OOM

### Fixed

- **Health map query performance**: 19.3s → 293ms (65x improvement) — replaced LATERAL JOIN on threat_matches with CTE pre-aggregation; eliminated 548k nested loops across partitioned tables
- **IoC lookup performance**: 51ms → 0.23ms (220x improvement) — added functional index on `lower(value)` with `WHERE enabled = true`; correlation worker was doing full seq scan on 67k rows every 2 minutes
- **Health map scoring**: normalized threat score by event volume instead of raw counts; uses severity percentage + logarithmic volume scale to avoid all-100 scores

---

## [1.7.0] - 2026-03-15

### Added

- **MISP threat intelligence integration**: full IoC lifecycle — ingest, correlate, visualize
- **Threat indicators table** (`threat_indicators`): stores IoCs with type, value, threat level, TLP tags, expiration, and MISP metadata; trigram index for fuzzy matching
- **Threat matches table** (`threat_matches`): records correlations between live events and known IoCs with matched field/value tracking
- **MISP Python connector** (`connectors/misp/ship_misp.py`): cron-driven REST API poller that pulls attributes from MISP, transforms to orbit indicators, and ships high/medium IoCs as orbit events for dashboard visibility
- **Threat intel correlation worker**: background worker (2-minute interval) that scans recent events, extracts IPs/domains/hashes from attributes, and matches against active threat indicators — generates `ioc.hit` events on match
- **Threat Intel API endpoints**: `POST /api/v1/threat-intel/indicators` (batch upsert), `GET /api/v1/threat-intel/indicators` (search/paginate), `GET /api/v1/threat-intel/indicators/match` (exact IoC lookup), `GET /api/v1/threat-intel/stats` (aggregated statistics), `DELETE /api/v1/threat-intel/indicators/:id`, `GET /api/v1/threat-intel/matches` (IoC hit history with event join), `GET /api/v1/threat-intel/matches/summary` (timeline, by-type, by-asset breakdowns)
- **Threat Intel dashboard tab**: 4 views — Overview (KPIs, severity bar, timeline chart, type doughnut, affected assets), Indicators (searchable table with tag pills, TLP colors, expandable details), Matches (IoC hits with original event context), Timeline (match activity + breakdown)
- **ThreatIndicator type** in `@orbit/core-contracts`: shared type definition for cross-package use

### Changed

- Worker registry expanded to 5 workers: `rollup`, `correlate`, `alerts`, `connectors`, `threat-intel`
- System endpoint reports threat-intel worker health with 5-minute stale threshold
- Analysis dropdown includes Threat Intel (desktop + mobile navigation)

### Fixed

- **MISP connector timezone bug**: replaced `strftime("%s")` (locale-dependent) with `.timestamp()` for UTC-safe epoch calculation

---

## [1.6.4] - 2026-03-09

### Added

- **AI RAG dashboard engine**: AI Designer generates dashboards using real catalog data as context
- **EPS Radar chart**: live events-per-second visualization on the Home tab
- **UI component extraction**: refactored App.tsx (6200 lines) into 17 separate tab/component files for maintainability

### Fixed

- **AuthGate session persistence**: fixed cookie-based session not surviving page reload
- **Infrastructure hardening**: post-outage fixes for Docker Swarm startup order, PG shared_buffers, Wazuh shipper timeouts

---

## [1.6.3] - 2026-03-08

### Added

- **Performance indexes**: composite indexes on orbit_events (namespace, kind, ts), rollup tables, and alert notifications
- **Retention cleanup**: `purge_connector_alert_data()` function for connector_runs (30d) and alert_notifications (90d)

### Fixed

- Dropped redundant fingerprint-only index (covered by fingerprint+ts unique constraint)

---

## [1.6.2] - 2026-03-05

### Added

- **Email alerting channel**: new `email` channel type with configurable recipients, SMTP settings stored globally in `orbit_settings`, and dark-themed orbit-style HTML email template via `nodemailer`
- **SMTP settings management**: `GET/POST /api/v1/alerts/smtp` endpoints for saving SMTP config, `POST /api/v1/alerts/smtp/test` for sending test emails, and SMTP modal in the UI
- **AI Designer (Smart Dashboards)**: new tab that generates complete HTML/CSS/JS dashboards from natural language descriptions using Claude — saved as standalone pages rendered in iframes
- **orbit-viz.js visualization engine**: standalone chart/gauge/table renderer (`<orbit-chart>`, `<orbit-gauge>`, `<orbit-table>`) used by AI-generated Smart Dashboards, served with short nginx cache (5min)
- **Analysis navigation group**: Events, Metrics and Correlations grouped under an "Analysis" dropdown in the desktop nav and section header in the mobile nav
- **Connector run tracking for canonical endpoints**: `/ingest/events` and `/ingest/metrics` now record `connector_runs` entries when the shipper sends the `X-Source-Id` header — enables Run History in the Connectors UI for Suricata, Nagios and Wazuh

### Changed

- **AlertsTab fully rewritten**: modernized card-based UI with channel grid (visual cards per type with icons), rule cards with colored left border (green=ok, red=firing, yellow=silenced, gray=disabled), severity as color pills, channel multi-select chips, expandable rule details, compact history table — replaces the previous 3-subtab layout
- **Channel form redesigned**: 3 clickable type-selector cards (Email/Telegram/Webhook) with dynamic fields per type, asset/namespace/metric dropdowns populated from the catalog API
- **Channel validation improved**: replaced `z.union` with `superRefine` kind-based config validation — produces clear errors per channel type instead of confusing union failures
- **Chart picker independence**: "Add chart" picker now allows selecting any asset independently of the main "view" filter
- **License banner hidden when active**: removed the persistent green "Licensed" banner; only the grace/trial banner shows when unlicensed

### Fixed

- **orbit-viz.js gauge/chart duplication**: `_renderer()` factory with monotonic version counter prevents stale async renders from painting over current content
- **orbit-viz.js cache**: separate nginx location with `max-age=300` instead of immutable year-long cache
- **AI Designer iframe base URL**: strip filename from base URL for correct relative path resolution
- **AI Designer async fix**: auto-fix missing `async` keyword on query functions in generated code
- **Migration 0021 partitioning**: fixed sequence ownership transfer and index recreation order
- **Performance improvements**: optimized API queries, DB indexes and UI rendering across the stack

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

[1.7.1]: https://github.com/rmfaria/orbit-core/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/rmfaria/orbit-core/compare/v1.6.4...v1.7.0
[1.6.4]: https://github.com/rmfaria/orbit-core/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/rmfaria/orbit-core/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/rmfaria/orbit-core/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/rmfaria/orbit-core/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/rmfaria/orbit-core/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/rmfaria/orbit-core/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/rmfaria/orbit-core/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/rmfaria/orbit-core/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/rmfaria/orbit-core/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/rmfaria/orbit-core/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/rmfaria/orbit-core/releases/tag/v1.0.0
