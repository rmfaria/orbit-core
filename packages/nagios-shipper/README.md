# @orbit/nagios-shipper

Shipper que lê dados do Nagios e os envia para o orbit-core.

- **Métricas**: lê o arquivo `service_perfdata_file` / `host_perfdata_file`
- **Eventos**: lê o `nagios.log` para capturar alertas HARD

## Configuração do Nagios

### 1. Habilitar escrita de perfdata (`nagios.cfg`)

```ini
process_performance_data=1

# Arquivo de perfdata de serviços
service_perfdata_file=/var/log/nagios/service-perfdata.dat
service_perfdata_file_mode=a
service_perfdata_file_processing_interval=0
service_perfdata_file_template=DATATYPE::SERVICEPERFDATA\tTIMET::$LASTSERVICECHECK$\tHOSTNAME::$HOSTNAME$\tSERVICEDESC::$SERVICEDESC$\tSERVICEPERFDATA::$SERVICEPERFDATA$\tSERVICESTATE::$SERVICESTATE$\tSERVICESTATETYPE::$SERVICESTATETYPE$

# Arquivo de perfdata de hosts (opcional)
host_perfdata_file=/var/log/nagios/host-perfdata.dat
host_perfdata_file_mode=a
host_perfdata_file_processing_interval=0
host_perfdata_file_template=DATATYPE::HOSTPERFDATA\tTIMET::$LASTHOSTCHECK$\tHOSTNAME::$HOSTNAME$\tHOSTPERFDATA::$HOSTPERFDATA$\tHOSTSTATE::$HOSTSTATE$\tHOSTSTATETYPE::$HOSTSTATETYPE$
```

### 2. Localizar o nagios.log

Geralmente em `/var/log/nagios/nagios.log` ou `/usr/local/nagios/var/nagios.log`.

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `ORBIT_API_URL` | `http://localhost:3000` | URL base da API orbit-core |
| `NAGIOS_PERFDATA_FILE` | — | Caminho do arquivo de perfdata |
| `NAGIOS_LOG_FILE` | — | Caminho do nagios.log |
| `NAGIOS_DEFAULT_NAMESPACE` | `nagios` | Namespace usado nas métricas/eventos |
| `SHIPPER_BATCH_SIZE` | `500` | Registros por request à API (máx 5000) |
| `SHIPPER_STATE_DIR` | `/tmp/orbit-nagios-shipper` | Diretório para guardar posição nos arquivos |
| `SHIPPER_MODE` | `once` | `once` (ideal para cron) ou `watch` (daemon) |
| `SHIPPER_INTERVAL_SEC` | `60` | Intervalo em segundos no modo `watch` |
| `LOG_LEVEL` | `info` | Nível de log (pino): debug, info, warn, error |

---

## Uso

### Modo cron (recomendado)

```bash
# Build
pnpm --filter @orbit/nagios-shipper build

# Adicionar ao crontab (a cada minuto)
* * * * * ORBIT_API_URL=http://orbit-core:3000 \
  NAGIOS_PERFDATA_FILE=/var/log/nagios/service-perfdata.dat \
  NAGIOS_LOG_FILE=/var/log/nagios/nagios.log \
  node /opt/orbit/packages/nagios-shipper/dist/index.js
```

### Modo watch (daemon)

```bash
ORBIT_API_URL=http://orbit-core:3000 \
NAGIOS_PERFDATA_FILE=/var/log/nagios/service-perfdata.dat \
NAGIOS_LOG_FILE=/var/log/nagios/nagios.log \
SHIPPER_MODE=watch \
SHIPPER_INTERVAL_SEC=30 \
node dist/index.js
```

### Dev

```bash
NAGIOS_PERFDATA_FILE=./test-perfdata.dat \
NAGIOS_LOG_FILE=./test-nagios.log \
pnpm --filter @orbit/nagios-shipper dev
```

---

## Mapeamento de dados

### Perfdata → MetricPoint

| Campo Nagios | Campo orbit-core |
|---|---|
| HOSTNAME | `asset_id` |
| TIMET | `ts` (ISO 8601) |
| — | `namespace` = NAGIOS_DEFAULT_NAMESPACE |
| `SERVICEDESC.label` | `metric` (serviço) |
| `label` | `metric` (host) |
| valor numérico | `value` |
| UOM | `unit` |
| SERVICEDESC | `dimensions.service` |

### HARD Alert → Event

| Campo Nagios | Campo orbit-core |
|---|---|
| HOSTNAME | `asset_id` |
| timestamp | `ts` |
| — | `namespace` = NAGIOS_DEFAULT_NAMESPACE |
| SERVICE/HOST ALERT | `kind` = `service_alert` / `host_alert` |
| STATE | `severity` (CRITICAL→critical, WARNING→medium, UNKNOWN→low, OK→info) |
| `Service: STATE` | `title` |
| output | `message` |

> Apenas alertas **HARD** são enviados. Alertas SOFT são ignorados.

---

## Exemplo de arquivo de perfdata

```
DATATYPE::SERVICEPERFDATA	TIMET::1708700000	HOSTNAME::web01	SERVICEDESC::HTTP	SERVICEPERFDATA::time=0.123s;5;10;0 size=1234B	SERVICESTATE::OK	SERVICESTATETYPE::HARD
DATATYPE::HOSTPERFDATA	TIMET::1708700010	HOSTNAME::web01	HOSTPERFDATA::rta=1.2ms;;;0 pl=0%;;;0	HOSTSTATE::UP	HOSTSTATETYPE::HARD
```

## Exemplo de nagios.log

```
[1708700100] SERVICE ALERT: web01;HTTP;CRITICAL;HARD;3;Connection refused
[1708700200] HOST ALERT: db01;DOWN;HARD;3;PING CRITICAL - Packet loss = 100%
```
