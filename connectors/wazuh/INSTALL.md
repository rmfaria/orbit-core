# Wazuh Connector — Installation Guide

**Creator:** Rodrigo Menchio <rodrigomenchio@gmail.com>

This guide installs the Wazuh connector for orbit-core.

You can run it in two modes:

- **Passive (file-based)**: reads `alerts.json` locally on the Wazuh Manager host
- **Active (OpenSearch)**: polls the Wazuh Indexer via REST (useful when running from another host)

## 0) Prerequisites

- Wazuh Manager running and producing `alerts.json`
- Python 3.10+
- network access to the orbit-core API
- API key for orbit-core (`ORBIT_API_KEY`)

Install Python dependencies:

```bash
apt-get update && apt-get install -y python3 python3-pip
pip3 install requests
```

## 1) Install the connector scripts

```bash
mkdir -p /opt/orbit-core/connectors
cp -a ./connectors/wazuh /opt/orbit-core/connectors/
chmod +x /opt/orbit-core/connectors/wazuh/*.py
```

Create state/log directories:

```bash
mkdir -p /var/lib/orbit-core
mkdir -p /var/log/orbit-core
chown root:root /var/lib/orbit-core /var/log/orbit-core
chmod 0755 /var/lib/orbit-core /var/log/orbit-core
```

## 2) File permissions (passive mode)

If you use `ship_events.py`, ensure the cron user can read:

- `/var/ossec/logs/alerts/alerts.json`

Typically the file is owned by group `wazuh` (`0640`). Add the cron user to that group:

```bash
usermod -aG wazuh <cron-user>
id <cron-user>
ls -la /var/ossec/logs/alerts/alerts.json
```

## 3) Configure orbit-core authentication

Recommended: store the API key in a file.

```bash
mkdir -p /etc/orbit-core
chmod 0750 /etc/orbit-core
printf '%s' 'YOUR_ORBIT_API_KEY' > /etc/orbit-core/orbit.key
chmod 0640 /etc/orbit-core/orbit.key
```

Do not commit secrets.

## 4) Configure cron (passive mode)

Create `/etc/cron.d/orbit-wazuh`:

```cron
* * * * * root \
  ORBIT_API=https://prod.example.com/orbit-core \
  ORBIT_API_KEY=$(cat /etc/orbit-core/orbit.key) \
  WAZUH_ALERTS_JSON=/var/ossec/logs/alerts/alerts.json \
  STATE_PATH=/var/lib/orbit-core/wazuh-events.state.json \
  MAX_BYTES_PER_RUN=52428800 \
  BATCH_SIZE=100 \
  python3 /opt/orbit-core/connectors/wazuh/ship_events.py \
  >>/var/log/orbit-core/wazuh_shipper.log 2>&1
```

Reload cron if needed:

```bash
systemctl reload cron || true
```

## 5) Verify

```bash
tail -20 /var/log/orbit-core/wazuh_shipper.log
cat /var/lib/orbit-core/wazuh-events.state.json
```

Query the last events:

```bash
curl -s -H "X-Api-Key: $(cat /etc/orbit-core/orbit.key)" \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{"kind":"events","namespace":"wazuh","from":"...","to":"...","limit":5}'
```
