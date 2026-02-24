# n8n Connector — Installation Guide

Este guia instala os dois modos do conector n8n para o orbit-core:

| Modo | O que instalar | Cobertura |
|---|---|---|
| **Ativo** (`ship_events.py`) | cron em qualquer servidor | Todas as falhas + execuções travadas via polling |
| **Plug-and-play** (`orbit_error_reporter.json`) | workflow dentro do n8n | Falhas em tempo real (por workflow configurado) |

> Recomendação: instale os dois para cobertura completa.

---

## 0) Pré-requisitos

- n8n em execução e acessível via HTTP/HTTPS
- Python **3.10+** no servidor que vai rodar o cron
- Acesso de rede do servidor do cron ao n8n (`/api/v1/executions`)
- Acesso de rede ao orbit-core API

### Instalar dependência Python

```bash
apt-get update && apt-get install -y python3 python3-pip
pip3 install requests
```

---

## 1) Obter a API key do n8n

1. No n8n, acesse **Settings → n8n API**
2. Clique em **Create an API key**
3. Copie a key — ela só é exibida uma vez

Salvar em arquivo (recomendado para não expor em cron):

```bash
mkdir -p /etc/orbit-core
chmod 0750 /etc/orbit-core
printf '%s' 'sua-n8n-api-key-aqui' > /etc/orbit-core/n8n.apikey
chmod 0600 /etc/orbit-core/n8n.apikey
```

> A API key é lida via `$(cat /etc/orbit-core/n8n.apikey)` no cron (ver passo 4).

---

## 2) Instalar os scripts do conector

```bash
mkdir -p /opt/orbit-core/connectors
cp -a ./connectors/n8n /opt/orbit-core/connectors/
chmod +x /opt/orbit-core/connectors/n8n/ship_events.py
```

Criar diretórios de estado e log:

```bash
mkdir -p /var/lib/orbit-core
mkdir -p /var/log/orbit-core
chown root:root /var/lib/orbit-core /var/log/orbit-core
chmod 0755 /var/lib/orbit-core /var/log/orbit-core
```

---

## 3) Configurar autenticação do orbit-core

**Recomendado — API Key:**

```bash
# Salvar a Orbit API Key em arquivo seguro
mkdir -p /etc/orbit-core
chmod 0750 /etc/orbit-core
printf '%s' 'SUA_ORBIT_API_KEY_AQUI' > /etc/orbit-core/orbit.key
chmod 0640 /etc/orbit-core/orbit.key
```

---

## 4) Configurar o cron (`ship_events.py`)

Criar `/etc/cron.d/orbit-n8n`:

```cron
* * * * * root \
  ORBIT_API=https://prod.example.com/orbit-core \
  ORBIT_API_KEY=$(cat /etc/orbit-core/orbit.key) \
  N8N_URL=https://seu-n8n.example.com \
  N8N_API_KEY=$(cat /etc/orbit-core/n8n.apikey) \
  N8N_VERIFY_TLS=true \
  STUCK_AFTER_MINUTES=30 \
  STATE_PATH=/var/lib/orbit-core/n8n-events.state.json \
  python3 /opt/orbit-core/connectors/n8n/ship_events.py \
  >>/var/log/orbit-core/n8n_shipper.log 2>&1
```

> **Nota:** a expansão `$(cat ...)` é interpretada pelo shell na criação do arquivo
> de cron, não em tempo de execução. Para evitar isso, use um script wrapper ou
> defina `N8N_API_KEY` diretamente no arquivo de cron (proteja com `chmod 0640`).

Alternativa mais segura — criar `/etc/cron.d/orbit-n8n` com a key inline e restringir:

```bash
chmod 0640 /etc/cron.d/orbit-n8n
chown root:root /etc/cron.d/orbit-n8n
```

Recarregar cron:

```bash
systemctl reload cron || true
```

---

## 5) Verificar o conector ativo

### Executar manualmente (one-shot)

```bash
ORBIT_API=https://prod.example.com/orbit-core \
ORBIT_API_KEY=$(cat /etc/orbit-core/orbit.key) \
N8N_URL=https://seu-n8n.example.com \
N8N_API_KEY=$(cat /etc/orbit-core/n8n.apikey) \
python3 /opt/orbit-core/connectors/n8n/ship_events.py
# Saída vazia + exit 0 = sem erros no n8n (comportamento esperado)
```

