# Nagios Connector (orbit-core)

This connector ships **Nagios perfdata** and **HARD state-change events** into orbit-core using the ingest API.

## What it ships

1) **Metrics** (perfdata)
- Reads from Nagios perfdata spool files (service + host)
- Converts perfdata pairs into Orbit MetricPoints
- Sends batches to `POST /api/v1/ingest/metrics`

2) **Events** (HARD-only)
- Reads `neb-hard-events.jsonl` (produced by NEB broker / handler)
- Converts entries into Orbit Events
- Sends batches to `POST /api/v1/ingest/events`

## Requirements

- Python 3.10+
- Network access to orbit-core API

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
- `MAX_LINES_PER_RUN` (default: `600`)
- `BATCH_SIZE` (default: `1000`)

### HARD events shipper (events)
- `NAGIOS_HARD_EVENTS_JSONL` (default: `/var/log/nagios4/neb-hard-events.jsonl`)
- `STATE_PATH` (default: `/var/lib/orbit-core/nagios-events.state.json`)
- `MAX_PER_RUN` (default: `400`)
- `BATCH_SIZE` (default: `200`)

## Example cron

See `cron.example` in this folder.

## Notes

- This connector is designed to be **deterministic / no-AI**.
- Avoid committing secrets. Use env vars or files outside the repo.
