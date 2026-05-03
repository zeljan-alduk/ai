#!/usr/bin/env bash
# ALDO AI — pull-and-redeploy on the VPS.
#
# Invoked by the deploy webhook (scripts/vps-deploy-webhook.py) and
# safely runnable by hand:
#
#     sudo bash /opt/aldo-ai/repo/scripts/vps-deploy.sh [branch]
#
# Default branch is whatever's in $DEPLOY_BRANCH or, failing that, the
# branch the bootstrap pinned. The script:
#
#   1. git fetch + hard-checkout the requested branch (no local
#      modifications survive — this host is downstream of the repo).
#   2. docker compose up -d --build (rebuilds anything that changed).
#   3. waits for the API to report healthy on the internal port, fails
#      loudly if it doesn't come back.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/aldo-ai}"
DEFAULT_BRANCH="${DEPLOY_BRANCH:-claude/ai-agent-orchestrator-hAmzy}"
BRANCH="${1:-$DEFAULT_BRANCH}"
API_INTERNAL_PORT="${API_INTERNAL_PORT:-8081}"

log() { echo -e "\033[1;34m[deploy]\033[0m $*"; }

[[ -d "$APP_DIR/repo/.git" ]] || {
  echo "[deploy ERROR] $APP_DIR/repo is not a git checkout — run vps-bootstrap.sh first." >&2
  exit 1
}

log "branch: $BRANCH"

GIT_ENV=()
if [[ -f "$APP_DIR/secrets/github_deploy_key" ]]; then
  chmod 600 "$APP_DIR/secrets/github_deploy_key"
  GIT_ENV+=(GIT_SSH_COMMAND="ssh -i $APP_DIR/secrets/github_deploy_key -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes")
fi

log "==> git fetch + checkout"
env "${GIT_ENV[@]}" git -C "$APP_DIR/repo" fetch --depth 1 origin "$BRANCH"
git -C "$APP_DIR/repo" reset --hard FETCH_HEAD
git -C "$APP_DIR/repo" clean -fd

SHA=$(git -C "$APP_DIR/repo" rev-parse --short HEAD)
log "    HEAD now $SHA"

# Re-emit docker-compose.yml from the pulled source so compose-shape
# changes (e.g. switching aldo-web from runtime install to a Dockerfile
# build) ship via this webhook deploy without needing a full bootstrap
# rerun. The emit script is idempotent.
log "==> regenerating docker-compose.yml"
chmod +x "$APP_DIR/repo/scripts/vps-emit-compose.sh"
APP_DIR="$APP_DIR" bash "$APP_DIR/repo/scripts/vps-emit-compose.sh"

# Refresh the deploy webhook from the freshly pulled source so changes
# to vps-deploy-webhook.py (e.g. log-tail-on-failure responses) ship
# without needing a full bootstrap rerun. The webhook lives at
# $APP_DIR/webhook and is managed by systemd as `aldo-deploy-webhook`.
# We restart it asynchronously after a short delay so the CURRENT
# webhook process has time to return its HTTP response — restarting
# synchronously would kill the in-flight response and fail this deploy
# from the caller's perspective even on success.
WEBHOOK_SRC="$APP_DIR/repo/scripts/vps-deploy-webhook.py"
WEBHOOK_DST="$APP_DIR/webhook/vps-deploy-webhook.py"
if [[ -f "$WEBHOOK_DST" ]] && ! cmp -s "$WEBHOOK_SRC" "$WEBHOOK_DST"; then
  log "==> webhook script changed; refreshing + scheduling delayed restart"
  install -m 0755 "$WEBHOOK_SRC" "$WEBHOOK_DST"
  # `setsid` detaches from the deploy process tree so the restart
  # survives the deploy completing. nohup + & alone isn't enough on
  # some systemd configurations.
  setsid bash -c "sleep 30 && systemctl restart aldo-deploy-webhook" >/dev/null 2>&1 < /dev/null &
fi

log "==> docker compose up -d --build"
cd "$APP_DIR"
docker compose up -d --build

log "==> waiting for API on 127.0.0.1:${API_INTERNAL_PORT}/health"
for i in $(seq 1 60); do
  if curl -sS --max-time 3 "http://127.0.0.1:${API_INTERNAL_PORT}/health" | grep -q '"ok":true'; then
    log "    API healthy at $SHA"
    exit 0
  fi
  sleep 2
done

echo "[deploy ERROR] API did not become healthy at $SHA" >&2
docker compose -f "$APP_DIR/docker-compose.yml" ps
docker compose -f "$APP_DIR/docker-compose.yml" logs --tail=80 aldo-api || true
exit 1