Verificar state file criado:

```bash
cat /var/lib/orbit-core/n8n-events.state.json
# {"since": "2026-02-24T11:57:52.676976+00:00"}
```

### Verificar eventos no orbit-core

```bash
curl -s -H "X-Api-Key: $(cat /etc/orbit-core/orbit.key)" \
  -X POST https://prod.example.com/orbit-core/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "query":{
      "kind":"events",
      "namespace":"n8n",
      "from":"'"$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)"'",
      "to":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "limit":5
    }
  }'
```

> Sem eventos = n8n sem falhas recentes. Normal.

---

## 6) Instalar o Error Trigger (plug-and-play)

### 6.1) Importar o workflow no n8n

Via API (recomendado — preenche as credenciais automaticamente):

```bash
python3 - << 'EOF'
import json, requests

N8N_KEY    = open('/etc/orbit-core/n8n.apikey').read().strip()
N8N_URL    = 'https://seu-n8n.example.com'
ORBIT_KEY  = open('/etc/orbit-core/orbit.key').read().strip()

with open('/opt/orbit-core/connectors/n8n/orbit_error_reporter.json') as f:
    wf = json.load(f)

# Preencher credenciais no Code node
code_node = next(n for n in wf['nodes'] if n['name'] == 'Build Orbit Event')
code_node['parameters']['jsCode'] = code_node['parameters']['jsCode'] \
    .replace("const ORBIT_API_KEY = '';   // TODO",
             f"const ORBIT_API_KEY = '{ORBIT_KEY}';")

wf.pop('active', None)
wf.pop('tags', None)

hdrs = {'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json'}
r = requests.post(f'{N8N_URL}/api/v1/workflows', json=wf, headers=hdrs, timeout=15)
wf_id = r.json()['id']
print(f'Workflow criado: {wf_id}')

r2 = requests.post(f'{N8N_URL}/api/v1/workflows/{wf_id}/activate', headers=hdrs, timeout=10)
print(f'Ativo: {r2.json().get("active")}')
print(f'Anote o ID: {wf_id}')
EOF
```

Ou via UI:
1. **Workflows → Import from File** → selecione `orbit_error_reporter.json`
2. Abra o node **Build Orbit Event** → edite `ORBIT_API_URL` e `ORBIT_API_KEY`
3. Salve e **ative** o workflow

### 6.2) Configurar por workflow monitorado

O Error Trigger **não dispara automaticamente** para todos os workflows.
Para cada workflow que deseja monitorar:

1. Abra o workflow no editor n8n
2. **⚙ Settings → Error Workflow → Orbit Error Reporter**
3. Salve

> O conector ativo (`ship_events.py`) captura falhas de **todos** os workflows via
> polling — use os dois modos para cobertura em tempo real + histórico completo.

---

## Troubleshooting

| Sintoma | Causa / Solução |
|---|---|
| `N8N_API_KEY is required` | Variável `N8N_API_KEY` não definida no cron |
| `401` do n8n | API key inválida ou expirada — gerar nova em Settings → n8n API |
| `401/403` do orbit-core | API Key incorreta; verificar `ORBIT_API_KEY` |
| Log vazio, state file não criado | Diretório `/var/log/orbit-core/` não existe; criar com `mkdir -p` |
| Error Trigger não dispara | Workflow não tem o Orbit Error Reporter como *Error Workflow* (passo 6.2) |
| `execution_error` com `asset_id: workflow:unknown` | Versão do n8n não expõe `workflow.name` no Error Trigger — o conector ativo usa `workflowData.name` e funciona corretamente |
| Execuções stuck não detectadas | Verificar `STUCK_AFTER_MINUTES` (padrão 30); a execução precisa estar em `status=running` |
| `SSL: CERTIFICATE_VERIFY_FAILED` | Certificado autoassinado no n8n; usar `N8N_VERIFY_TLS=false` |

---

## Security notes

- Não commite segredos — use `/etc/orbit-core/orbit.key` e `/etc/orbit-core/n8n.apikey`
- Proteja o cron file: `chmod 0640 /etc/cron.d/orbit-n8n`
- O conector só **lê** a API do n8n — nunca escreve nem modifica workflows
- Mantenha o orbit-core atrás de TLS + auth em produção
