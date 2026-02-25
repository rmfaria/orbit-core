# Nagios Connector — Installation (Debian/Ubuntu `nagios4`)

This guide installs the **Python Nagios Connector** for orbit-core.

It ships:
- **Metrics** from Nagios perfdata spool files → `POST /api/v1/ingest/metrics`
- **HARD-only** host/service check events (JSONL spool) → `POST /api/v1/ingest/events`

> Goal: run as deterministic cron jobs (no-AI).

---

## 0) Prerequisites

- Nagios Core (`nagios4` on Debian/Ubuntu)
- Python **3.10+**
- Network access from the Nagios host to the orbit-core API

### Install Python deps

Debian/Ubuntu:

```bash
apt-get update
apt-get install -y python3 python3-pip
pip3 install requests
```

---

## 1) Install the connector scripts

Choose a location (example):

```bash
mkdir -p /opt/orbit-core/connectors
cp -a ./connectors/nagios /opt/orbit-core/connectors/
chmod +x /opt/orbit-core/connectors/nagios/*.py
```

Create a state directory (used to track file positions):

```bash
mkdir -p /var/lib/orbit-core
chown root:root /var/lib/orbit-core
chmod 0755 /var/lib/orbit-core
```

---

## 2) Enable perfdata spooling in Nagios

Edit Nagios config:

- File: `/etc/nagios4/nagios.cfg`

Ensure these are enabled (example values):

```ini
process_performance_data=1

# Service perfdata spool
service_perfdata_file=/var/lib/nagios4/service-perfdata.out
service_perfdata_file_mode=a
service_perfdata_file_processing_interval=0

# Host perfdata spool (optional)
host_perfdata_file=/var/lib/nagios4/host-perfdata.out
host_perfdata_file_mode=a
host_perfdata_file_processing_interval=0
```

> **Important — perfdata file format**: `ship_metrics.py` expects the **default Nagios
> tab-separated template** (no `DATATYPE::` prefix). Do **not** set a custom
> `service_perfdata_file_template` or `host_perfdata_file_template` unless you also
> update the shipper. The default template columns are:
>
> Service: `epoch  host  servicedesc  state  attempt  statetype  exectime  latency  output  perfdata`
>
> Host: `epoch  host  state  attempt  statetype  exectime  latency  perfdata`

Restart Nagios:

```bash
systemctl restart nagios4
```

Verify the perfdata files are being written:

```bash
ls -la /var/lib/nagios4/*-perfdata.out
tail -n 3 /var/lib/nagios4/service-perfdata.out
```

---

## 3) Produce HARD events JSONL (global event handler)

The connector expects a JSONL spool file, default:

- `/var/log/nagios4/neb-hard-events.jsonl`

The included `write_hard_event.py` produces this spool when configured as a
Nagios **global event handler** — no compiled NEB module required.

### 3.1) Register the command

Add to `/etc/nagios4/conf.d/orbit-commands.cfg` (create if missing):

```nagios
define command {
    command_name  orbit-svc-event
    command_line  /usr/bin/python3 /opt/orbit-core/connectors/nagios/write_hard_event.py \
                  service "$HOSTNAME$" "$SERVICEDESC$" "$SERVICESTATE$" \
                  "$SERVICESTATETYPE$" "$SERVICEATTEMPT$" "$SERVICEOUTPUT$" \
                  "$LASTSERVICECHECK$"
}

define command {
    command_name  orbit-host-event
    command_line  /usr/bin/python3 /opt/orbit-core/connectors/nagios/write_hard_event.py \
                  host "$HOSTNAME$" "" "$HOSTSTATE$" \
                  "$HOSTSTATETYPE$" "$HOSTATTEMPT$" "$HOSTOUTPUT$" \
                  "$LASTHOSTCHECK$"
}
```

### 3.2) Enable global event handlers

Add to `/etc/nagios4/nagios.cfg`:

```ini
event_handler_enabled=1
global_service_event_handler=orbit-svc-event
global_host_event_handler=orbit-host-event
```

### 3.3) Create spool directory and restart

```bash
mkdir -p /var/log/nagios4
chown nagios:nagios /var/log/nagios4
systemctl restart nagios4
```

Validate spool after the first HARD state change (or test manually):

```bash
ls -la /var/log/nagios4/neb-hard-events.jsonl
tail -n 5 /var/log/nagios4/neb-hard-events.jsonl
```

> **Note**: `write_hard_event.py` silently ignores SOFT state changes.
> Only HARD transitions are written to the spool.

---

## 4) Configure cron jobs

Salvar a API Key em arquivo seguro:

```bash
mkdir -p /etc/orbit-core
chmod 0750 /etc/orbit-core
printf '%s' 'SUA_ORBIT_API_KEY_AQUI' > /etc/orbit-core/orbit.key
chmod 0640 /etc/orbit-core/orbit.key
```

Create cron entries (`/etc/cron.d/orbit-nagios`):

```cron
* * * * * root \
  ORBIT_API=https://prod.example.com/orbit-core \
  ORBIT_API_KEY=$(cat /etc/orbit-core/orbit.key) \
  NAGIOS_SERVICE_PERFDATA_FILE=/var/lib/nagios4/service-perfdata.out \
  NAGIOS_HOST_PERFDATA_FILE=/var/lib/nagios4/host-perfdata.out \
  STATE_PATH=/var/lib/orbit-core/nagios-metrics.state.json \
  python3 /opt/orbit-core/connectors/nagios/ship_metrics.py \
  >>/var/log/orbit-core/nagios_metrics_shipper.log 2>&1

* * * * * root \
  ORBIT_API=https://prod.example.com/orbit-core \
  ORBIT_API_KEY=$(cat /etc/orbit-core/orbit.key) \
  NAGIOS_HARD_EVENTS_JSONL=/var/log/nagios4/neb-hard-events.jsonl \
  STATE_PATH=/var/lib/orbit-core/nagios-events.state.json \
  python3 /opt/orbit-core/connectors/nagios/ship_events.py \
  >>/var/log/orbit-core/nagios_events_shipper.log 2>&1
```

Reload cron (if needed):

```bash
systemctl reload cron || true
```

---

## 5) Verify ingestion

### Check orbit-core

```bash
curl -s -H "X-Api-Key: $(cat /etc/orbit-core/orbit.key)" \
  https://prod.example.com/orbit-core/api/v1/health
```

### Run shippers manually (one-shot)

```bash
ORBIT_API=https://prod.example.com/orbit-core \
ORBIT_API_KEY=$(cat /etc/orbit-core/orbit.key) \
python3 /opt/orbit-core/connectors/nagios/ship_metrics.py

ORBIT_API=https://prod.example.com/orbit-core \
ORBIT_API_KEY=$(cat /etc/orbit-core/orbit.key) \
python3 /opt/orbit-core/connectors/nagios/ship_events.py
```

---

## Troubleshooting

- **401/403 from orbit-core**: API key is incorrect or missing; verify `ORBIT_API_KEY`.
- **No metrics**: perfdata files not enabled or empty; check `nagios.cfg` and file paths.
- **No events**: JSONL spool not being written; confirm `write_hard_event.py` is configured as global event handler and Nagios restarted. Check Nagios logs for command errors.
- **File rotation**: both shippers detect file truncation by comparing last known position with current file length and will restart from 0.

---

## Security notes

- Do not commit secrets.
- Prefer `ORBIT_BASIC_FILE` over embedding passwords in cron.
- Keep orbit-core behind TLS + auth.
