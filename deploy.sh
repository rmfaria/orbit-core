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
# Self-restart: if git pull updates deploy.sh itself, re-exec the new version
# so the rest of the deploy uses the fresh script, not bash's buffered copy.
log "git pull..."
_HASH_BEFORE=$(git rev-parse HEAD)
git pull || fail "git pull failed"
_HASH_AFTER=$(git rev-parse HEAD)
ok "code updated → $(git log --oneline -1)"

if [ "$_HASH_BEFORE" != "$_HASH_AFTER" ] && git diff --name-only "$_HASH_BEFORE" "$_HASH_AFTER" | grep -q '^deploy\.sh$'; then
  log "deploy.sh updated — re-executing new version..."
  exec bash "$0" "$@"
fi

# ── 2. Build ─────────────────────────────────────────────────────────────────
log "pnpm install..."
pnpm install --frozen-lockfile || fail "pnpm install failed"
ok "dependencies installed"

log "build..."
pnpm --filter @orbit/core-contracts build \
  && pnpm --filter @orbit/storage-pg    build \
  && pnpm --filter @orbit/api           build \
  && pnpm --filter @orbit/ui            build \
  || fail "build failed"
ok "build done"

# ── 3. Migrations ─────────────────────────────────────────────────────────────
# Uses the Node.js migration runner (packages/storage-pg/dist/migrate.js) which
# tracks applied migrations in _orbit_migrations — idempotent and transactional.
# Only runs files not yet recorded; never re-runs completed migrations.
log "applying migrations..."
(cd "$REPO/packages/storage-pg" && DATABASE_URL="$DATABASE_URL" node ./dist/migrate.js) \
  || fail "migrations failed"
ok "migrations OK"

# ── 4. Restart systemd service ────────────────────────────────────────────────
log "restarting orbit-core-api.service..."
systemctl restart orbit-core-api.service
sleep 2
systemctl is-active orbit-core-api.service > /dev/null || fail "systemd service did not start"
ok "systemd OK"

# ── 5. Update Docker Swarm services ──────────────────────────────────────────
# --detach=true sends the update and returns immediately; convergence is async.
for SVC in "$API_SERVICE" "$UI_SERVICE"; do
  if docker service ls --format '{{.Name}}' 2>/dev/null | grep -q "^${SVC}$"; then
    log "updating Docker service ${SVC}..."
    docker service update --force --detach=true "$SVC" > /dev/null
    ok "Docker service ${SVC} updated (converging in background)"
  else
    log "Docker service ${SVC} not found — skipping"
  fi
done

# ── 5b. Apply migrations to Docker Swarm DB ──────────────────────────────────
# The Docker API uses a separate PostgreSQL instance (orbitcore_pg overlay).
# Wait for the API container to be running, then run migrations inside it.
if docker service ls --format '{{.Name}}' 2>/dev/null | grep -q "^${API_SERVICE}$"; then
  log "waiting for Docker API container to start..."
  for _i in $(seq 1 12); do
    _CID=$(docker ps --filter "name=${API_SERVICE}" --format '{{.ID}}' 2>/dev/null | head -1)
    [ -n "$_CID" ] && break
    sleep 5
  done
  if [ -n "$_CID" ]; then
    log "applying migrations to Docker Swarm DB (container ${_CID:0:12})..."
    docker exec "$_CID" sh -c \
      'cd /app/packages/storage-pg && node ./dist/migrate.js' \
      && ok "Docker Swarm DB migrations done" \
      || log "WARN: Docker Swarm DB migrations failed — check manually"
  else
    log "WARN: Docker API container did not start in time — skipping Docker DB migration"
  fi
fi

# ── 6. Health check ───────────────────────────────────────────────────────────
log "health check (systemd port ${API_PORT})..."
sleep 2
HEALTH=$(curl -sf "http://localhost:${API_PORT}/api/v1/health" 2>/dev/null) \
  || fail "health check failed — API not responding on port ${API_PORT}"
DB=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('db','?'))")
GIT=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('build',{}).get('git','?'))")
ok "API responding — db=${DB} git=${GIT}"

echo ""
echo "========================================"
echo "  Deploy complete!"
echo "  Commit: $(git log --oneline -1)"
echo "  Docker services converging in background."
echo "========================================"
