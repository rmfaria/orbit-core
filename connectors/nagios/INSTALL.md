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
# NOTE: we rely on the default Nagios perfdata output format (tab-separated)
# If you use a custom template, adjust the shipper or the template accordingly.

# Host perfdata spool (optional)
host_perfdata_file=/var/lib/nagios4/host-perfdata.out
host_perfdata_file_mode=a
host_perfdata_file_processing_interval=0
```

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

## 3) Produce HARD events JSONL (recommended: NEB module)

The connector expects a JSONL spool file, default:

- `/var/log/nagios4/neb-hard-events.jsonl`

### Option A (recommended): build and enable the NEB module

This repo contains a simple NEB module source (HARD-only) you can compile:

- Path: `src/nagios-neb-supabase/ne_supabase_broker.c`

Build requirements:

```bash
apt-get install -y build-essential
```

Build and install the module:

```bash
cd src/nagios-neb-supabase
make
make install
```

Enable it in `/etc/nagios4/nagios.cfg`:

```ini
broker_module=/usr/local/lib/nagios/nebmods/ne_supabase_broker.so
```

Restart Nagios:

```bash
systemctl restart nagios4
```

Validate JSONL spool:

```bash
ls -la /var/log/nagios4/neb-hard-events.jsonl
tail -n 5 /var/log/nagios4/neb-hard-events.jsonl
```

### Option B: alternative producer

If you already have an event handler / broker that writes HARD events to a JSONL file, you can keep it.
Just point the shipper to it via `NAGIOS_HARD_EVENTS_JSONL`.

---

## 4) Configure cron jobs

Create a secret file for BasicAuth password (recommended):

```bash
mkdir -p /etc/orbit-core
chmod 0750 /etc/orbit-core
# one-line file containing ONLY the password
printf '%s' 'YOUR_PASSWORD_HERE' > /etc/orbit-core/orbitadmin.pass
chmod 0640 /etc/orbit-core/orbitadmin.pass
```

Create cron entries (example):

```cron
* * * * * root \
  ORBIT_API=https://prod.example.com/orbit-core \
  ORBIT_BASIC_USER=orbitadmin \
  ORBIT_BASIC_FILE=/etc/orbit-core/orbitadmin.pass \
  NAGIOS_SERVICE_PERFDATA_FILE=/var/lib/nagios4/service-perfdata.out \
  NAGIOS_HOST_PERFDATA_FILE=/var/lib/nagios4/host-perfdata.out \
  STATE_PATH=/var/lib/orbit-core/nagios-metrics.state.json \
  python3 /opt/orbit-core/connectors/nagios/ship_metrics.py \
  >>/var/log/orbit-core/nagios_metrics_shipper.log 2>&1

* * * * * root \
  ORBIT_API=https://prod.example.com/orbit-core \
  ORBIT_BASIC_USER=orbitadmin \
  ORBIT_BASIC_FILE=/etc/orbit-core/orbitadmin.pass \
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

### Check orbit-core ingest endpoints

```bash
curl -u 'orbitadmin:YOUR_PASSWORD' \
  https://prod.example.com/orbit-core/api/v1/health
```

### Run shippers manually (one-shot)

```bash
ORBIT_API=https://prod.example.com/orbit-core \
ORBIT_BASIC_USER=orbitadmin \
ORBIT_BASIC_FILE=/etc/orbit-core/orbitadmin.pass \
python3 /opt/orbit-core/connectors/nagios/ship_metrics.py

ORBIT_API=https://prod.example.com/orbit-core \
ORBIT_BASIC_USER=orbitadmin \
ORBIT_BASIC_FILE=/etc/orbit-core/orbitadmin.pass \
python3 /opt/orbit-core/connectors/nagios/ship_events.py
```

---

## Troubleshooting

- **401/403 from orbit-core**: BasicAuth not set / wrong credentials / wrong URL.
- **No metrics**: perfdata files not enabled or empty; check `nagios.cfg` and file paths.
- **No events**: JSONL spool not being written; confirm NEB module is loaded and Nagios restarted.
- **File rotation**: both shippers detect file truncation by comparing last known position with current file length and will restart from 0.

---

## Security notes

- Do not commit secrets.
- Prefer `ORBIT_BASIC_FILE` over embedding passwords in cron.
- Keep orbit-core behind TLS + auth.
