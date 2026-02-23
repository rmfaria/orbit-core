# Dashboard Playbook (Orbit)

This document defines **guardrails and patterns** for dashboards/widgets generated for orbit-core.

## Principles

- **No raw SQL** in generated dashboards.
- Use **orbitql** only.
- Prefer **performance-first defaults**:
  - auto-bucket by range
  - safe limits
  - Top‑N when grouping by dimensions
- Avoid unbounded cardinality.
- Use stable naming conventions.

## Naming conventions

- Dashboard name: `<scope> — <purpose>` (e.g. `portn8n — Core Health`)
- Widget title: `<metric> — <breakdown>` (e.g. `CPU load — load1/load5/load15`)

## Standard widget patterns

### 1) CPU Load (Nagios)
- Query kind: `timeseries_multi`
- Series: `metric=load1|load5|load15`
- Dimension: `service="CPU Load"`

### 2) Disk Queue (Nagios)
- Series: `metric=aqu`, `metric=util`
- Dimension: `service="Disk_Queue_sda"`

### 3) Network Traffic (Nagios)
- Series: `metric=rx_mbps`, `metric=tx_mbps`
- Dimension: `service="Network_Traffic_eth0"`

### 4) Suricata Alerts (Nagios)
- Series: `metric=alerts`
- Dimension: `service="Suricata_Alerts_5m"`

### 5) Events feed
- Query kind: `events`
- Filter by severities and limit.

## Default query limits

- `limit` default: 2_000 rows
- `top_n` default: 20
- `top_n` max: 50

## Time ranges

- Default dashboard range: last 60 minutes
- Allow presets: 60m, 6h, 24h, 7d, 30d

## Bucketing guidance

- Prefer leaving `bucket_sec` empty and rely on API auto-bucket.
- When set explicitly, use:
  - 60m: 60s bucket
  - 24h: 300s bucket
  - 7d: 3600s bucket

## Validation rules (must pass)

Any generated spec must satisfy:
- all metrics exist in catalog for the selected asset/namespace
- any `group_by_dimension` key exists for the metric
- `top_n <= 50`
- `limit <= 5000`
- range must be <= 30d unless explicitly requested
