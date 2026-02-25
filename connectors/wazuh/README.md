# Wazuh Connector (orbit-core)

**Creator:** Rodrigo Menchio <rodrigomenchio@gmail.com>

Two modes — choose based on your deployment:

| Mode | Script | When to use |
|---|---|---|
| **Passive** (file-based) | `ship_events.py` | orbit-core runs on the same host as the Wazuh Manager |
| **Active** (OpenSearch) | `ship_events_opensearch.py` | Wazuh Manager is on a different host |

Ships **Wazuh alerts** into orbit-core as normalized events.

## What it ships

- reads `/var/ossec/logs/alerts/alerts.json` (JSONL — one alert per line)
- converts each alert to an orbit-core `Event`
- sends batches to `POST /api/v1/ingest/events`

## Requirements

- Python 3.10+
- `pip3 install requests`
- read access to `alerts.json`
- network access to orbit-core API

## Where it must run (passive mode)

The passive connector reads `alerts.json` directly from disk, so it must run on the **Wazuh Manager host**.

### File permissions (`alerts.json`)

The file is typically owned by group `wazuh` (`0640`).
Ensure the cron user belongs to that group:

```bash
usermod -aG wazuh <cron-user>
id <cron-user>
ls -la /var/ossec/logs/alerts/alerts.json
```

If the cron runs as `root`, add `root` to the `wazuh` group.

## Data mapping

| Wazuh field | orbit-core field |
|---|---|
| `timestamp` | `ts` |
| `agent.name` (or `agent.id`) | `asset_id = host:<name>` |
| — | `namespace = wazuh` |
| `rule.groups[0]` | `kind` |
| `rule.level` (0–15) | `severity` (see mapping below) |
| `rule.description` | `title` |
| `full_log` | `message` |
| `agent.id:rule.id:alert.id` | `fingerprint` |
| `rule.*`, `agent.*`, `data.*` | `attributes` |

### How `kind` is defined

`kind` is mapped from `rule.groups[0]`:

```text
rule.groups = ["syslog", "sudo"]      → kind = "syslog"
rule.groups = ["fortigate", "ids"]    → kind = "fortigate"
rule.groups = ["authentication_fail"] → kind = "authentication_fail"
```

This means Fortigate syslog events (Fortigate → Wazuh → orbit-core) arrive as `namespace=wazuh` + `kind=fortigate`.

### Severity mapping (Wazuh `rule.level`)

| level | severity |
|---:|---|
| 0–3 | `info` |
| 4–6 | `low` |
| 7–10 | `medium` |
| 11–13 | `high` |
| 14–15 | `critical` |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ORBIT_API` | `http://127.0.0.1:3000` | orbit-core API base URL |
| `ORBIT_API_KEY` | — | API Key (`X-Api-Key`) — recommended |
| `WAZUH_ALERTS_JSON` | `/var/ossec/logs/alerts/alerts.json` | alerts JSONL file path |
| `STATE_PATH` | `/var/lib/orbit-core/wazuh-events.state.json` | byte-offset state file |
| `MAX_BYTES_PER_RUN` | `5242880` | bytes to read per run |
| `BATCH_SIZE` | `200` | events per request (keep it bounded; payload limit is ~1MB) |

## Cron example

See `cron.example`.

## Verification

```bash
curl -s -H "X-Api-Key: <your-key>" \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "kind":"events",
    "namespace":"wazuh",
    "from":"...",
    "to":"...",
    "limit":5
  }'
```
