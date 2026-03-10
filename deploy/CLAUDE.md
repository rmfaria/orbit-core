# Deploy — Claude Code Instructions

## Overview
Production deployment on Docker Swarm with Traefik reverse proxy.

## Production (prod.nesecurity.com.br)
- Docker Swarm stack: `creds-reports-stack.yml` (on server)
- Service names: `creds_orbitcore_api`, `creds_orbitcore_ui`
- Traefik routes: `/orbit-core/api`, `/orbit-core/otlp`, `/orbit-core/metrics` → API; `/orbit-core/` → UI

## Deploy Sequence
```bash
ssh prod
cd /root/.openclaw/workspace
git pull
bash deploy.sh
docker service update --force creds_orbitcore_ui
docker service update --force creds_orbitcore_api
```
⚠️ `deploy.sh` looks for wrong service names — always run `docker service update --force` manually.

## Local Dev (docker-compose)
```bash
docker-compose up    # pg + migrate + api + ui
```

## Nginx Configs
- `nginx-standalone.conf` — local docker-compose (HTTPS, self-signed)
- `nginx-orbitcore-ui.conf` — production (cookie auth, hardcoded token)

## Cron Jobs
Located in `/etc/cron.d/` on prod server: nagios, wazuh, n8n, suricata shippers.
