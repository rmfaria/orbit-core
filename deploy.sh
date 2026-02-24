#!/usr/bin/env bash
set -euo pipefail

REPO=/root/.openclaw/workspace/orbit-core
PG_LOCAL="postgres://postgres:postgres@127.0.0.1:5432/orbit"
DOCKER_PG_CONTAINER=$(docker ps -qf name=openclaw_orbitcore_pg 2>/dev/null || true)
DOCKER_SERVICE="openclaw_orbitcore_api"

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%H:%M:%S')] ✓ $*"; }
fail() { echo "[$(date '+%H:%M:%S')] ✗ $*" >&2; exit 1; }

cd "$REPO"

# ── 1. Pull ──────────────────────────────────────────────────────────────────
log "git pull..."
git pull || fail "git pull falhou"
ok "código atualizado → $(git log --oneline -1)"

# ── 2. Build ─────────────────────────────────────────────────────────────────
log "build API..."
pnpm --filter @orbit/core-contracts build && pnpm --filter @orbit/api build && pnpm --filter @orbit/ui build || fail "build falhou"
ok "build concluído"

# ── 3. Migrations ────────────────────────────────────────────────────────────
MIGRATIONS_DIR="$REPO/packages/storage-pg/migrations"

log "aplicando migrations no Postgres local..."
for f in "$MIGRATIONS_DIR"/*.sql; do
  psql "$PG_LOCAL" -f "$f" -q 2>&1 | grep -v "^$" | grep -v "^NOTICE" || true
done
ok "migrations locais OK"

if [ -n "$DOCKER_PG_CONTAINER" ]; then
  log "aplicando migrations no Postgres Docker..."
  for f in "$MIGRATIONS_DIR"/*.sql; do
    docker exec -i "$DOCKER_PG_CONTAINER" psql -U postgres -d orbit -q \
      < "$f" 2>&1 | grep -v "^$" | grep -v "^NOTICE" || true
  done
  ok "migrations Docker OK"
else
  log "container Docker PG não encontrado — pulando"
fi

# ── 4. Restart systemd ───────────────────────────────────────────────────────
log "reiniciando orbit-core-api.service..."
systemctl restart orbit-core-api.service
sleep 2
systemctl is-active orbit-core-api.service > /dev/null || fail "serviço não subiu"
ok "systemd OK"

# ── 5. Restart Docker Swarm service ─────────────────────────────────────────
if docker service ls --format '{{.Name}}' 2>/dev/null | grep -q "^${DOCKER_SERVICE}$"; then
  log "atualizando Docker service ${DOCKER_SERVICE}..."
  docker service update --force "$DOCKER_SERVICE" --detach > /dev/null
  ok "Docker service atualizado (rodando em background)"
else
  log "Docker service ${DOCKER_SERVICE} não encontrado — pulando"
fi

# ── 6. Health check ──────────────────────────────────────────────────────────
log "health check..."
sleep 2
HEALTH=$(curl -sf http://localhost:3000/api/v1/health 2>/dev/null) || fail "health check falhou"
DB=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('db','?'))")
ok "API respondendo — db=${DB}"

echo ""
echo "========================================"
echo "  Deploy concluído com sucesso!"
echo "  Commit: $(git log --oneline -1)"
echo "========================================"
