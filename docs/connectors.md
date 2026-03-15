# Connectors

orbit-core ingests telemetry from multiple sources through **deterministic connectors** (no AI).
They are designed to be **cron-safe**, predictable and easy to audit.

All connectors ship to the same ingest API:

- `POST /api/v1/ingest/metrics`
- `POST /api/v1/ingest/events`

## Overview

| Connector | Type | Data | Namespace | Install |
|---|---|---|---|---|
| **Nagios** | Passive (local files) | Metrics (perfdata) + Events (HARD state changes) | `nagios` | [`connectors/nagios/INSTALL.md`](../connectors/nagios/INSTALL.md) |
| **Wazuh** | Passive (local files) | Security alerts | `wazuh` | [`connectors/wazuh/INSTALL.md`](../connectors/wazuh/INSTALL.md) |
| **Fortigate** | Via Wazuh (syslog) | Firewall logs | `wazuh` + `kind=fortigate` | [`connectors/fortigate/INSTALL.md`](../connectors/fortigate/INSTALL.md) |
| **n8n** | Active (polling REST API) + Error Trigger | Execution failures + stuck runs | `n8n` | [`connectors/n8n/INSTALL.md`](../connectors/n8n/INSTALL.md) |
| **MISP** | Active (polling REST API) | Threat indicators (IoCs) + high-severity events | `misp` | [`connectors/misp/README.md`](../connectors/misp/README.md) |

## AI-Generated Connectors

orbit-core includes a built-in **AI Connector Generator** that creates a fully working integration for any HTTP API in seconds — no boilerplate required.

### Two ways to use it

| Method | How |
|---|---|
| REST API | `POST /api/v1/ai/plugin` with a plain-text description of the source API |
| UI | Connectors tab → **Generate with AI** sub-tab |

### What the AI returns

| Field | Description |
|---|---|
| `connector_spec` | A `ConnectorSpec` JSON object ready to register in orbit-core |
| `agent_script` | A Python push agent that reads from the source and calls `/api/v1/ingest/raw/:id` |
| `readme` | Markdown install and configuration instructions |

### Workflow after generation

1. Register the spec: `POST /api/v1/connectors` (body: `connector_spec`)
2. Approve it: `POST /api/v1/connectors/:id/approve`
3. Deploy the agent script and configure it to point at your orbit-core instance
4. The agent pushes raw payloads to `POST /api/v1/ingest/raw/:source_id`; orbit-core applies the spec mapping automatically

The UI **copy** button and **Use this Spec** flow let you complete steps 1-2 without leaving the browser.

### Example sources that work well

Zabbix, Datadog, CloudWatch, PagerDuty, custom REST APIs, IoT endpoints — anything that exposes an HTTP interface.

### Quick example

```bash
curl -X POST https://orbit-core/api/v1/ai/plugin \
  -H "X-Api-Key: $ORBIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Zabbix 6.x REST API. I want to collect trigger events (problems) with host name, severity and timestamp. The base URL is https://zabbix.internal/api_jsonrpc.php and I authenticate with an API token."
  }'
```

Response (abbreviated):

```json
{
  "connector_spec": {
    "id": "zabbix",
    "namespace": "zabbix",
    "mode": "pull",
    "auth": { "type": "api_key", "header": "Authorization", "prefix": "Bearer" },
    "endpoints": [ { "path": "/api_jsonrpc.php", "method": "POST", "mapping": { ... } } ]
  },
  "agent_script": "#!/usr/bin/env python3\n...",
  "readme": "# Zabbix Connector\n..."
}
```

---

## Authentication (recommended)

Use an application API key.

- Server: set `ORBIT_API_KEY`
- Clients/connectors: send `X-Api-Key: <key>`

If `ORBIT_API_KEY` is set on the API, it becomes the **authoritative** auth layer for most routes.
BasicAuth may still be used at the reverse-proxy edge, but do not rely on it as the only protection.

## Nagios

Two Python shippers (cron), plus one optional writer script.

```
Nagios → perfdata spool files → ship_metrics.py → POST /api/v1/ingest/metrics
Nagios → write_hard_event.py  → neb-hard-events.jsonl
      → ship_events.py        → POST /api/v1/ingest/events
```

