# Connectors

orbit-core ingere telemetria de múltiplas fontes via conectores determinísticos
(sem IA, seguros para cron). Todos enviam para a mesma API de ingestão.

## Visão geral

| Conector | Tipo | Dados | Namespace | Instalação |
|---|---|---|---|---|
| **Nagios** | Passivo (arquivo local) | Métricas (perfdata) + Eventos (HARD state changes) | `nagios` | [INSTALL.md](../connectors/nagios/INSTALL.md) |
| **Wazuh** | Passivo (arquivo local) | Alertas de segurança | `wazuh` | [INSTALL.md](../connectors/wazuh/INSTALL.md) |
| **Fortigate** | Via Wazuh (syslog) | Logs de firewall | `wazuh` / `kind=fortigate` | [INSTALL.md](../connectors/fortigate/INSTALL.md) |
| **n8n** | Ativo (polling REST API) + Error Trigger | Falhas e execuções travadas | `n8n` | [INSTALL.md](../connectors/n8n/INSTALL.md) |

---

## Nagios

Dois shippers Python, ambos rodando como cron no servidor Nagios.

```
Nagios → perfdata spool files    → ship_metrics.py → POST /api/v1/ingest/metrics
Nagios → write_hard_event.py     → neb-hard-events.jsonl
       → ship_events.py          → POST /api/v1/ingest/events
```

| Script | O que faz |
|---|---|
| `ship_metrics.py` | Lê perfdata tab-separated → MetricPoints |
| `ship_events.py` | Lê JSONL spool de mudanças de estado HARD → Events |
| `write_hard_event.py` | Global event handler do Nagios — produz o spool JSONL |

**Mapeamento de eventos:**

| Campo Nagios | orbit-core |
|---|---|
| `$HOSTNAME$` | `asset_id = host:<hostname>` |
| — | `namespace = nagios` |
| — | `kind = state_change` |
| state (host/service) | `severity` (DOWN→critical, WARNING→medium, etc.) |

> `write_hard_event.py` deve estar configurado como `global_service_event_handler`
> e `global_host_event_handler` no `nagios.cfg` — sem isso, nenhum evento é enviado.
> Apenas mudanças de estado **HARD** são capturadas.

Referências: [README](../connectors/nagios/README.md) · [INSTALL](../connectors/nagios/INSTALL.md)

---

## Wazuh

Conector passivo que lê `alerts.json` diretamente do disco.
**Deve rodar no mesmo servidor que o Wazuh Manager.**

```
Wazuh Manager → /var/ossec/logs/alerts/alerts.json → ship_events.py → POST /api/v1/ingest/events
```

**Mapeamento:**

| Campo Wazuh | orbit-core |
|---|---|
| `agent.name` | `asset_id = host:<name>` |
| — | `namespace = wazuh` |
| `rule.groups[0]` | `kind` |
| `rule.level` (0–15) | `severity` (info/low/medium/high/critical) |
| `rule.description` | `title` |
| `full_log` | `message` |

**Permissão de leitura:** `alerts.json` pertence ao grupo `wazuh` (0640).
O usuário do cron precisa estar no grupo: `usermod -aG wazuh <user>`.

**Modo alternativo — OpenSearch (`ship_events_opensearch.py`):**
Consulta o Wazuh Indexer via REST API. Pode rodar em qualquer servidor com acesso
de rede ao OpenSearch. Atenção: em muitos deployments o OpenSearch escuta apenas em
`127.0.0.1:9200` — verificar com `ss -tlnp | grep 9200` antes de usar este modo.

Referências: [README](../connectors/wazuh/README.md) · [INSTALL](../connectors/wazuh/INSTALL.md)

---

## Fortigate

Não tem conector próprio. Os logs chegam via pipeline Wazuh:

```
Fortigate → syslog UDP/TCP 514 → Wazuh Manager → ship_events.py → orbit-core
```

Os eventos chegam com `namespace=wazuh` e `kind=fortigate` — a UI do orbit-core
usa essa combinação para surfaceá-los como fonte distinta no live feed e filtros.

**Configuração no Fortigate (CLI):**

```
config log syslogd setting
    set status enable
    set server <IP_WAZUH_MANAGER>
    set port 514
    set facility local7
    set format default
end
```

**Requisito:** as regras nativas do Wazuh (`0270-fortigate_rules.xml`) devem estar
presentes. Verificar com `grep -r "fortigate" /var/ossec/ruleset/rules/ | head -3`.

O campo `kind=fortigate` é gerado porque `rule.groups[0] = "fortigate"` nessas regras.

Referências: [README](../connectors/fortigate/README.md) · [INSTALL](../connectors/fortigate/INSTALL.md)

---

## n8n

Dois modos complementares — recomenda-se usar ambos.

### Modo ativo — `ship_events.py` (polling REST API)

```
n8n REST API (/api/v1/executions?status=error)   → ship_events.py → POST /api/v1/ingest/events
n8n REST API (/api/v1/executions?status=running) → ship_events.py → POST /api/v1/ingest/events
```

Roda como cron a cada minuto em qualquer servidor com acesso de rede ao n8n e ao orbit-core.
Captura **todas** as falhas da instância + execuções travadas (> `STUCK_AFTER_MINUTES`).

| Evento | kind | severity |
|---|---|---|
| Workflow `status=error` | `execution_error` | `high` |
| Execução running > N min | `execution_stuck` | `medium` |

`asset_id = workflow:<nome>` · `namespace = n8n` · `fingerprint = n8n:error:<id>`

**Requisito:** API key do n8n (`Settings → n8n API → Create an API key`).

### Modo plug-and-play — `orbit_error_reporter.json` (Error Trigger)

Workflow importável no n8n. Dispara em **tempo real** via Error Trigger quando um
workflow falha.

```
Workflow falha → Error Trigger → orbit_error_reporter → POST /api/v1/ingest/events
```

> **Atenção:** o Error Trigger **não dispara automaticamente** para todos os workflows.
> Cada workflow monitorado precisa ter o Orbit Error Reporter definido como seu
> *Error Workflow* em **⚙ Settings → Error Workflow**.

| Modo | Cobertura | Latência |
|---|---|---|
| `ship_events.py` (polling) | Todos os workflows | ≤ 1 min |
| Error Trigger | Só workflows configurados | Tempo real (< 1s) |
| `ship_events.py` (stuck) | Todos em `status=running` | ≤ 1 min |

Referências: [README](../connectors/n8n/README.md) · [INSTALL](../connectors/n8n/INSTALL.md)

---

## Desenvolvendo um novo conector

Padrões a seguir:

1. **Determinístico / sem IA** — seguro para rodar via cron
2. **State file com fcntl.flock** — cursor de byte-offset (arquivos locais) ou ISO timestamp (APIs)
3. **Batch ingest** — `POST /api/v1/ingest/events` com array `{"events": [...]}`
4. **Fingerprint** — garante deduplicação no orbit-core
5. **BasicAuth via arquivo** — `ORBIT_BASIC_FILE` em vez de senha em variável de ambiente

Campos obrigatórios de um evento:

```json
{
  "ts":          "2026-02-24T12:00:00Z",
  "asset_id":    "host:meuservidor",
  "namespace":   "meu-conector",
  "kind":        "tipo-do-evento",
  "severity":    "high",
  "title":       "Descrição curta",
  "message":     "Detalhes completos",
  "fingerprint": "meu-conector:evento:id-unico"
}
```

Ver `connectors/nagios/ship_events.py` como referência de implementação.
