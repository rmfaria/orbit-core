# Connectors

orbit-core is designed to ingest telemetry from multiple sources.

## Nagios (official)

Use **@orbit/nagios-shipper** (`packages/nagios-shipper`).

It ships:
- perfdata → `POST /api/v1/ingest/metrics`
- HARD alerts from `nagios.log` → `POST /api/v1/ingest/events`

See: `packages/nagios-shipper/README.md`
