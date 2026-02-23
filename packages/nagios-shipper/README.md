# @orbit/nagios-shipper

A deterministic, **no-AI** shipper that reads data from **Nagios** and sends it to **orbit-core**.

- **Metrics**: reads Nagios perfdata spool files (`service_perfdata_file` / `host_perfdata_file`)
- **Events**: reads `nagios.log` and ships **HARD** alerts only (SOFT alerts are ignored)

> Note: This shipper is designed for *batch/cron* usage (recommended) or a simple watch/daemon mode.

---

## Nagios configuration

### 1) Enable perfdata writing (`nagios.cfg`)

Example templates (tab-separated `FIELD::VALUE` pairs):

```ini
process_performance_data=1

# Service perfdata
service_perfdata_file=/var/log/nagios/service-perfdata.dat
service_perfdata_file_mode=a
service_perfdata_file_processing_interval=0
service_perfdata_file_template=DATATYPE::SERVICEPERFDATA\tTIMET::$LASTSERVICECHECK$\tHOSTNAME::$HOSTNAME$\tSERVICEDESC::$SERVICEDESC$\tSERVICEPERFDATA::$SERVICEPERFDATA$\tSERVICESTATE::$SERVICESTATE$\tSERVICESTATETYPE::$SERVICESTATETYPE$

# Host perfdata (optional)
host_perfdata_file=/var/log/nagios/host-perfdata.dat
host_perfdata_file_mode=a
host_perfdata_file_processing_interval=0
host_perfdata_file_template=DATATYPE::HOSTPERFDATA\tTIMET::$LASTHOSTCHECK$\tHOSTNAME::$HOSTNAME$\tHOSTPERFDATA::$HOSTPERFDATA$\tHOSTSTATE::$HOSTSTATE$\tHOSTSTATETYPE::$HOSTSTATETYPE$
```

### 2) Locate `nagios.log`

Common paths:
- `/var/log/nagios/nagios.log`
- `/usr/local/nagios/var/nagios.log`

---

## Environment variables

| Variable | Default | Description |
|---|---:|---|
| `ORBIT_API_URL` | `http://localhost:3000` | orbit-core API base URL |
| `NAGIOS_PERFDATA_FILE` | — | Path to the perfdata file |
| `NAGIOS_LOG_FILE` | — | Path to `nagios.log` |
| `NAGIOS_DEFAULT_NAMESPACE` | `nagios` | Namespace used for metrics/events |
| `SHIPPER_BATCH_SIZE` | `500` | Records per request (max 5000) |
| `SHIPPER_STATE_DIR` | `/tmp/orbit-nagios-shipper` | Directory to store file positions |
| `SHIPPER_MODE` | `once` | `once` (cron) or `watch` (daemon) |
| `SHIPPER_INTERVAL_SEC` | `60` | Interval used in `watch` mode |
| `LOG_LEVEL` | `info` | pino log level |

---

## Usage

### Cron mode (recommended)

```bash
pnpm --filter @orbit/nagios-shipper build

* * * * * ORBIT_API_URL=http://orbit-core:3000 \
  NAGIOS_PERFDATA_FILE=/var/log/nagios/service-perfdata.dat \
  NAGIOS_LOG_FILE=/var/log/nagios/nagios.log \
  node /opt/orbit/packages/nagios-shipper/dist/index.js
```

### Watch mode (daemon)

```bash
ORBIT_API_URL=http://orbit-core:3000 \
NAGIOS_PERFDATA_FILE=/var/log/nagios/service-perfdata.dat \
NAGIOS_LOG_FILE=/var/log/nagios/nagios.log \
SHIPPER_MODE=watch \
SHIPPER_INTERVAL_SEC=30 \
node dist/index.js
```

---

## Data mapping

### Perfdata → MetricPoint

- `asset_id`: `host:<hostname>`
- `metric`: perfdata label (e.g. `load1`)
- `dimensions.service`: service description (e.g. `CPU Load`)
- `dimensions.kind`: `service` or `host`

### HARD alert → Event

- `asset_id`: `host:<hostname>`
- `kind`: `state_change`
- `severity` mapping:
  - `CRITICAL` / `DOWN` → `critical`
  - `WARNING` → `medium`
  - `UNKNOWN` → `low`
  - everything else → `info`

---

## Examples

### Perfdata line

```text
DATATYPE::SERVICEPERFDATA\tTIMET::1708700000\tHOSTNAME::web01\tSERVICEDESC::HTTP\tSERVICEPERFDATA::time=0.123s;5;10;0 size=1234B\tSERVICESTATE::OK\tSERVICESTATETYPE::HARD
DATATYPE::HOSTPERFDATA\tTIMET::1708700010\tHOSTNAME::web01\tHOSTPERFDATA::rta=1.2ms;;;0 pl=0%;;;0\tHOSTSTATE::UP\tHOSTSTATETYPE::HARD
```

### `nagios.log` lines

```text
[1708700100] SERVICE ALERT: web01;HTTP;CRITICAL;HARD;3;Connection refused
[1708700200] HOST ALERT: db01;DOWN;HARD;3;PING CRITICAL - Packet loss = 100%
```
