# orbit-core — Installation Guide

orbit-core is a self-hosted telemetry platform that collects metrics and events from Nagios,
Wazuh, n8n, and Fortigate, correlates anomalies, fires alerts via webhook or Telegram, and
serves a live dashboard — all backed by a single PostgreSQL database.

---

## Table of Contents

1. [Requirements](#requirements)
2. [Quick Start](#quick-start)
3. [Configuration](#configuration)
4. [Verifying the Installation](#verifying-the-installation)
5. [Connectors](#connectors)
   - [Nagios](#nagios-connector)
   - [Wazuh](#wazuh-connector)
   - [n8n](#n8n-connector)
   - [Fortigate](#fortigate-connector)
6. [AI Connector Framework](#ai-connector-framework)
7. [Operations](#operations)
8. [Production Hardening](#production-hardening)
9. [Docker Swarm (Advanced)](#docker-swarm-advanced)
10. [Troubleshooting](#troubleshooting)

---

## Requirements

| Dependency | Minimum version | Notes |
|------------|----------------|-------|
| Docker | 24.0 | `docker --version` |
| Docker Compose | 2.20 | bundled with Docker Desktop; on Linux install the plugin |
| RAM | 2 GB | 512 MB for API + 512 MB for PostgreSQL + 128 MB for nginx |
| Disk | 10 GB | for the database volume |
| Ports | 80 (or custom) | configurable via `ORBIT_PORT` |

> **Note:** The stack runs entirely inside Docker. No Node.js, pnpm, or Python required on the host.

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/rmfaria/orbit-core.git
cd orbit-core

# 2. Create your environment file
cp .env.example .env
# Edit .env — at minimum set ORBIT_API_KEY to a random secret:
#   ORBIT_API_KEY=$(openssl rand -hex 32)

# 3. Build the images (takes ~3 minutes on first run)
docker compose build

# 4. Start the stack
docker compose up -d

# 5. Check that everything is running
docker compose ps
```

The UI is now available at **http://localhost/orbit-core/** (or the IP/hostname of your server).

> On first startup, the `migrate` service runs all database migrations automatically,
> then exits. The API waits for it to complete before accepting connections.

---

## Configuration

All configuration is done via environment variables in the `.env` file.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `POSTGRES_PASSWORD` | `postgres` | Yes | PostgreSQL password. Change in production. |
| `ORBIT_API_KEY` | *(empty)* | Recommended | API authentication key. All connectors and the UI must send this as `X-Api-Key` header. If empty, no auth is enforced. |
| `ORBIT_PORT` | `80` | No | Host port for the nginx container (UI + API proxy). |
| `LOG_LEVEL` | `info` | No | API log verbosity: `trace`, `debug`, `info`, `warn`, `error`. |

### Generating a secure API key

```bash
openssl rand -hex 32
# example output: a3f8c2d1e4b7...
```

Paste the output into `ORBIT_API_KEY=` in your `.env` file.

---

## Verifying the Installation

### 1. Service health

```bash
docker compose ps
```

Expected output:

```
NAME                    STATUS
orbit-core-postgres-1   Up X minutes (healthy)
orbit-core-migrate-1    Exited (0) X minutes ago    ← migrations applied OK
orbit-core-api-1        Up X minutes (healthy)
orbit-core-ui-1         Up X minutes (healthy)
```

### 2. API health endpoint

```bash
curl -s http://localhost/orbit-core/api/v1/health | python3 -m json.tool
```

Expected:

```json
{
  "ok": true,
  "db": "connected",
  "uptime": 42.1
}
```

If `ORBIT_API_KEY` is set, include the header on every call:

```bash
curl -s -H "X-Api-Key: YOUR_KEY" http://localhost/orbit-core/api/v1/health
```

### 3. Ingest a test metric

```bash
curl -s -X POST http://localhost/orbit-core/api/v1/ingest/metrics \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{
    "metrics": [{
      "ts":        "'$(date -u +%FT%TZ)'",
      "asset_id":  "host:myserver",
      "namespace": "test",
      "metric":    "cpu",
      "value":     42.5
    }]
  }'
# Expected: {"ok":true,"ingested":1}
```

### 4. Query it back

```bash
curl -s -X POST http://localhost/orbit-core/api/v1/query \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{
    "query": {
      "kind":      "timeseries",
      "asset_id":  "host:myserver",
      "namespace": "test",
      "metric":    "cpu",
      "from":      "'$(date -u -v-1H +%FT%TZ 2>/dev/null || date -u -d '-1 hour' +%FT%TZ)'",
      "to":        "'$(date -u +%FT%TZ)'",
      "step":      "5m"
    }
  }'
```

### 5. Open the UI

Navigate to **http://localhost/orbit-core/** in your browser.
Enter your `ORBIT_API_KEY` in the Admin tab → Settings if prompted.

---

## Connectors

Connectors run as cron jobs on the monitored servers (not inside the orbit-core stack).
They require Python 3.8+ and the `requests` library (`pip3 install requests`).

All connectors share two required environment variables:

| Variable | Example | Description |
|----------|---------|-------------|
| `ORBIT_API` | `http://192.168.1.10` | Base URL of the orbit-core host (no path suffix) |
| `ORBIT_API_KEY` | `a3f8c2d1e4b7...` | Must match `ORBIT_API_KEY` in `.env` |

### Nagios Connector

Ships Nagios perfdata (metrics) and HARD state-change events.

**Files:** `connectors/nagios/`

**Step 1 — Configure Nagios** (`/etc/nagios4/nagios.cfg` or equivalent):

```ini
# Enable perfdata
process_performance_data=1
service_perfdata_file=/var/lib/nagios4/service-perfdata.out
host_perfdata_file=/var/lib/nagios4/host-perfdata.out
service_perfdata_file_template=DATATYPE::SERVICEPERFDATA\tTIMET::$TIMET$\tHOSTNAME::$HOSTNAME$\tSERVICEDESC::$SERVICEDESC$\tSERVICEPERFDATA::$SERVICEPERFDATA$\tSERVICECHECKCOMMAND::$SERVICECHECKCOMMAND$\tHOSTSTATE::$HOSTSTATE$\tHOSTSTATETYPE::$HOSTSTATETYPE$\tSERVICESTATE::$SERVICESTATE$\tSERVICESTATETYPE::$SERVICESTATETYPE$

# Global event handler for HARD state changes
global_host_event_handler=orbit-hard-event-handler
global_service_event_handler=orbit-hard-event-handler
```

**Step 2 — Install event handler:**

```bash
cp connectors/nagios/write_hard_event.py /usr/lib/nagios/plugins/orbit_write_hard_event.py
chmod +x /usr/lib/nagios/plugins/orbit_write_hard_event.py

# Define command in Nagios config:
# define command {
#   command_name  orbit-hard-event-handler
#   command_line  /usr/lib/nagios/plugins/orbit_write_hard_event.py $HOSTSTATE$ $SERVICESTATE$ $HOSTNAME$ "$SERVICEDESC$" $STATETYPE$
# }
```

**Step 3 — Install cron jobs** (copy from `deploy/cron/` and edit the variables):

```bash
# /etc/cron.d/orbit-nagios-metrics
* * * * * root ORBIT_API=http://YOUR_ORBIT_HOST ORBIT_API_KEY=YOUR_KEY \
  python3 /path/to/connectors/nagios/ship_metrics.py >> /var/log/orbit-metrics.log 2>&1

# /etc/cron.d/orbit-nagios-events
* * * * * root ORBIT_API=http://YOUR_ORBIT_HOST ORBIT_API_KEY=YOUR_KEY \
  python3 /path/to/connectors/nagios/ship_events.py >> /var/log/orbit-events.log 2>&1
```

| Variable | Default | Description |
|----------|---------|-------------|
| `NAGIOS_SERVICE_PERFDATA_FILE` | `/var/lib/nagios4/service-perfdata.out` | Perfdata spool file |
| `NAGIOS_HOST_PERFDATA_FILE` | `/var/lib/nagios4/host-perfdata.out` | Host perfdata spool file |
| `STATE_PATH` | `/var/lib/nagios4/.orbit_state` | Byte-offset cursor (auto-created) |
| `MAX_BYTES_PER_RUN` | `5242880` | Max bytes read per cron run (5 MB) |
| `BATCH_SIZE` | `500` | Events per API request |

---

### Wazuh Connector

Ships Wazuh security alerts as normalized events.

**Files:** `connectors/wazuh/`

Two modes — choose based on your setup:

#### Mode A — File-based (runs on the Wazuh Manager)

```bash
# /etc/cron.d/orbit-wazuh
*/2 * * * * root ORBIT_API=http://YOUR_ORBIT_HOST ORBIT_API_KEY=YOUR_KEY \
  python3 /path/to/connectors/wazuh/ship_events.py >> /var/log/orbit-wazuh.log 2>&1
```

| Variable | Default | Description |
|----------|---------|-------------|
| `WAZUH_ALERTS_JSON` | `/var/ossec/logs/alerts/alerts.json` | Wazuh alerts file |
| `STATE_PATH` | `/var/ossec/.orbit_state` | Byte-offset cursor |
| `MAX_BYTES_PER_RUN` | `5242880` | Max bytes per run |

#### Mode B — OpenSearch API (runs anywhere)

```bash
# /etc/cron.d/orbit-wazuh-opensearch
*/2 * * * * root \
  ORBIT_API=http://YOUR_ORBIT_HOST \
  ORBIT_API_KEY=YOUR_KEY \
  OPENSEARCH_URL=https://wazuh-indexer:9200 \
  OPENSEARCH_USER=admin \
  OPENSEARCH_PASS=YOUR_PASS \
  WAZUH_OS_INDEX_PATTERN="wazuh-alerts-4.x-*" \
  WAZUH_ASSET_ID=host:wazuh-manager \
  python3 /path/to/connectors/wazuh/ship_events_opensearch.py >> /var/log/orbit-wazuh.log 2>&1
```

---

### n8n Connector

Ships n8n workflow execution errors and stuck executions.

**Files:** `connectors/n8n/`

#### Mode A — Polling (recommended)

```bash
# /etc/cron.d/orbit-n8n
* * * * * root \
  ORBIT_API=http://YOUR_ORBIT_HOST \
  ORBIT_API_KEY=YOUR_KEY \
  N8N_URL=http://your-n8n:5678 \
  N8N_API_KEY=YOUR_N8N_KEY \
  STUCK_AFTER_MINUTES=30 \
  python3 /path/to/connectors/n8n/ship_events.py >> /var/log/orbit-n8n.log 2>&1
```

| Variable | Default | Description |
|----------|---------|-------------|
| `N8N_URL` | — | Base URL of your n8n instance |
| `N8N_API_KEY` | — | n8n API key (Settings → n8n API) |
| `N8N_VERIFY_TLS` | `true` | Set to `false` for self-signed certificates |
| `STUCK_AFTER_MINUTES` | `30` | Executions running longer than this are flagged |
| `LOOKBACK_MINUTES` | `10` | Window for polling on first run |
| `STATE_PATH` | `/tmp/.orbit_n8n_state.json` | Timestamp cursor |

#### Mode B — Error Trigger (near real-time)

Import `connectors/n8n/orbit_error_reporter.json` into your n8n instance.
Set the `ORBIT_API` and `ORBIT_API_KEY` credentials in the workflow's HTTP Request nodes.

---

### Fortigate Connector

Fortigate integration is handled via Wazuh — no standalone connector needed.

**Step 1 — Configure syslog on Fortigate:**

```
config log syslogd setting
  set status enable
  set server <WAZUH_MANAGER_IP>
  set port 514
  set facility local7
end
```

**Step 2 — Enable Fortigate rules in Wazuh** (usually enabled by default with the
`0270-fortigate_rules.xml` ruleset).

**Step 3 — Use the Wazuh connector** (Mode A or B) — Fortigate alerts arrive with
`namespace=wazuh`, `kind=fortigate` and are surfaced as the Fortigate source in the UI.

---

## AI Connector Framework

Available since v1.1.0. Create custom pull/push connectors that map any JSON payload
to orbit-core's canonical schema — manually or with AI assistance.

### Concepts

| Term | Description |
|------|-------------|
| **Connector spec** | A DSL mapping that describes how to transform a source payload into metrics or events |
| **push mode** | An external system POSTs to `/api/v1/ingest/raw/:source_id`; orbit-core applies the spec |
| **pull mode** | orbit-core fetches a remote URL on a configurable interval and applies the spec |
| **Status** | `draft` → `approved` → `disabled`. Only `approved` connectors process data |

### Creating a connector manually

```bash
curl -s -X POST http://localhost/orbit-core/api/v1/connectors \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{
    "id":        "my-api",
    "source_id": "my-api",
    "mode":      "pull",
    "type":      "metric",
    "pull_url":  "http://my-service/metrics",
    "pull_interval_min": 1,
    "spec": {
      "type": "metric",
      "items_path": "data",
      "mappings": {
        "ts":        { "path": "$.timestamp", "transform": "iso8601" },
        "asset_id":  { "path": "$.host" },
        "namespace": { "value": "my-api" },
        "metric":    { "path": "$.metric" },
        "value":     { "path": "$.value", "transform": "number" }
      }
    }
  }'
# → {"ok":true,"id":"my-api"}
```

Approve it to start ingesting:

```bash
curl -s -X POST http://localhost/orbit-core/api/v1/connectors/my-api/approve \
  -H "X-Api-Key: YOUR_KEY"
```

### Generating a spec with AI

Send a sample payload to the generate endpoint; Claude analyzes its structure and
produces a ready-to-use DSL spec automatically:

```bash
curl -s -X POST http://localhost/orbit-core/api/v1/connectors/generate \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -H "X-Ai-Key: sk-ant-YOUR_ANTHROPIC_KEY" \
  -H "X-Ai-Model: claude-sonnet-4-6" \
  -d '{
    "source_type": "prometheus",
    "payload": {
      "status": "success",
      "data": {
        "result": [
          { "metric": { "instance": "host1", "__name__": "cpu_usage" }, "value": [1700000000, "72.4"] }
        ]
      }
    }
  }'
# → {"ok":true,"id":"prometheus-...","status":"draft","spec":{...}}
```

Review the returned spec, then approve:

```bash
curl -s -X POST http://localhost/orbit-core/api/v1/connectors/<id>/approve \
  -H "X-Api-Key: YOUR_KEY"
```

### Pull connector authentication

Three authentication modes are supported for pull connectors:

```bash
# Bearer token
curl -s -X PATCH http://localhost/orbit-core/api/v1/connectors/<id> \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{"auth": {"kind": "bearer", "token": "sk-..."}}'

# HTTP Basic auth
curl -s -X PATCH http://localhost/orbit-core/api/v1/connectors/<id> \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{"auth": {"kind": "basic", "user": "admin", "pass": "secret"}}'

# Custom header
curl -s -X PATCH http://localhost/orbit-core/api/v1/connectors/<id> \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{"auth": {"kind": "header", "name": "X-Api-Key", "value": "abc123"}}'
```

### Dry-run test

Test a connector spec against a payload without writing anything to the database:

```bash
# Provide a payload explicitly
curl -s -X POST http://localhost/orbit-core/api/v1/connectors/<id>/test \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{"payload": {"host": "server-01", "cpu": 72.4, "ts": 1700000000}}'

# For pull connectors — omit payload to auto-fetch from pull_url
curl -s -X POST http://localhost/orbit-core/api/v1/connectors/<id>/test \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{}'
# → {"ok":true,"type":"metric","source":"fetched","valid":5,"skipped":0,"mapped":[...]}
```

### DSL spec reference

| Field | Description |
|-------|-------------|
| `type` | `"metric"` or `"event"` |
| `items_path` | Dot-separated path to the items array inside the root (`"data.results"`). Omit if root is the array or a single object. |
| `mappings` | Object mapping target fields to their source definitions |

Each mapping entry supports:

| Key | Description |
|-----|-------------|
| `path` | JSONPath-like dot/bracket expression (`"$.host"`, `"$.list[0].value"`) |
| `value` | Static literal (overrides `path`) |
| `transform` | `number`, `string`, `boolean`, `round`, `abs`, `iso8601`, `severity_map` |
| `default` | Fallback value when `path` resolves to `undefined` or `null` |

**Required fields for `type="metric"`:** `ts`, `asset_id`, `namespace`, `metric`, `value`

**Required fields for `type="event"`:** `ts`, `asset_id`, `namespace`, `kind`, `severity`, `title`

---

## Operations

### View logs

```bash
# All services
docker compose logs -f

# API only (structured JSON — pipe through jq or python3 for readability)
docker compose logs -f api | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        r = json.loads(line)
        print(r.get('level','').upper()[:3], r.get('msg',''), r.get('err',''))
    except: print(line, end='')
"
```

### Backup the database

```bash
docker compose exec postgres pg_dump -U postgres orbit | gzip > orbit-backup-$(date +%F).sql.gz
```

### Restore from backup

```bash
gunzip -c orbit-backup-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U postgres orbit
```

### Update to a new version

```bash
git pull
docker compose build
docker compose up -d
# migrations run automatically on startup
```

### Stop and restart

```bash
docker compose restart api     # restart API only
docker compose down            # stop all (data volume preserved)
docker compose down -v         # stop all AND delete data volume (destructive!)
```

---

## Production Hardening

### 1. Change default passwords

In `.env`:

```env
POSTGRES_PASSWORD=<strong-random-password>
ORBIT_API_KEY=<openssl-rand-hex-32>
```

Recreate the stack after changing passwords:

```bash
docker compose down -v   # drops the old database
docker compose up -d     # starts fresh with new password
```

> **Warning:** `down -v` deletes all data. Take a backup first if needed.

### 2. Run on a non-privileged port

```env
ORBIT_PORT=8080
```

Then use a reverse proxy (nginx, Caddy) in front to terminate TLS.

### 3. Example: HTTPS with Caddy

Install Caddy on the host, then create `/etc/caddy/Caddyfile`:

```caddy
your.domain.com {
    reverse_proxy /orbit-core/* localhost:8080
}
```

Set `ORBIT_PORT=8080` in `.env` and `docker compose up -d`.
Caddy auto-provisions a Let's Encrypt certificate.

### 4. Restrict database access

The `postgres` service is not exposed to the host. It is only reachable inside the
Docker network by the `api` and `migrate` services. No additional firewall rules needed.

---

## Docker Swarm (Advanced)

For high-availability or multi-node deployments, use the provided Swarm stack definition.
This requires Traefik as a reverse proxy and an existing Docker Swarm cluster.

```bash
# See deploy/orbit-core/docker-stack.yml for the full Swarm configuration.
docker stack deploy -c deploy/orbit-core/docker-stack.yml openclaw
```

See `deploy/orbit-core/docker-stack.yml` for Traefik labels, resource limits,
placement constraints, and the external network configuration.

---

## Troubleshooting

### `migrate` service exits with non-zero code

```bash
docker compose logs migrate
```

Common causes:
- PostgreSQL not ready yet — increase `start_period` in the postgres healthcheck or wait and retry.
- Wrong `POSTGRES_PASSWORD` — ensure it matches the one used when the volume was created.
  If you changed the password, run `docker compose down -v` and start fresh.

### UI shows "API unreachable" or blank page

1. Check the API is healthy: `curl http://localhost/orbit-core/api/v1/health`
2. Check nginx is proxying correctly: `docker compose logs ui`
3. Verify `ORBIT_API_KEY` is set the same in `.env` and in the UI's Admin → Settings.

### Port 80 already in use

Change `ORBIT_PORT` in `.env`:

```env
ORBIT_PORT=8080
```

Then `docker compose up -d`.

### Cannot connect from connectors

Ensure the connector's `ORBIT_API` variable points to the orbit-core host IP (not `localhost`),
since connectors typically run on different servers:

```bash
ORBIT_API=http://192.168.1.10   # use the actual host IP, not localhost
```

If a firewall blocks port 80, open it:

```bash
# Ubuntu / Debian
ufw allow 80/tcp
```

### Database is full / disk space

Check volume size:

```bash
docker system df -v | grep orbit_pg
```

Purge old data (retention runs automatically every hour, but can be triggered manually):

```bash
docker compose exec api node -e "
const { pool } = await import('./packages/api/dist/db.js');
await pool.query('SELECT purge_old_data()');
await pool.end();
"
```
