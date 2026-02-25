# Nagios Connector (orbit-core)

This connector ships **Nagios perfdata metrics** and **HARD state-change events** into orbit-core.

## What it ships

1) Metrics (perfdata)
- reads Nagios perfdata spool files (host + service)
- converts perfdata pairs to orbit-core MetricPoints
- ships batches to `POST /api/v1/ingest/metrics`

2) Events (HARD-only)
- reads `neb-hard-events.jsonl` produced by the `write_hard_event.py` global event handler
- converts entries to orbit-core Events
- ships batches to `POST /api/v1/ingest/events`

## Data flow

```
Nagios → perfdata spool files → ship_metrics.py → orbit-core /api/v1/ingest/metrics
Nagios → write_hard_event.py → neb-hard-events.jsonl → ship_events.py → orbit-core /api/v1/ingest/events
```

Both shippers run as cron jobs every minute on the **Nagios server**.

## Requirements

- Python 3.10+
- network access to orbit-core API

### Where it must run

Both shippers read local files on the Nagios host:

| Shipper | Reads |
|---|---|
| `ship_metrics.py` | `/var/lib/nagios4/service-perfdata.out`, `host-perfdata.out` |
| `ship_events.py` | `/var/log/nagios4/neb-hard-events.jsonl` |

They must run on the same host as Nagios.

### Critical requirement: global event handler

`ship_events.py` depends on `neb-hard-events.jsonl`.
That file is only created if `write_hard_event.py` is configured as:

- `global_service_event_handler`
- `global_host_event_handler`

in `nagios.cfg`.

Without this, no HARD state-change events will be shipped (only metrics).

See `INSTALL.md` (step 3) for the full configuration.

## Perfdata format

`ship_metrics.py` expects Nagios **default tab-separated perfdata**.
Do not set a custom `service_perfdata_file_template` / `host_perfdata_file_template` unless you also update the shipper.

> Note: the optional TypeScript shipper (`packages/nagios-shipper`) targets a different perfdata format and is not interchangeable.

## Environment variables

### Orbit destination

- `ORBIT_API` (default: `http://127.0.0.1:3000`)
- `ORBIT_API_KEY` — API key (`X-Api-Key`) — recommended
- `ORBIT_BASIC_USER` / `ORBIT_BASIC_PASS` — BasicAuth (legacy)
- `ORBIT_BASIC` — `user:pass` (legacy)
- `ORBIT_BASIC_FILE` — path containing password (legacy)

### Metrics shipper

- `NAGIOS_SERVICE_PERFDATA_FILE` (default: `/var/lib/nagios4/service-perfdata.out`)
- `NAGIOS_HOST_PERFDATA_FILE` (default: `/var/lib/nagios4/host-perfdata.out`)
- `STATE_PATH` (default: `/var/lib/orbit-core/nagios-metrics.state.json`)
- `MAX_BYTES_PER_RUN` (default: `5242880` — 5 MB)
- `BATCH_SIZE` (default: `1000`)

### Events shipper

- `NAGIOS_HARD_EVENTS_JSONL` (default: `/var/log/nagios4/neb-hard-events.jsonl`)
- `STATE_PATH` (default: `/var/lib/orbit-core/nagios-events.state.json`)
- `MAX_BYTES_PER_RUN` (default: `5242880` — 5 MB)
- `BATCH_SIZE` (default: `200`)

### Event handler

- `ORBIT_EVENTS_SPOOL` (default: `/var/log/nagios4/neb-hard-events.jsonl`)

## Event mapping

| Nagios | orbit-core |
|---|---|
| `$HOSTNAME$` | `asset_id = host:<hostname>` |
| — | `namespace = nagios` |
| — | `kind = state_change` |
| host/service state | `severity` |
| host + service + state | `title` |
| `$SERVICEOUTPUT$` / `$HOSTOUTPUT$` | `message` |
| kind:host:service | `fingerprint` |

Severity mapping:

| Type | Nagios state | Severity |
|---|---|---|
| Host | UP (0) | `info` |
| Host | DOWN (1) | `critical` |
| Host | UNREACHABLE (2) | `high` |
| Host | UNKNOWN (3) | `medium` |
| Service | OK (0) | `info` |
| Service | WARNING (1) | `medium` |
| Service | CRITICAL (2) | `critical` |
| Service | UNKNOWN (3) | `low` |

Only **HARD** changes are written to the spool and shipped.
SOFT states are ignored by `write_hard_event.py`.

## Verification

```bash
curl -s -H "X-Api-Key: <your-key>" \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "kind":"events",
    "namespace":"nagios",
    "from":"...",
    "to":"...",
    "limit":5
  }'

cat /var/lib/orbit-core/nagios-events.state.json
cat /var/lib/orbit-core/nagios-metrics.state.json

tail -20 /var/log/orbit-core/nagios_events_shipper.log

tail -5 /var/log/nagios4/neb-hard-events.jsonl
```
