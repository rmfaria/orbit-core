# n8n Connector — Installation Guide

**Creator:** Rodrigo Menchio <rodrigomenchio@gmail.com>

This guide installs both n8n connector modes for orbit-core:

| Mode | What you install | Coverage |
|---|---|---|
| **Active** (`ship_events.py`) | cron on any server | all failures + stuck executions (polling) |
| **Plug-and-play** (`orbit_error_reporter.json`) | workflow inside n8n | near real-time failures (per workflow configured) |

Recommendation: install both for full coverage.

## 0) Prerequisites

- n8n running and reachable over HTTP/HTTPS
- Python 3.10+ on the cron host
- network access from the cron host to n8n (`/api/v1/executions`)
- network access to orbit-core API

Install Python deps:

```bash
apt-get update && apt-get install -y python3 python3-pip
pip3 install requests
```

## 1) Get the n8n API key

1. n8n → **Settings → n8n API**
2. **Create an API key**
3. copy it (shown once)

Store it in a file (recommended):

```bash
mkdir -p /etc/orbit-core
chmod 0750 /etc/orbit-core
printf '%s' 'YOUR_N8N_API_KEY' > /etc/orbit-core/n8n.apikey
chmod 0600 /etc/orbit-core/n8n.apikey
```

## 2) Install connector scripts

```bash
mkdir -p /opt/orbit-core/connectors
cp -a ./connectors/n8n /opt/orbit-core/connectors/
chmod +x /opt/orbit-core/connectors/n8n/ship_events.py
```

Create state/log dirs:

```bash
mkdir -p /var/lib/orbit-core
mkdir -p /var/log/orbit-core
chmod 0755 /var/lib/orbit-core /var/log/orbit-core
```

## 3) Configure orbit-core authentication

Recommended: store the Orbit API key in a file.

```bash
mkdir -p /etc/orbit-core
chmod 0750 /etc/orbit-core
printf '%s' 'YOUR_ORBIT_API_KEY' > /etc/orbit-core/orbit.key
chmod 0640 /etc/orbit-core/orbit.key
```

## 4) Configure cron (`ship_events.py`)

Create `/etc/cron.d/orbit-n8n`:

```cron
* * * * * root \
  ORBIT_API=https://prod.example.com/orbit-core \
  ORBIT_API_KEY=$(cat /etc/orbit-core/orbit.key) \
  N8N_URL=https://your-n8n.example.com \
  N8N_API_KEY=$(cat /etc/orbit-core/n8n.apikey) \
  N8N_VERIFY_TLS=true \
  STUCK_AFTER_MINUTES=30 \
  STATE_PATH=/var/lib/orbit-core/n8n-events.state.json \
  python3 /opt/orbit-core/connectors/n8n/ship_events.py \
  >>/var/log/orbit-core/n8n_shipper.log 2>&1
```

Note: when writing cron files, `$(cat ...)` expansion can be tricky depending on how the file is created. If unsure, use a wrapper script.

Reload cron if needed:

```bash
systemctl reload cron || true
```

## 5) Verify (active mode)

```bash
tail -50 /var/log/orbit-core/n8n_shipper.log
cat /var/lib/orbit-core/n8n-events.state.json
```

Query last events:

```bash
curl -s -H "X-Api-Key: $(cat /etc/orbit-core/orbit.key)" \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{"kind":"events","namespace":"n8n","from":"...","to":"...","limit":5}'
```

## 6) Install Error Trigger workflow (plug-and-play)

1. Import `connectors/n8n/orbit_error_reporter.json` into n8n
2. For each workflow you want monitored, set **Error Workflow** to the imported Orbit Error Reporter

Important: Error Trigger does not apply globally.
