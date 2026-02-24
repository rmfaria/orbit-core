# Fortigate Connector — Installation Guide

O Fortigate não tem um conector próprio. A integração usa o pipeline existente do Wazuh:

```
Fortigate → syslog (UDP/TCP 514) → Wazuh Manager → ship_events.py → orbit-core
```

**Pré-requisito obrigatório:** o conector Wazuh (`connectors/wazuh/`) deve estar
instalado e funcionando antes de seguir este guia.

---

## 0) Pré-requisitos

- Wazuh Manager em execução e recebendo alertas
- Conector Wazuh instalado e enviando eventos ao orbit-core (`/etc/cron.d/orbit-wazuh`)
- Acesso CLI ao Fortigate (admin ou permissão de log)
- Conectividade UDP/TCP porta 514 do Fortigate ao Wazuh Manager

Verificar que o Wazuh já está integrado:

```bash
cat /var/lib/orbit-core/wazuh-events.state.json
# {"offset": <numero>}  →  conector ativo e avançando
```

---

## 1) Configurar o Fortigate para enviar syslog ao Wazuh Manager

No CLI do Fortigate (console serial, SSH ou GUI → CLI Console):

```
config log syslogd setting
    set status enable
    set server <IP_DO_WAZUH_MANAGER>
    set port 514
    set facility local7
    set format default
end
```

Substituir `<IP_DO_WAZUH_MANAGER>` pelo IP do servidor onde o Wazuh Manager está rodando.

### Verificar configuração aplicada

```
show log syslogd setting
```

Saída esperada:
```
config log syslogd setting
    set status enable
    set server "192.168.1.10"
    set port 514
    set facility local7
    set format default
end
```

### (Opcional) Filtrar quais logs enviar

Por padrão, todos os tipos de log são enviados. Para restringir:

```
config log syslogd filter
    set severity information
    set forward-traffic enable
    set local-traffic disable
    set multicast-traffic disable
    set sniffer-traffic disable
    set anomaly enable
    set voip disable
end
```

---

## 2) Verificar recepção no Wazuh Manager

Aguardar alguns segundos após aplicar a configuração e confirmar que os syslogs chegam:

```bash
# Monitorar alerts em tempo real no Wazuh Manager
tail -f /var/ossec/logs/alerts/alerts.json | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        a = json.loads(line)
        groups = a.get('rule', {}).get('groups') or []
        if 'fortigate' in groups:
            print('OK:', groups, '|', a['rule']['description'])
    except Exception:
        pass
"
```

Se não aparecer nada após 30 segundos com tráfego ativo no Fortigate, verificar:

```bash
# Confirmar que o Wazuh está escutando na porta 514
ss -ulnp | grep 514   # UDP
ss -tlnp | grep 514   # TCP

# Confirmar que as regras Fortigate estão presentes no Wazuh
grep -r "fortigate" /var/ossec/ruleset/rules/ | head -5
# Deve mostrar arquivos como: /var/ossec/ruleset/rules/0270-fortigate_rules.xml
```

---

## 3) Verificar que o Wazuh tem as regras nativas do Fortigate

O Wazuh inclui regras nativas no grupo `fortigate`. Confirmar:

```bash
ls /var/ossec/ruleset/rules/ | grep forti
# 0270-fortigate_rules.xml
```

Se o arquivo não existir (instalação customizada/antiga do Wazuh), baixar do repositório oficial:

```bash
# Verificar versão do Wazuh
/var/ossec/bin/wazuh-control info

# Regras estão em:
# https://github.com/wazuh/wazuh/blob/main/ruleset/rules/0270-fortigate_rules.xml
```

### Confirmar que `fortigate` é o primeiro grupo

Os eventos só chegam com `kind=fortigate` no orbit-core se `fortigate` for o
**primeiro grupo** da regra. Verificar nas regras:

```bash
grep -A3 '<rule id' /var/ossec/ruleset/rules/0270-fortigate_rules.xml | grep '<group>' | head -5
# Deve mostrar: <group>fortigate,...</group>
```

---

## 4) Verificar eventos no orbit-core

Após 1–2 minutos (tempo do cron do Wazuh), confirmar que eventos Fortigate chegam:

```bash
curl -s -u orbitadmin:SUA_SENHA \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "query":{
      "kind":"events",
      "namespace":"wazuh",
      "from":"'"$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-5M +%Y-%m-%dT%H:%M:%SZ)"'",
      "to":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "limit":10
    }
  }' | python3 -c "
import sys, json
data = json.load(sys.stdin)
rows = data.get('result', {}).get('rows', [])
forti = [r for r in rows if r.get('kind') == 'fortigate']
print(f'Total wazuh events: {len(rows)}')
print(f'Fortigate events: {len(forti)}')
for e in forti[:3]:
    print(f'  [{e[\"severity\"]}] {e[\"title\"]}')
"
```

---

## Troubleshooting

| Sintoma | Causa / Solução |
|---|---|
| Nenhum alerta Fortigate no `alerts.json` | Syslog não chegando ao Wazuh; verificar firewall entre Fortigate e Wazuh (porta 514 UDP/TCP) |
| Alertas chegam mas `kind` ≠ `fortigate` | Regras nativas do Wazuh ausentes ou `fortigate` não é o primeiro grupo; ver passo 3 |
| Tráfego visible no Wazuh mas não no orbit-core | Conector Wazuh não está rodando; verificar `/etc/cron.d/orbit-wazuh` e log `/var/log/orbit-core/wazuh_shipper.log` |
| `devname` não aparece no evento | Campo extraído do `full_log` por regex na UI; confirmar que o Fortigate está enviando `devname=` no log |
| Eventos aparecem como `namespace=wazuh` na API | Correto — o Fortigate chega via pipeline Wazuh; a UI do orbit-core distingue pelo `kind=fortigate` |
| Porta 514 recusada no Wazuh Manager | Wazuh Manager escuta em 514 por padrão para syslog; confirmar com `ss -ulnp | grep 514` |

### Testar conectividade syslog manualmente

Do servidor Wazuh Manager, simular um syslog do Fortigate:

```bash
# UDP (padrão Fortigate)
echo '<134>date=2026-02-24 time=12:00:00 devname="FGT01" devid="FGT60F0000000000" logid="0000000013" type="traffic" subtype="forward" level="notice" action="accept" srcip=10.0.0.1 dstip=8.8.8.8 proto=6 service="HTTPS" app="Google" msg="Connection Observed"' \
  | nc -u -w1 127.0.0.1 514
```

Verificar em `alerts.json` se um alerta Fortigate foi gerado:

```bash
tail -5 /var/ossec/logs/alerts/alerts.json | python3 -m json.tool 2>/dev/null | grep -A2 '"groups"'
```

---

## Notas

- Não é necessário nenhum script adicional — o conector Wazuh (`ship_events.py`) já processa os eventos Fortigate automaticamente
- O `devname` do Fortigate aparece no `full_log` do alerta e é extraído pela UI via regex `devname="([^"]+)"`
- Múltiplos Fortigates podem enviar para o mesmo Wazuh Manager — cada um identificado pelo `devname` no log
- Para aumentar o volume de logs capturados, ajustar o filtro syslog no Fortigate (passo 1, seção opcional)
