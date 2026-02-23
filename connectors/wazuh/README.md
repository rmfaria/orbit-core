# Wazuh Connector (orbit-core)

Ships **Wazuh alerts** into orbit-core as normalized events.

## What it ships

- Reads `/var/ossec/logs/alerts/alerts.json` (JSONL — one alert per line)
- Converts each alert to an orbit-core `Event`
- Sends batches to `POST /api/v1/ingest/events`

## Requirements

- Python 3.10+
- `pip3 install requests`
- Read access to the Wazuh `alerts.json` file
- Network access to orbit-core API

## Data mapping

| Wazuh field | orbit-core field |
|---|---|
| `timestamp` | `ts` |
| `agent.name` (or `agent.id`) | `asset_id` = `host:<name>` |
| — | `namespace` = `wazuh` |
| `rule.groups[0]` | `kind` |
| `rule.level` (0–15) | `severity` (see table below) |
| `rule.description` | `title` |
| `full_log` | `message` |
| `agent.id:rule.id:alert.id` | `fingerprint` |
| `rule.*`, `agent.*`, `data.*` | `attributes` |

**Severity mapping (rule.level):**

| Level | Severity |
|---|---|
| 0–3 | `info` |
| 4–6 | `low` |
| 7–10 | `medium` |
| 11–13 | `high` |
| 14–15 | `critical` |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ORBIT_API` | `http://127.0.0.1:3000` | orbit-core API base URL |
| `WAZUH_ALERTS_JSON` | `/var/ossec/logs/alerts/alerts.json` | Path to Wazuh alerts JSONL file |
| `STATE_PATH` | `/var/lib/orbit-core/wazuh-events.state.json` | File position state |
| `MAX_BYTES_PER_RUN` | `5242880` (5 MB) | Max bytes to read per cron run |
| `BATCH_SIZE` | `200` | Events per API request |
| `ORBIT_BASIC_USER` | — | BasicAuth username |
| `ORBIT_BASIC_PASS` | — | BasicAuth password (prefer `ORBIT_BASIC_FILE`) |
| `ORBIT_BASIC` | — | `user:pass` combined |
| `ORBIT_BASIC_FILE` | — | Path to file containing the password |

## Cron example

```cron
* * * * * root \
  ORBIT_API=https://prod.example.com/orbit-core \
  ORBIT_BASIC_USER=orbitadmin \
  ORBIT_BASIC_FILE=/etc/orbit-core/orbitadmin.pass \
  python3 /opt/orbit-core/connectors/wazuh/ship_events.py \
  >>/var/log/orbit-core/wazuh_shipper.log 2>&1
```

See `cron.example` for the full example.

## Notes

- Designed to be **deterministic / no-AI** — safe to run from cron.
- Tracks byte offset in a state file; detects log rotation automatically.
- Do not commit secrets — use `ORBIT_BASIC_FILE`.
