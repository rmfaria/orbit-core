# Suricata Connector — orbit-core

Ships Suricata EVE-JSON events to orbit-core.

## How it works

`ship_events.py` reads `/var/log/suricata/eve.json`, extracts security-relevant events, and POSTs them to orbit-core's ingest API. It tracks its read position via a byte-offset state file, so it only processes new log lines each run.

## Supported event types

| Type | Default | Description |
|------|---------|-------------|
| `alert` | Yes | IDS signature matches |
| `anomaly` | Yes | Protocol anomalies |
| `http` | Yes | HTTP requests detected |
| `ssh` | Yes | SSH connections |
| `dns` | No | DNS queries (high volume) |
| `tls` | No | TLS handshakes (medium volume) |

## Severity mapping

| Suricata `alert.severity` | orbit severity |
|---|---|
| 1 (High) | `critical` |
| 2 (Medium) | `high` |
| 3 (Low) | `medium` |
| 4 (Info) | `low` |

Non-alert types: `anomaly` → medium, others → info.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SURICATA_EVE_JSON` | `/var/log/suricata/eve.json` | Path to EVE log |
| `STATE_PATH` | `/var/lib/orbit-core/suricata-events.state.json` | Byte offset state |
| `ORBIT_API` | `http://127.0.0.1:3000` | orbit-core API URL |
| `ORBIT_API_KEY` | — | API key for auth |
| `SURICATA_EVENT_TYPES` | `alert,anomaly,http,ssh` | Comma-separated types to ingest |
| `SURICATA_SENSOR` | `sensor:suricata` | Fallback asset_id |
| `MAX_BYTES_PER_RUN` | `5242880` (5 MB) | Max bytes to read per run |
| `BATCH_SIZE` | `200` | Events per POST batch |

## Setup

```bash
# 1. Copy script
cp ship_events.py /opt/orbit-core/connectors/suricata/

# 2. Create state directory
mkdir -p /var/lib/orbit-core

# 3. Add cron job
cat > /etc/cron.d/orbit-suricata << 'EOF'
ORBIT_API=https://prod.nesecurity.com.br/orbit-core
ORBIT_API_KEY=your-key-here
* * * * * root /opt/orbit-core/connectors/suricata/ship_events.py >> /var/log/orbit-suricata.log 2>&1
EOF

# 4. Enable dns + tls (optional, high volume)
# Add to cron: SURICATA_EVENT_TYPES=alert,anomaly,http,ssh,dns,tls
```

## Log rotation

The script detects when `eve.json` shrinks (logrotate truncation) and automatically resets its offset to 0.