| Script | Purpose |
|---|---|
| `ship_metrics.py` | Converts tab-separated perfdata to MetricPoints |
| `ship_events.py` | Ships HARD state changes from a JSONL spool to Events |
| `write_hard_event.py` | Nagios global event handler that produces the JSONL spool |

Event mapping (high level):

| Nagios | orbit-core |
|---|---|
| `$HOSTNAME$` | `asset_id = host:<hostname>` |
| — | `namespace = nagios` |
| — | `kind = state_change` |
| host/service state | `severity` (DOWN → critical, WARNING → medium, etc.) |

**Important**: `write_hard_event.py` must be configured as:
- `global_service_event_handler`
- `global_host_event_handler`

in `nagios.cfg`. Only **HARD** changes are captured.

References: [`connectors/nagios/README.md`](../connectors/nagios/README.md) · [`INSTALL.md`](../connectors/nagios/INSTALL.md)

## Wazuh

Passive connector that reads `alerts.json` directly from disk (Wazuh Manager host).

```
Wazuh Manager → /var/ossec/logs/alerts/alerts.json → ship_events.py → POST /api/v1/ingest/events
```

Mapping:

| Wazuh | orbit-core |
|---|---|
| `agent.name` | `asset_id = host:<name>` |
| — | `namespace = wazuh` |
| `rule.groups[0]` | `kind` |
| `rule.level` (0–15) | `severity` (info/low/medium/high/critical) |
| `rule.description` | `title` |
| `full_log` | `message` |

File permissions: `alerts.json` is typically `0640` and owned by group `wazuh`.
The cron user must be in that group.

Alternative mode — OpenSearch (`ship_events_opensearch.py`):
- queries the Wazuh Indexer via REST
- can run from another host
- requires the indexer to be reachable (many deployments bind to `127.0.0.1:9200`)

References: [`connectors/wazuh/README.md`](../connectors/wazuh/README.md) · [`INSTALL.md`](../connectors/wazuh/INSTALL.md)

## Fortigate

There is no standalone Fortigate connector.
Logs flow through the Wazuh pipeline:

```
Fortigate → syslog 514 → Wazuh Manager → ship_events.py → orbit-core
```

Events arrive as `namespace=wazuh` and `kind=fortigate`.
The UI uses that combination to surface Fortigate as a distinct source.

References: [`connectors/fortigate/README.md`](../connectors/fortigate/README.md) · [`INSTALL.md`](../connectors/fortigate/INSTALL.md)

## n8n

Two complementary modes (recommended: use both).

### Active mode — `ship_events.py` (polling REST API)

```
n8n REST API (/api/v1/executions?status=error)   → ship_events.py → ingest/events
n8n REST API (/api/v1/executions?status=running) → ship_events.py → ingest/events
```

Run every minute on any host that can reach both n8n and orbit-core.
Captures:
- all failed executions
- stuck executions (running longer than `STUCK_AFTER_MINUTES`)

| Event | kind | severity |
|---|---|---|
| failed execution | `execution_error` | `high` |
| stuck execution | `execution_stuck` | `medium` |

### Plug-and-play — Error Trigger workflow

Import `orbit_error_reporter.json` into n8n.
It sends events in near real time when a workflow fails.

**Important**: Error Trigger does **not** apply globally.
Each workflow must set the Orbit Error Reporter as its **Error Workflow**.

References: [`connectors/n8n/README.md`](../connectors/n8n/README.md) · [`INSTALL.md`](../connectors/n8n/INSTALL.md)

## MISP

Threat intelligence connector that pulls IoC attributes from a MISP instance via REST API.

```
MISP REST API → ship_misp.py → POST /api/v1/threat-intel/indicators
                              → POST /api/v1/ingest/events (high/medium IoCs)
```

| Feature | Details |
|---|---|
| Script | `ship_misp.py` |
| Mode | Active polling (cron, every 5 min) |
| State | Timestamp cursor in `state.json` |
| Auth | MISP API key (`Authorization` header) |
| Data | IoC attributes (ip-src, ip-dst, domain, md5, sha256, url, etc.) |
| Dedup | MISP attribute UUID as `source_id` — upsert on conflict |

