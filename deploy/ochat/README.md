# ochat — OpenClaw Web Chat

Interface web de chat para o OpenClaw AI agent, com autenticação via Traefik basicauth.

## URL

`https://prod.nesecurity.com.br/ochat/`
Usuário: `admin` | Senha: ver `/opt/ochat/.env` no servidor

## Arquitetura

- **Backend**: Express + TypeScript (Node 22), porta 18800
- **Transporte**: `openclaw agent --session-id <uuid> --message <text> --json` via `child_process`
- **Deploy**: Docker Swarm service no stack `ochat`, rede `Portn8n`
- **Auth**: Traefik basicauth middleware (`ochat-auth`)
- **Rota**: `Host(prod.nesecurity.com.br) && PathPrefix(/ochat)`
- **Strip prefix**: middleware `ochat-strip` remove `/ochat` antes de chegar no Express

## Deploy inicial

```bash
# 1. Criar diretórios no servidor
ssh root@prod.nesecurity.com.br 'mkdir -p /opt/ochat/src /opt/ochat/dist'

# 2. Copiar arquivos
scp -r deploy/ochat/* root@prod.nesecurity.com.br:/opt/ochat/

# 3. Instalar dependências e compilar
ssh root@prod.nesecurity.com.br 'cd /opt/ochat && npm install && npx esbuild src/index.ts --bundle --platform=node --target=node22 --outfile=dist/index.js --external:express'

# 4. Gerar senha e guardar no .env
ssh root@prod.nesecurity.com.br '
  PASS="sua_senha_aqui"
  HASH=$(openssl passwd -apr1 "$PASS")
  python3 -c "
with open(\"/opt/ochat/.env\", \"w\") as f:
    f.write(f\"OCHAT_PASS={\"$PASS\"}\nOCHAT_HASH=$HASH\n\")
"'

# 5. Deployar
ssh root@prod.nesecurity.com.br '/opt/ochat/deploy.sh'
```

## Redeploy após mudanças

```bash
scp deploy/ochat/src/index.ts root@prod.nesecurity.com.br:/opt/ochat/src/
ssh root@prod.nesecurity.com.br '/opt/ochat/deploy.sh'
```

## Variáveis de ambiente do container

| Variável | Valor | Descrição |
|---|---|---|
| `PORT` | `18800` | Porta do Express |
| `BASE_PATH` | `/ochat` | Prefixo da rota (usado no frontend) |
| `OPENCLAW_BIN` | `node /usr/lib/node_modules/openclaw/openclaw.mjs` | Comando openclaw no container |
| `HOME` | `/root` | Home do openclaw (lê config de `/root/.openclaw`) |

## Volumes montados

| Host | Container | Modo |
|---|---|---|
| `/opt/ochat` | `/app` | ro |
| `/opt/ochat/node_modules` | `/app/node_modules` | ro |
| `/usr/lib/node_modules/openclaw` | `/usr/lib/node_modules/openclaw` | ro |
| `/root/.openclaw` | `/root/.openclaw` | rw |
