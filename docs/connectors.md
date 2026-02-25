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
