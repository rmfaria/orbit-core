# Wazuh Connector (orbit-core)

Two modes — choose based on your deployment:

| Mode | Script | When to use |
|---|---|---|
| **Passive** (file-based) | `ship_events.py` | orbit-core runs on same host as Wazuh Manager |
| **Active** (OpenSearch) | `ship_events_opensearch.py` | Wazuh Manager is on a different host |

Ships **Wazuh alerts** into orbit-core as normalized events.

## What it ships

- Reads `/var/ossec/logs/alerts/alerts.json` (JSONL — one alert per line)
- Converts each alert to an orbit-core `Event`
- Sends batches to `POST /api/v1/ingest/events`

## Requirements

- Python 3.10+
- `pip3 install requests`
- Read access to the Wazuh `alerts.json` file
- Network access to orbit-core API

### Onde o conector deve rodar

O conector passivo (`ship_events.py`) lê `/var/ossec/logs/alerts/alerts.json`
diretamente do disco — **deve rodar no mesmo servidor que o Wazuh Manager**.

### Permissão de leitura no `alerts.json`

O arquivo pertence ao grupo `wazuh` (modo 0640). O usuário que executa o cron
precisa estar nesse grupo:

```bash
usermod -aG wazuh <usuario-do-cron>
# Verificar:
id <usuario-do-cron>   # deve listar 'wazuh' nos grupos
ls -la /var/ossec/logs/alerts/alerts.json
# -rw-r----- 1 wazuh wazuh ...
```

Se o cron rodar como `root`, basta adicionar `root` ao grupo `wazuh`.

## Data mapping

| Wazuh field | orbit-core field |
|---|---|
| `timestamp` | `ts` |
| `agent.name` (or `agent.id`) | `asset_id` = `host:<name>` |
| — | `namespace` = `wazuh` |
| `rule.groups[0]` | `kind` |
| `rule.level` (0–15) | `severity` (see table below) |
| `rule.description` | `title` |
| `full_log` | `message` |
| `agent.id:rule.id:alert.id` | `fingerprint` |
| `rule.*`, `agent.*`, `data.*` | `attributes` |

### Como o campo `kind` é definido

O `kind` do evento orbit-core é mapeado de `rule.groups[0]` do alerta Wazuh:

```
rule.groups = ["syslog", "sudo"]      →  kind = "syslog"
rule.groups = ["fortigate", "ids"]    →  kind = "fortigate"
rule.groups = ["authentication_fail"] →  kind = "authentication_fail"
```

Isso significa que **eventos de Fortigate** (syslog → Wazuh → orbit-core) chegam
com `namespace=wazuh` e `kind=fortigate`. A UI do orbit-core usa essa combinação
para surfaceá-los como fonte distinta no live feed e no filtro de eventos.

**Severity mapping (rule.level):**

| Level | Severity |
|---|---|
| 0–3 | `info` |
| 4–6 | `low` |
| 7–10 | `medium` |
| 11–13 | `high` |
| 14–15 | `critical` |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ORBIT_API` | `http://127.0.0.1:3000` | orbit-core API base URL |
| `WAZUH_ALERTS_JSON` | `/var/ossec/logs/alerts/alerts.json` | Path to Wazuh alerts JSONL file |
| `STATE_PATH` | `/var/lib/orbit-core/wazuh-events.state.json` | File position state |
| `MAX_BYTES_PER_RUN` | `5242880` (5 MB) | Max bytes to read per cron run |
| `BATCH_SIZE` | `200` | Events per API request |
| `ORBIT_BASIC_USER` | — | BasicAuth username |
| `ORBIT_BASIC_PASS` | — | BasicAuth password (prefer `ORBIT_BASIC_FILE`) |
| `ORBIT_BASIC` | — | `user:pass` combined |
| `ORBIT_BASIC_FILE` | — | Path to file containing the password |

## Cron example

```cron
* * * * * root \
  ORBIT_API=https://prod.example.com/orbit-core \
  ORBIT_BASIC_USER=orbitadmin \
  ORBIT_BASIC_FILE=/etc/orbit-core/orbitadmin.pass \
  python3 /opt/orbit-core/connectors/wazuh/ship_events.py \
  >>/var/log/orbit-core/wazuh_shipper.log 2>&1
```

See `cron.example` for the full example.

## Verificação

```bash
# Confirmar que alertas estão chegando no orbit-core (namespace=wazuh)
curl -s -u orbitadmin:PASS \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "query":{
      "kind":"events",
      "namespace":"wazuh",
      "from":"'"$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)"'",
      "to":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "limit":5
    }
  }'

# Verificar state file e log do cron no servidor Wazuh Manager
cat /var/lib/orbit-core/wazuh-events.state.json
tail -20 /var/log/orbit-core/wazuh_shipper.log
```

