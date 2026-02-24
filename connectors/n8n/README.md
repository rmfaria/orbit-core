# n8n Connector (orbit-core)

Dois modos — escolha conforme sua necessidade:

| Modo | Arquivo | Quando usar |
|---|---|---|
| **Plug-and-play** (Error Trigger) | `orbit_error_reporter.json` | Dispara em tempo real a cada falha de workflow |
| **Ativo** (polling via API) | `ship_events.py` | Cron a cada minuto; captura falhas + execuções travadas |

Ambos enviam para `POST /api/v1/ingest/events`.

## O que é monitorado

| Evento | kind | severity | Origem |
|---|---|---|---|
| Workflow com status=error | `execution_error` | `high` | Ambos |
| Execução rodando > N minutos | `execution_stuck` | `medium` | `ship_events.py` |

## Mapeamento de dados

| Campo n8n | Campo orbit-core |
|---|---|
| `stoppedAt` (ou now) | `ts` |
| `workflowData.name` | `asset_id` = `workflow:<name>` |
| — | `namespace` = `n8n` |
| — | `kind` = `execution_error` \| `execution_stuck` |
| — | `severity` = `high` (error) / `medium` (stuck) |
| nome + id da execução | `title` |
| mensagem de erro | `message` |
| `id` da execução | `fingerprint` = `n8n:error:<id>` |
| `id`, `workflowId`, `startedAt`, etc. | `attributes` |

## Requisitos

- Python 3.10+
- `pip3 install requests`
- n8n API key (Settings → n8n API → Create an API key)
- Acesso de rede ao orbit-core API

## Variáveis de ambiente (`ship_events.py`)

| Variável | Padrão | Descrição |
|---|---|---|
| `N8N_URL` | `http://localhost:5678` | URL base do n8n |
| `N8N_API_KEY` | — | API key do n8n (obrigatório) |
| `N8N_VERIFY_TLS` | `true` | `false` para certificados autoassinados |
| `STUCK_AFTER_MINUTES` | `30` | Minutos até considerar execução travada |
| `MAX_EXECUTIONS_PER_RUN` | `500` | Máximo de execuções com erro por rodada |
| `BATCH_SIZE` | `200` | Eventos por request ao orbit-core |
| `LOOKBACK_MINUTES` | `60` | Janela inicial na ausência de state file |
| `STATE_PATH` | `/var/lib/orbit-core/n8n-events.state.json` | Arquivo de estado |
| `ORBIT_API` | `http://127.0.0.1:3000` | URL base do orbit-core |
| `ORBIT_BASIC_USER` | — | Usuário BasicAuth |
| `ORBIT_BASIC_PASS` | — | Senha BasicAuth (prefira `ORBIT_BASIC_FILE`) |
| `ORBIT_BASIC` | — | `user:pass` combinado |
| `ORBIT_BASIC_FILE` | — | Caminho para arquivo contendo a senha |

## Cron example

```cron
* * * * * root \
  ORBIT_API=https://prod.example.com/orbit-core \
  ORBIT_BASIC_USER=orbitadmin \
  ORBIT_BASIC_FILE=/etc/orbit-core/orbitadmin.pass \
  N8N_URL=http://localhost:5678 \
  N8N_API_KEY=sua-api-key-aqui \
  STATE_PATH=/var/lib/orbit-core/n8n-events.state.json \
  python3 /opt/orbit-core/connectors/n8n/ship_events.py \
  >>/var/log/orbit-core/n8n_shipper.log 2>&1
```

Veja `cron.example` para o exemplo completo.

## Importando `orbit_error_reporter.json` (plug-and-play)

1. No n8n, acesse **Workflows → Import from File**
2. Selecione `orbit_error_reporter.json`
3. Abra o node **Build Orbit Event** (Code)
4. Edite as 3 linhas `TODO` no topo: `ORBIT_API_URL`, `ORBIT_BASIC_USER`, `ORBIT_BASIC_PASS`
5. Salve e **ative** o workflow
6. Anote o ID do workflow (aparece na URL: `/workflow/<ID>`)

### Configurando o Error Trigger por workflow

O Error Trigger **não dispara automaticamente** para todos os workflows da instância.
Cada workflow que você quiser monitorar precisa apontar explicitamente para o Orbit Error Reporter:

1. Abra o workflow que deseja monitorar
2. Clique em **⚙ Settings** (canto superior direito do editor)
3. No campo **Error Workflow**, selecione **Orbit Error Reporter**
4. Salve

A partir daí, toda falha daquele workflow dispara o Orbit Error Reporter em tempo real.

> **Dica:** Repita o passo acima para cada workflow crítico da instância.
> O conector ativo (`ship_events.py`) captura falhas de **todos** os workflows via polling,
> independentemente dessa configuração — use os dois modos para cobertura completa.

## Obtendo a API key do n8n

1. No n8n, vá em **Settings → n8n API**
2. Clique em **Create an API key**
3. Copie a key — ela só é exibida uma vez

## Notas

- O conector é **determinístico / sem IA** — seguro para rodar via cron.
- O state file rastreia o timestamp da última execução processada (ISO 8601).
- Execuções travadas disparam a cada rodada enquanto permanecerem rodando — o campo `fingerprint` permite deduplicação no orbit-core.
- Não commite segredos — use `ORBIT_BASIC_FILE` ou o campo de credenciais do n8n.
- O Error Trigger dispara **apenas** para workflows que tenham o Orbit Error Reporter definido como seu *Error Workflow* (ver seção acima). O conector ativo (`ship_events.py`) captura falhas de todos os workflows via polling.
