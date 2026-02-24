# Fortigate Connector (orbit-core)

Integração via **Wazuh syslog forwarding** — o Fortigate envia syslogs para o Wazuh Manager,
que os processa e encaminha para o orbit-core como eventos normalizados.

## Fluxo de dados

```
Fortigate → syslog (UDP/TCP 514) → Wazuh Manager → orbit-core
```

Eventos chegam com:
- `namespace` = `wazuh`
- `kind`      = `fortigate`
- `severity`  mapeado do `level` da regra Wazuh

## Configuração no Fortigate

No CLI do Fortigate:

```
config log syslogd setting
    set status enable
    set server <IP_WAZUH_MANAGER>
    set port 514
    set facility local7
    set format default
end
```

## Configuração no Wazuh Manager

O Wazuh inclui regras nativas para Fortigate (grupo `fortigate`).
Nenhuma configuração adicional é necessária se as regras padrão estiverem ativas.

Para verificar:

```bash
grep -r "fortigate" /var/ossec/ruleset/rules/ | head -5
```

## Mapeamento de campos

| Campo Fortigate | Campo orbit-core |
|---|---|
| `devname`     | `attributes.devname` (via `full_log`) |
| `type`        | parte do `kind` (via `rule.groups`) |
| `action`      | `attributes.data.action` |
| `srcip`       | `attributes.data.srcip` |
| `dstip`       | `attributes.data.dstip` |
| `app`         | `attributes.data.app` |
| `msg`         | `title` |
| log completo  | `message` (full_log) |

## Verificação

```bash
# Listar eventos Fortigate no orbit-core
curl -s -u orbitadmin:PASS \
  -X POST https://prod.nesecurity.com.br/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "language":"orbitql",
    "query":{
      "kind":"events",
      "from":"2026-02-24T00:00:00Z",
      "to":"2026-02-25T00:00:00Z",
      "namespace":"wazuh",
      "limit":10
    }
  }'
```

## Notas

- Eventos Fortigate são ingeridos pelo conector Wazuh passivo (`ship_events.py`)
- O cron roda a cada minuto no servidor Wazuh Manager (`/etc/cron.d/orbit-wazuh`)
- Não é necessário conector separado enquanto o Wazuh Manager receber os syslogs
