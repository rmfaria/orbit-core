# Nagios Connector (orbit-core)

This connector ships **Nagios perfdata** and **HARD state-change events** into orbit-core using the ingest API.

## What it ships

1) **Metrics** (perfdata)
- Reads from Nagios perfdata spool files (service + host)
- Converts perfdata pairs into Orbit MetricPoints
- Sends batches to `POST /api/v1/ingest/metrics`

2) **Events** (HARD-only)
- Reads `neb-hard-events.jsonl` (produced by `write_hard_event.py` global event handler)
- Converts entries into Orbit Events
- Sends batches to `POST /api/v1/ingest/events`

## Data flow

```
Nagios → perfdata spool files  → ship_metrics.py → orbit-core /api/v1/ingest/metrics
Nagios → write_hard_event.py → neb-hard-events.jsonl → ship_events.py → orbit-core /api/v1/ingest/events
```

Both shippers run as cron jobs every minute on the Nagios server.

## Requirements

- Python 3.10+
- Network access to orbit-core API

### Onde deve rodar

Os dois shippers lêem arquivos locais do servidor Nagios:

| Shipper | Arquivo lido |
|---|---|
| `ship_metrics.py` | `/var/lib/nagios4/service-perfdata.out`, `host-perfdata.out` |
| `ship_events.py` | `/var/log/nagios4/neb-hard-events.jsonl` |

Ambos devem rodar **no mesmo servidor que o Nagios**.

### Requisito crítico: event handler

O `ship_events.py` depende do arquivo `neb-hard-events.jsonl`.
Esse arquivo só é gerado se o `write_hard_event.py` estiver configurado como
**global event handler** no Nagios (`global_service_event_handler` + `global_host_event_handler`).

Sem essa configuração, nenhum evento de mudança de estado é enviado ao orbit-core
(apenas métricas chegam via `ship_metrics.py`).

Ver `INSTALL.md` passo 3 para a configuração completa.

## Perfdata file format

`ship_metrics.py` expects the **default Nagios tab-separated format** (no custom template).
Do **not** configure a custom `service_perfdata_file_template` / `host_perfdata_file_template`
unless you update the shipper to match.

> The TypeScript shipper (`packages/nagios-shipper`) uses a different format with `DATATYPE::` field
> prefixes and requires a custom template. The two shippers are not interchangeable on the same file.

## Environment variables

### Orbit destination
- `ORBIT_API` (default: `http://127.0.0.1:3000`)
- `ORBIT_API_KEY` — API Key (`X-Api-Key` header) — **recomendado**
- `ORBIT_BASIC_USER` / `ORBIT_BASIC_PASS` (legado, BasicAuth)
- `ORBIT_BASIC` (legado, `user:pass`)
- `ORBIT_BASIC_FILE` (legado, path containing password)

### Perfdata shipper (metrics)
- `NAGIOS_SERVICE_PERFDATA_FILE` (default: `/var/lib/nagios4/service-perfdata.out`)
- `NAGIOS_HOST_PERFDATA_FILE` (default: `/var/lib/nagios4/host-perfdata.out`)
- `STATE_PATH` (default: `/var/lib/orbit-core/nagios-metrics.state.json`)
- `MAX_BYTES_PER_RUN` (default: `5242880` — 5 MB per run)
- `BATCH_SIZE` (default: `1000`)

### HARD events shipper (events)
- `NAGIOS_HARD_EVENTS_JSONL` (default: `/var/log/nagios4/neb-hard-events.jsonl`)
- `STATE_PATH` (default: `/var/lib/orbit-core/nagios-events.state.json`)
- `MAX_BYTES_PER_RUN` (default: `5242880` — 5 MB per run)
- `BATCH_SIZE` (default: `200`)

### Event handler (write_hard_event.py)
- `ORBIT_EVENTS_SPOOL` (default: `/var/log/nagios4/neb-hard-events.jsonl`)

## Data mapping (events)

| Campo Nagios | Campo orbit-core |
|---|---|
| `$HOSTNAME$` | `asset_id` = `host:<hostname>` |
| — | `namespace` = `nagios` |
| — | `kind` = `state_change` |
| estado do host/serviço | `severity` (ver tabela abaixo) |
| `host + service + state` | `title` |
| `$SERVICEOUTPUT$` / `$HOSTOUTPUT$` | `message` |
| `kind:host:service` | `fingerprint` |

**Mapeamento de severity:**

| Tipo | Estado Nagios | Severity |
|---|---|---|
| Host | UP (0) | `info` |
| Host | DOWN (1) | `critical` |
| Host | UNREACHABLE (2) | `high` |
| Host | UNKNOWN (3) | `medium` |
| Service | OK (0) | `info` |
| Service | WARNING (1) | `medium` |
| Service | CRITICAL (2) | `critical` |
| Service | UNKNOWN (3) | `low` |

> Apenas mudanças de estado **HARD** são gravadas no spool e enviadas ao orbit-core.
> Estados SOFT são silenciosamente ignorados pelo `write_hard_event.py`.

## Verificação

```bash
# Confirmar que eventos chegam no orbit-core (namespace=nagios)
curl -s -H "X-Api-Key: <sua-chave>" \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "query":{
      "kind":"events",
      "namespace":"nagios",
      "from":"'"$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)"'",
      "to":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "limit":5
    }
  }'

# Verificar state files e logs no servidor Nagios
cat /var/lib/orbit-core/nagios-events.state.json
cat /var/lib/orbit-core/nagios-metrics.state.json
tail -20 /var/log/orbit-core/nagios_events_shipper.log
tail -20 /var/log/orbit-core/nagios_metrics_shipper.log

# Verificar spool de eventos HARD
tail -5 /var/log/nagios4/neb-hard-events.jsonl
```

## Example cron

See `cron.example` in this folder.

## Notes

- This connector is designed to be **deterministic / no-AI**.
- Both shippers track byte offset in a state file; detect log rotation automatically (offset > file size → reset to 0).
- Avoid committing secrets. Use env vars or files outside the repo.