## Notes

- Designed to be **deterministic / no-AI** — safe to run from cron.
- Tracks byte offset in a state file; detects log rotation automatically (offset > file size → reset to 0).
- O `alerts.json` é rotacionado diariamente pelo Wazuh; o state file persiste entre rotações via reset automático.
- Do not commit secrets — use `ORBIT_BASIC_FILE`.

---

## Active connector (`ship_events_opensearch.py`)

### Fluxo de dados

```
Wazuh Indexer (OpenSearch) /_search → ship_events_opensearch.py → orbit-core /api/v1/ingest/events
```

Consulta os índices `wazuh-alerts-4.x-*` via REST API usando paginação `search_after`.
Não lê arquivos locais — **pode rodar em qualquer servidor** com acesso de rede ao
OpenSearch e ao orbit-core.

### Requisito crítico: OpenSearch acessível remotamente

> **Atenção:** em muitos deployments Wazuh, o OpenSearch Indexer escuta apenas em
> `127.0.0.1:9200` (loopback). Nesse caso o conector ativo **não consegue conectar**
> a partir de outro servidor.
>
> Para verificar o bind address no servidor Wazuh Manager:
> ```bash
> ss -tlnp | grep 9200
> # Se mostrar [::ffff:127.0.0.1]:9200 → loopback apenas
> # Se mostrar 0.0.0.0:9200 → acessível remotamente
> ```
>
> Se o OpenSearch estiver em loopback, use o **conector passivo** (`ship_events.py`)
> rodando diretamente no Wazuh Manager.

### Onde deve rodar

Qualquer servidor com acesso de rede ao OpenSearch (`OPENSEARCH_URL`) e ao orbit-core.
Não é necessário estar no mesmo host que o Wazuh Manager.

### Como o state file funciona

O state file armazena um **cursor de timestamp ISO 8601** do último alerta visto:

```json
{"since": "2026-02-24T11:57:52.676976+00:00"}
```

A cada execução:
1. Consulta `@timestamp > since` em ordem crescente com `search_after` para paginar
2. Avança `since` para o `@timestamp` do último alerta processado
3. Se nenhum alerta novo, avança `since` por +1s para evitar re-consultar a mesma janela

Na primeira execução (sem state file), usa `LOOKBACK_MINUTES` como janela inicial.

### `fingerprint` e deduplicação

Usa o `_id` do documento OpenSearch como fingerprint — garante deduplicação exata
mesmo que o mesmo alerta seja processado em duas rodadas consecutivas.

### Filtrando ruído com `MIN_LEVEL`

Por padrão, todos os níveis são enviados (`MIN_LEVEL=0`). Em instâncias com alto
volume de alertas de baixa severidade, use `MIN_LEVEL` para reduzir o tráfego:

| `MIN_LEVEL` | O que chega no orbit-core |
|---|---|
| `0` | Tudo (info, low, medium, high, critical) |
| `4` | low+ (exclui info) |
| `7` | medium+ |
| `11` | high+ |
| `14` | critical apenas |

### Additional environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENSEARCH_URL` | — | OpenSearch base URL (required) |
| `OPENSEARCH_USER` | — | OpenSearch username |
| `OPENSEARCH_PASS` | — | OpenSearch password |
| `OPENSEARCH_VERIFY_TLS` | `true` | Set `false` for self-signed certs |
| `WAZUH_OS_INDEX_PATTERN` | `wazuh-alerts-4.x-*` | Index pattern |
| `MIN_LEVEL` | `0` | Minimum rule.level to ship (0=all, 5=low+, 10=high+) |
| `PAGE_SIZE` | `500` | Alerts per OpenSearch page |
| `MAX_EVENTS_PER_RUN` | `5000` | Cap per cron run |
| `LOOKBACK_MINUTES` | `60` | How far back on first run |
| `STATE_PATH` | `/var/lib/orbit-core/wazuh-opensearch-events.state.json` | Timestamp state |

### Verificação

```bash
# Testar conectividade com o OpenSearch
curl -s -u admin:PASS https://<OPENSEARCH_HOST>:9200/_cluster/health?pretty

# Verificar índices Wazuh disponíveis
curl -s -u admin:PASS "https://<OPENSEARCH_HOST>:9200/_cat/indices/wazuh-alerts-4.x-*?v"

# Verificar state file e log
cat /var/lib/orbit-core/wazuh-opensearch-events.state.json
tail -20 /var/log/orbit-core/wazuh_opensearch_shipper.log
```