The connector also ships high/medium threat-level IoCs as orbit events (`namespace=misp`, `kind=ioc.new`) for dashboard visibility.

A separate background worker (`threat-intel`) runs every 2 minutes inside the API, scanning recent events for values that match active indicators. Matches are recorded in `threat_matches` and generate `ioc.hit` events.

| Variable | Default | Description |
|---|---|---|
| `MISP_URL` | — | MISP instance URL (e.g. `https://misp.example.com`) |
| `MISP_API_KEY` | — | MISP automation/API key |
| `MISP_VERIFY_TLS` | `true` | Set `false` for self-signed certificates |
| `ONLY_IDS` | `true` | Only pull attributes with `to_ids=true` |
| `INCLUDE_TYPES` | *(all)* | Comma-separated type filter (e.g. `ip-src,ip-dst,domain`) |
| `INITIAL_LOOKBACK_HOURS` | `24` | First run lookback window |
| `MAX_ATTRIBUTES` | `10000` | Safety limit per run |
| `BATCH_SIZE` | `200` | Indicators per API call |
| `STATE_PATH` | `/var/lib/orbit-core/misp.state.json` | Timestamp cursor |

References: [`connectors/misp/README.md`](../connectors/misp/README.md)

---

## Building a new connector

Guidelines:

1. **Deterministic / no AI** — safe for cron
2. **State file** with `fcntl.flock` — cursor via byte offset (files) or ISO timestamp (APIs)
3. **Batch ingest** — `POST /api/v1/ingest/events` with `{ "events": [...] }`
4. **Fingerprint** — enables exact deduplication in orbit-core
5. **Auth** — prefer `ORBIT_API_KEY` → `X-Api-Key` header

Minimal required fields for an event:

```json
{
  "ts":          "2026-02-24T12:00:00Z",
  "asset_id":    "host:myserver",
  "namespace":   "my-connector",
  "kind":        "event-type",
  "severity":    "high",
  "title":       "Short description",
  "message":     "Full details",
  "fingerprint": "my-connector:event:id"
}
```

Implementation reference: `connectors/nagios/ship_events.py`.

---

## macOS Agent

A lightweight push agent that runs as a macOS LaunchAgent and ships host metrics to orbit-core every 120 seconds.

| Property | Value |
|---|---|
| Namespace | `macos` |
| Mode | Push (LaunchAgent, interval 120 s) |
| Ingest endpoint | `POST /api/v1/ingest/raw/macos` |
| Agent script | `/usr/local/bin/orbit-agent.py` |

### Metrics collected

| Metric | Unit | Description |
|---|---|---|
| `cpu.usage_pct` | % | Overall CPU utilisation |
| `memory.usage_pct` | % | RAM used as a percentage of total |
| `memory.used_mb` | MB | RAM currently in use |
| `memory.total_mb` | MB | Total installed RAM |
| `disk.usage_pct` | % | Root volume used as a percentage of total |
| `disk.used_gb` | GB | Root volume space used |
| `disk.total_gb` | GB | Root volume total capacity |

### Install

1. Register the ConnectorSpec in orbit-core (generated by the AI Plugin Generator or provided in `connectors/macos/`):

   ```bash
   curl -X POST https://orbit-core/api/v1/connectors \
     -H "X-Api-Key: $ORBIT_API_KEY" \
     -H "Content-Type: application/json" \
     -d @connectors/macos/connector_spec.json
   ```

2. Approve the connector:

   ```bash
   curl -X POST https://orbit-core/api/v1/connectors/macos/approve \
     -H "X-Api-Key: $ORBIT_API_KEY"
   ```

3. Install the agent and LaunchAgent plist:

   ```bash
   sudo cp connectors/macos/orbit-agent.py /usr/local/bin/orbit-agent.py
   sudo chmod +x /usr/local/bin/orbit-agent.py
   cp connectors/macos/com.orbitcore.agent.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.orbitcore.agent.plist
   ```

4. Set the required environment variables (or hard-code them in the plist):

   ```
   ORBIT_URL=https://orbit-core
   ORBIT_API_KEY=<your-key>
   ```

Once running, metrics appear in the UI under namespace `macos` within 2 minutes.
