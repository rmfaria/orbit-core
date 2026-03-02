# @orbit/nagios-shipper

**Creator:** Rodrigo Menchio <rodrigomenchio@gmail.com>

Shipper TypeScript determinístico (**sem IA**) que lê dados do **Nagios** e envia
para o **orbit-core**. Alternativa ao conector Python em `connectors/nagios/`.

- **Métricas**: lê arquivos spool de perfdata (`service_perfdata_file` / `host_perfdata_file`)
- **Eventos**: lê `nagios.log` e envia apenas alertas **HARD** (SOFT são ignorados)

> Projetado para uso via **cron** (recomendado) ou modo watch/daemon.

---

## Configuração do Nagios

### 1) Habilitar escrita de perfdata (`nagios.cfg`)

```ini
process_performance_data=1

# Service perfdata
service_perfdata_file=/var/log/nagios/service-perfdata.dat
service_perfdata_file_mode=a
service_perfdata_file_processing_interval=0
service_perfdata_file_template=DATATYPE::SERVICEPERFDATA\tTIMET::$LASTSERVICECHECK$\tHOSTNAME::$HOSTNAME$\tSERVICEDESC::$SERVICEDESC$\tSERVICEPERFDATA::$SERVICEPERFDATA$\tSERVICESTATE::$SERVICESTATE$\tSERVICESTATETYPE::$SERVICESTATETYPE$

# Host perfdata (opcional)
host_perfdata_file=/var/log/nagios/host-perfdata.dat
host_perfdata_file_mode=a
host_perfdata_file_processing_interval=0
host_perfdata_file_template=DATATYPE::HOSTPERFDATA\tTIMET::$LASTHOSTCHECK$\tHOSTNAME::$HOSTNAME$\tHOSTPERFDATA::$HOSTPERFDATA$\tHOSTSTATE::$HOSTSTATE$\tHOSTSTATETYPE::$HOSTSTATETYPE$
```

### 2) Localizar `nagios.log`

Caminhos comuns:
- `/var/log/nagios/nagios.log`
- `/usr/local/nagios/var/nagios.log`

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `ORBIT_API_URL` | `http://localhost:3000` | URL base da API orbit-core |
| `ORBIT_API_KEY` | — | Chave de autenticação (`X-Api-Key`) |
| `NAGIOS_PERFDATA_FILE` | — | Caminho do arquivo perfdata |
| `NAGIOS_LOG_FILE` | — | Caminho do `nagios.log` |
| `NAGIOS_DEFAULT_NAMESPACE` | `nagios` | Namespace para métricas/eventos |
| `SHIPPER_BATCH_SIZE` | `500` | Registros por request (máx 5000) |
| `SHIPPER_STATE_DIR` | `/tmp/orbit-nagios-shipper` | Diretório de estado (byte-offset) |
| `SHIPPER_MODE` | `once` | `once` (cron) ou `watch` (daemon) |
| `SHIPPER_INTERVAL_SEC` | `60` | Intervalo no modo `watch` |
| `LOG_LEVEL` | `info` | Nível de log (pino) |

---

## Uso

### Modo cron (recomendado)

```bash
pnpm --filter @orbit/nagios-shipper build

# crontab -e
* * * * * ORBIT_API_URL=https://prod.example.com/orbit-core \
  ORBIT_API_KEY=<sua-chave> \
  NAGIOS_PERFDATA_FILE=/var/log/nagios/service-perfdata.dat \
  NAGIOS_LOG_FILE=/var/log/nagios/nagios.log \
  node /opt/orbit/packages/nagios-shipper/dist/index.js
```

### Modo watch (daemon)

```bash
ORBIT_API_URL=https://prod.example.com/orbit-core \
ORBIT_API_KEY=<sua-chave> \
NAGIOS_PERFDATA_FILE=/var/log/nagios/service-perfdata.dat \
NAGIOS_LOG_FILE=/var/log/nagios/nagios.log \
SHIPPER_MODE=watch \
SHIPPER_INTERVAL_SEC=30 \
node dist/index.js
```

---

## Mapeamento de dados

### Perfdata → MetricPoint

| Campo Nagios | orbit-core |
|---|---|
| `$HOSTNAME$` | `asset_id = host:<hostname>` |
| perfdata label | `metric` (ex: `load1`) |
| `$SERVICEDESC$` | `dimensions.service` (ex: `CPU Load`) |
| — | `namespace = nagios` |

### Alerta HARD → Event

| Campo Nagios | orbit-core |
|---|---|
| `$HOSTNAME$` | `asset_id = host:<hostname>` |
| — | `kind = state_change` |
| — | `namespace = nagios` |
| `CRITICAL` / `DOWN` | `severity = critical` |
| `WARNING` | `severity = medium` |
| `UNKNOWN` | `severity = low` |
| outros | `severity = info` |

---

## Exemplos

### Linha de perfdata

```
DATATYPE::SERVICEPERFDATA	TIMET::1708700000	HOSTNAME::web01	SERVICEDESC::CPU Load	SERVICEPERFDATA::load1=0.5;5;10;0 load5=0.3;5;10;0	SERVICESTATE::OK	SERVICESTATETYPE::HARD
```

### Linha do `nagios.log`

```
[1708700100] SERVICE ALERT: web01;HTTP;CRITICAL;HARD;3;Connection refused
[1708700200] HOST ALERT: db01;DOWN;HARD;3;PING CRITICAL - Packet loss = 100%
```

---

## Alternativa Python

Para a maioria dos deployments o conector Python em `connectors/nagios/` é mais
simples de instalar (não precisa de Node no servidor Nagios).
Ver [connectors/nagios/INSTALL.md](../../connectors/nagios/INSTALL.md).
