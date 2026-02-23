# Nagios Connector (orbit-core)

This connector ships **Nagios perfdata** and **HARD state-change events** into orbit-core using the ingest API.

## What it ships

1) **Metrics** (perfdata)
- Reads from Nagios perfdata spool files (service + host)
- Converts perfdata pairs into Orbit MetricPoints
- Sends batches to `POST /api/v1/ingest/metrics`

2) **Events** (HARD-only)
- Reads `neb-hard-events.jsonl` (produced by `write_hard_event.py` global event handler)
- Converts entries into Orbit Events
- Sends batches to `POST /api/v1/ingest/events`

## Requirements

- Python 3.10+
- Network access to orbit-core API

## Perfdata file format

`ship_metrics.py` expects the **default Nagios tab-separated format** (no custom template).
Do **not** configure a custom `service_perfdata_file_template` / `host_perfdata_file_template`
unless you update the shipper to match.

> The TypeScript shipper (`packages/nagios-shipper`) uses a different format with `DATATYPE::` field
> prefixes and requires a custom template. The two shippers are not interchangeable on the same file.

## Environment variables

### Orbit destination
- `ORBIT_API` (default: `http://127.0.0.1:3000`)
- `ORBIT_BASIC_USER` / `ORBIT_BASIC_PASS` (optional)
- `ORBIT_BASIC` (optional, `user:pass`)
- `ORBIT_BASIC_FILE` (optional, path containing password)

### Perfdata shipper (metrics)
- `NAGIOS_SERVICE_PERFDATA_FILE` (default: `/var/lib/nagios4/service-perfdata.out`)
- `NAGIOS_HOST_PERFDATA_FILE` (default: `/var/lib/nagios4/host-perfdata.out`)
- `STATE_PATH` (default: `/var/lib/orbit-core/nagios-metrics.state.json`)
- `MAX_BYTES_PER_RUN` (default: `5242880` — 5 MB per run)
- `BATCH_SIZE` (default: `1000`)

### HARD events shipper (events)
- `NAGIOS_HARD_EVENTS_JSONL` (default: `/var/log/nagios4/neb-hard-events.jsonl`)
- `STATE_PATH` (default: `/var/lib/orbit-core/nagios-events.state.json`)
- `MAX_BYTES_PER_RUN` (default: `5242880` — 5 MB per run)
- `BATCH_SIZE` (default: `200`)

### Event handler (write_hard_event.py)
- `ORBIT_EVENTS_SPOOL` (default: `/var/log/nagios4/neb-hard-events.jsonl`)

## Example cron

See `cron.example` in this folder.

## Notes

- This connector is designed to be **deterministic / no-AI**.
- Avoid committing secrets. Use env vars or files outside the repo.
