# Dashboard Playbook (spec + guardrails)

This document defines practical rules for authoring dashboards in orbit-core.
It exists to keep dashboards **fast**, **predictable**, and **validatable**.

## Principles

- Prefer **performance-first queries**:
  - use rollups via the query engine (do not force raw when not needed)
  - use Top‑N when grouping by dimensions
- Use stable, descriptive names.
- Keep dashboards portable (avoid environment-specific assumptions when possible).

## Naming conventions

- Dashboard: `<scope> — <purpose>` (e.g. `Production — Server Health`)
- Widget: `<metric> — <breakdown>` (e.g. `CPU Load — load1/load5/load15`)

## DashboardSpec — required fields

A dashboard is a JSON object with:

- `id` (string)
- `title` (string)
- `time` (preset + refresh)
- `layout` (grid)
- `widgets[]` (each widget has a `kind` and a `query`)

See the Zod contract in `packages/core-contracts/src/dashboard.ts`.

## Widget kinds

### `timeseries`

Single timeseries. **Requires `asset_id`.**

```json
{
  "kind": "timeseries",
  "title": "CPU load (1m)",
  "span": 1,
  "query": {
    "kind": "timeseries",
    "asset_id": "host:vm002",
    "namespace": "nagios",
    "metric": "load1"
  }
}
```

### `timeseries_multi`

Multiple series. **Requires `series[]` and each entry must include `asset_id`.**

Supports:
- `group_by_dimension`
- Top‑N settings (`top_n`, `top_by`, `top_lookback_days`)

### `kpi`

Instant value (last point). Internally uses `timeseries` and returns the last datapoint.

### `events`

Filtered events feed.

Typical filters:
- `namespace`
- `kinds[]`
- `severities[]`

### `eps`

Events per second chart. The underlying query kind must be `event_count`.

### `gauge`

A half-donut gauge, typically driven by a KPI query.

## Guardrail: renderer injects `from` / `to`

Widget queries **must not** hardcode `from`/`to`.
The renderer injects the time range at runtime based on the dashboard `time.preset`.

## Suggested patterns

### Infrastructure (Nagios)

- CPU Load (load1)
- Memory used
- Disk usage by mount (multi-series with Top‑N)

### Security (Wazuh)

- Critical feed: `severities=["high","critical"]`
- EPS chart over 24h

### Automation (n8n)

- Failed executions (high)
- Stuck executions (medium)

## AI-assisted authoring (if enabled)

If you use an AI assistant to propose a DashboardSpec:

- it must only use assets/metrics/dimensions that exist in the live catalog
- the output must validate via `POST /api/v1/dashboards/validate` before persistence
- do not allow arbitrary SQL
