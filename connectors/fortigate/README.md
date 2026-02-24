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

### Como o `kind=fortigate` é gerado

O conector Wazuh (`ship_events.py`) define o campo `kind` do evento orbit-core
a partir de `rule.groups[0]` no alerta Wazuh:

```
alerta.rule.groups = ["fortigate", "firewall"]  →  kind = "fortigate"
```

**Requisito:** as regras Wazuh que processam os syslogs do Fortigate devem ter
`fortigate` como **primeiro grupo** (`<group>fortigate,...</group>`).
As regras nativas do Wazuh já fazem isso. Se você usar regras customizadas,
certifique-se de incluir `fortigate` no início da lista de grupos.

Para confirmar que os eventos estão chegando com o grupo correto:

```bash
tail -f /var/ossec/logs/alerts/alerts.json | python3 -c "
import sys, json
for line in sys.stdin:
    a = json.loads(line)
    if 'fortigate' in (a.get('rule',{}).get('groups') or []):
        print(a['rule']['groups'], a['rule']['description'])
"
```

### Como o Fortigate aparece separado na UI orbit-core

Os eventos chegam com `namespace=wazuh` e `kind=fortigate`. A UI do orbit-core
usa a função `eventSource()` para surfaceá-los como uma fonte distinta — o pill
**fortigate** no live feed e a opção de filtro na aba Eventos mostram apenas
esses eventos, mesmo que estejam misturados com outros alertas Wazuh no banco.

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
# Listar eventos Fortigate no orbit-core (filtro por kind=fortigate)
# Nota: namespace=wazuh é correto — Fortigate chega via pipeline Wazuh.
curl -s -H "X-Api-Key: <sua-chave>" \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "query":{
      "kind":"events",
      "namespace":"wazuh",
      "kinds":["fortigate"],
      "from":"'"$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)"'",
      "to":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "limit":20
    }
  }'
```

O filtro `"kinds": ["fortigate"]` seleciona apenas eventos com `kind=fortigate`.
Alternativamente, use o pill **fortigate** no live feed da UI.

## Notas

- Eventos Fortigate são ingeridos pelo conector Wazuh passivo (`ship_events.py`)
- O cron roda a cada minuto no servidor Wazuh Manager (`/etc/cron.d/orbit-wazuh`)
- Não é necessário conector separado enquanto o Wazuh Manager receber os syslogs
