# Wazuh Connector — Installation Guide

This guide installs the **orbit-core Wazuh Connector** on the Wazuh Manager host
(Debian/Ubuntu).

It ships Wazuh alerts from `alerts.json` → `POST /api/v1/ingest/events`.

> Goal: run as a deterministic cron job (no-AI).

---

## 0) Prerequisites

- Wazuh Manager installed and running
- Python **3.10+**
- Network access from the Wazuh Manager host to the orbit-core API

### Install Python dependency

```bash
apt-get update
apt-get install -y python3 python3-pip
pip3 install requests
```

---

## 1) Install the connector scripts

```bash
mkdir -p /opt/orbit-core/connectors
cp -a ./connectors/wazuh /opt/orbit-core/connectors/
chmod +x /opt/orbit-core/connectors/wazuh/ship_events.py
```

Create state and log directories:

```bash
mkdir -p /var/lib/orbit-core
mkdir -p /var/log/orbit-core
chown root:root /var/lib/orbit-core /var/log/orbit-core
chmod 0755 /var/lib/orbit-core /var/log/orbit-core
```

---

## 2) Verify the Wazuh alerts file

The connector reads:

- `/var/ossec/logs/alerts/alerts.json`

Confirm it exists and is being written:

```bash
ls -lh /var/ossec/logs/alerts/alerts.json
tail -n 2 /var/ossec/logs/alerts/alerts.json
```

Each line should be a valid JSON alert object:

```json
{"timestamp":"2024-02-23T14:00:00.000+0000","rule":{"level":10,"description":"...","id":"5402"},"agent":{"id":"001","name":"web01"}, ...}
```

> **Note**: The file is in JSONL format (one alert per line) and is rotated daily by
> Wazuh. The shipper detects rotation automatically via byte-offset tracking.

### Grant read access (if running as a non-wazuh user)

If the cron job runs as `root`, no extra permissions are needed.
If running as another user, add read access:

```bash
# Allow the cron user to read Wazuh alert files
setfacl -R -m u:<cron-user>:r /var/ossec/logs/alerts/
```

Or add the cron user to the `wazuh` group:

```bash
usermod -aG wazuh <cron-user>
```

---

## 3) Configure autenticação

**Recomendado — API Key** (configure `ORBIT_API_KEY` no servidor orbit-core):

```bash
# Salvar a chave em arquivo seguro para uso no cron
mkdir -p /etc/orbit-core
chmod 0750 /etc/orbit-core
printf '%s' 'SUA_ORBIT_API_KEY_AQUI' > /etc/orbit-core/orbit.key
chmod 0640 /etc/orbit-core/orbit.key
```

**Legado — BasicAuth** (suportado como fallback):
```bash
printf '%s' 'SUA_SENHA_AQUI' > /etc/orbit-core/orbitadmin.pass
chmod 0640 /etc/orbit-core/orbitadmin.pass
```

---

## 4) Configure the cron job

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

Reload cron:

```bash
systemctl reload cron || true
```

---

## 5) Verify ingestion

### Run manually (one-shot)

```bash
ORBIT_API=https://prod.example.com/orbit-core \
ORBIT_API_KEY=$(cat /etc/orbit-core/orbit.key) \
python3 /opt/orbit-core/connectors/wazuh/ship_events.py
```

### Check orbit-core

```bash
# Health
curl -s -H "X-Api-Key: $(cat /etc/orbit-core/orbit.key)" \
  https://prod.example.com/orbit-core/api/v1/health

# List assets (should show Wazuh agents as host:<name>)
curl -s -H "X-Api-Key: $(cat /etc/orbit-core/orbit.key)" \
  'https://prod.example.com/orbit-core/api/v1/catalog/assets?q=host:'

# Query events (last hour)
curl -s -H "X-Api-Key: $(cat /etc/orbit-core/orbit.key)" \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'content-type: application/json' \
  -d '{
    "query": {
      "kind": "events",
      "namespace": "wazuh",
      "from": "'$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)'",
      "to": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "limit": 20
    }
  }'
```

---

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `401/403` from orbit-core | API Key incorreta; verificar `ORBIT_API_KEY` ou `ORBIT_BASIC_USER`/`ORBIT_BASIC_FILE` |
| No events ingested | Check log: `/var/log/orbit-core/wazuh_shipper.log`; verify `alerts.json` path and read permissions |
| Events not updating | State file may have a stale offset; delete `/var/lib/orbit-core/wazuh-events.state.json` to re-process from the beginning |
| Duplicate events after log rotation | Normal on first run after rotation — the shipper detects truncation and resets offset to 0 |
| `alerts.json` not found | Wazuh JSON alerts may be disabled; check `ossec.conf` for `<alerts><log_format>json</log_format></alerts>` |

### Enable JSON alerts in Wazuh (if not already enabled)

Edit `/var/ossec/etc/ossec.conf`:

```xml
<ossec_config>
  <alerts>
    <log_all>no</log_all>
    <log_all_json>no</log_all_json>
    <email_notification>no</email_notification>
    <alerts_log>yes</alerts_log>
    <jsonout_output>yes</jsonout_output>   <!-- enable this -->
    <email_alert_level>12</email_alert_level>
  </alerts>
</ossec_config>
```

Restart Wazuh Manager:

```bash
systemctl restart wazuh-manager
ls -lh /var/ossec/logs/alerts/alerts.json
```

---

## Security notes

- Do not commit secrets. Use `ORBIT_API_KEY` via arquivo (`/etc/orbit-core/orbit.key`) ou variável de ambiente.
- The connector only reads from Wazuh — it never writes to it.
- Keep orbit-core behind TLS + auth in production.
- Restrict `/etc/orbit-core/` to root-only (`chmod 0750`).
