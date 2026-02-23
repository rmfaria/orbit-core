# Connectors

orbit-core is designed to ingest telemetry from multiple sources.

## Nagios (primary / recommended)

Use the **Python shippers** (deterministic, cron-friendly):

- `connectors/nagios/ship_metrics.py` → `POST /api/v1/ingest/metrics`
- `connectors/nagios/ship_events.py` → `POST /api/v1/ingest/events`

See: `connectors/nagios/README.md`

## Nagios (optional)

TypeScript shipper package:
- `packages/nagios-shipper`

See: `packages/nagios-shipper/README.md`

---

## Wazuh

Use the **Python shipper** (deterministic, cron-friendly):

- `connectors/wazuh/ship_events.py` → `POST /api/v1/ingest/events`

Ships Wazuh alerts from `alerts.json` as normalized events with severity
derived from `rule.level` (0–15).

See: `connectors/wazuh/README.md` | `connectors/wazuh/INSTALL.md`
