# n8n Connector (orbit-core)

Two modes — choose based on your needs:

| Mode | File | When to use |
|---|---|---|
| **Plug-and-play** (Error Trigger) | `orbit_error_reporter.json` | Near real-time on workflow failures (per workflow configuration) |
| **Active** (API polling) | `ship_events.py` | Cron every minute; captures failures + stuck executions |

Both ship to `POST /api/v1/ingest/events`.

## What is monitored

| Event | kind | severity | Source |
|---|---|---|---|
| execution with `status=error` | `execution_error` | `high` | both |
| execution running longer than N minutes | `execution_stuck` | `medium` | `ship_events.py` |

## Data mapping

| n8n field | orbit-core field |
|---|---|
| `stoppedAt` (or now) | `ts` |
| `workflowData.name` | `asset_id = workflow:<name>` |
| — | `namespace = n8n` |
| — | `kind = execution_error | execution_stuck` |
| — | `severity = high (error) / medium (stuck)` |
| name + execution id | `title` |
| error details | `message` |
| execution id | `fingerprint = n8n:error:<id>` |
| ids + timestamps + urls | `attributes` |

## Data flow (`ship_events.py`)

```
n8n REST API (/api/v1/executions?status=error)   → ship_events.py → orbit-core /api/v1/ingest/events
n8n REST API (/api/v1/executions?status=running) → ship_events.py → orbit-core /api/v1/ingest/events
```

The connector polls n8n every minute (via cron).
It does not read local files and can run on any host with network access to n8n and orbit-core.

## Requirements

- Python 3.10+
- `pip3 install requests`
- n8n API key (Settings → n8n API → Create an API key) — required
- network access to n8n REST API (`/api/v1/executions`)
- network access to orbit-core API

## Environment variables (`ship_events.py`)

| Variable | Default | Description |
|---|---|---|
| `N8N_URL` | `http://localhost:5678` | n8n base URL |
| `N8N_API_KEY` | — | n8n API key (required) |
| `N8N_VERIFY_TLS` | `true` | set `false` for self-signed certs |
| `STUCK_AFTER_MINUTES` | `30` | minutes before considering an execution stuck |
| `MAX_EXECUTIONS_PER_RUN` | `500` | cap error executions per run |
| `BATCH_SIZE` | `200` | events per request to orbit-core |
| `LOOKBACK_MINUTES` | `60` | initial window when there is no state file |
| `STATE_PATH` | `/var/lib/orbit-core/n8n-events.state.json` | state file path |
| `ORBIT_API` | `http://127.0.0.1:3000` | orbit-core base URL |
| `ORBIT_API_KEY` | — | API Key (`X-Api-Key`) — recommended |
| `ORBIT_BASIC_USER` | — | BasicAuth user (legacy) |
| `ORBIT_BASIC_PASS` | — | BasicAuth pass (legacy) |
| `ORBIT_BASIC` | — | combined `user:pass` (legacy) |
| `ORBIT_BASIC_FILE` | — | file path containing password (legacy) |

## How the state file works

The state file stores an **ISO 8601 timestamp cursor** (not a byte-offset):

```json
{"since": "2026-02-24T11:57:52.676976+00:00"}
```

On every run:
1. fetch error executions with `stoppedAt > since` (newest to oldest)
2. fetch running executions and emit `execution_stuck` when age > `STUCK_AFTER_MINUTES`
3. advance `since` to the newest `stoppedAt` found (or nudge +1s if none)

On the first run (no state file), it uses `LOOKBACK_MINUTES` as the initial window.

## Verification

```bash
# Confirm events are arriving (namespace=n8n)
curl -s -H "X-Api-Key: <your-key>" \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "kind":"events",
    "namespace":"n8n",
    "from":"...",
    "to":"...",
    "limit":5
  }'

cat /var/lib/orbit-core/n8n-events.state.json
tail -20 /var/log/orbit-core/n8n_shipper.log
```

If the log is empty and there are no events in orbit-core, it may simply mean there were no failures/stuck runs — expected.

## Cron example

See `cron.example`.
