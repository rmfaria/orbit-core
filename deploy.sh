#!/usr/bin/env bash
# orbit-core deploy script
# Runs on the production server (ssh root@prod / local).
set -euo pipefail

REPO=/root/.openclaw/workspace/orbit-core
DATABASE_URL="${DATABASE_URL:-postgres://postgres:${POSTGRES_PASSWORD:-postgres}@127.0.0.1:5432/orbit}"
API_SERVICE="openclaw_orbitcore_api"
UI_SERVICE="openclaw_orbitcore_ui"
API_PORT="${PORT:-3000}"

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%H:%M:%S')] ✓ $*"; }
fail() { echo "[$(date '+%H:%M:%S')] ✗ $*" >&2; exit 1; }

cd "$REPO"

# ── 1. Pull ──────────────────────────────────────────────────────────────────
log "git pull..."
git pull || fail "git pull falhou"
ok "código atualizado → $(git log --oneline -1)"

# ── 2. Build ─────────────────────────────────────────────────────────────────
log "build..."
pnpm --filter @orbit/core-contracts build \
  && pnpm --filter @orbit/storage-pg    build \
  && pnpm --filter @orbit/api           build \
  && pnpm --filter @orbit/ui            build \
  || fail "build falhou"
ok "build concluído"

# ── 3. Migrations ─────────────────────────────────────────────────────────────
# Uses the Node.js migration runner (packages/storage-pg/dist/migrate.js) which
# tracks applied migrations in _orbit_migrations — idempotent and transactional.
# Only runs files not yet recorded; never re-runs completed migrations.
log "aplicando migrations..."
(cd "$REPO/packages/storage-pg" && DATABASE_URL="$DATABASE_URL" node ./dist/migrate.js) \
  || fail "migrations falharam"
ok "migrations OK"

# ── 4. Restart systemd service ────────────────────────────────────────────────
log "reiniciando orbit-core-api.service..."
systemctl restart orbit-core-api.service
sleep 2
systemctl is-active orbit-core-api.service > /dev/null || fail "serviço systemd não subiu"
ok "systemd OK"

# ── 5. Update Docker Swarm services ──────────────────────────────────────────
# --detach=true sends the update and returns immediately; convergence is async.
for SVC in "$API_SERVICE" "$UI_SERVICE"; do
  if docker service ls --format '{{.Name}}' 2>/dev/null | grep -q "^${SVC}$"; then
    log "atualizando Docker service ${SVC}..."
    docker service update --force --detach=true "$SVC" > /dev/null
    ok "Docker service ${SVC} atualizado (convergindo em background)"
  else
    log "Docker service ${SVC} não encontrado — pulando"
  fi
done

# ── 6. Health check ───────────────────────────────────────────────────────────
log "health check (systemd port ${API_PORT})..."
sleep 2
HEALTH=$(curl -sf "http://localhost:${API_PORT}/api/v1/health" 2>/dev/null) \
  || fail "health check falhou — API não responde na porta ${API_PORT}"
DB=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('db','?'))")
GIT=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('build',{}).get('git','?'))")
ok "API respondendo — db=${DB} git=${GIT}"

echo ""
echo "========================================"
echo "  Deploy concluído!"
echo "  Commit: $(git log --oneline -1)"
echo "  Docker services convergindo em background."
echo "========================================"
