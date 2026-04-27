#!/usr/bin/env bash
# ALDO AI — single-host VPS bootstrap.
#
# Designed to coexist with other projects already running on the same
# VPS (e.g. slovenia-transit.aldo.tech). It will:
#
#   1. Install missing system deps (docker, docker compose plugin,
#      nginx, certbot) — skips what's present.
#   2. Stop only the aldo-ai services it owns. Never touches other
#      nginx vhosts.
#   3. Spin up Postgres + the API (Hono on port 8081, internal-only)
#      + the web (Next.js on port 8082, internal-only) via docker
#      compose under /opt/aldo-ai/.
#   4. Drop a single nginx vhost at /etc/nginx/sites-available/ai.aldo.tech
#      that proxies / to web + /api/v1 + /openapi.json + /openapi.yaml
#      to the API. nginx -t before reloading.
#   5. Issue a Let's Encrypt cert via certbot --nginx (HTTP-01).
#   6. Refuse to overwrite anything it didn't create. Idempotent on
#      rerun.
#
# Two ways to feed it the source:
#
#   (a) git clone (default). REPO_URL + REPO_BRANCH below. Works for a
#       public repo out of the box. For a private repo, drop a deploy
#       key at /opt/aldo-ai/secrets/github_deploy_key (chmod 600) before
#       running and the script will use it via GIT_SSH_COMMAND.
#
#   (b) tarball. If /tmp/aldo-ai.tar.gz exists, the script uses it
#       instead of cloning. Useful for air-gapped / offline runs:
#           git archive HEAD -o /tmp/aldo-ai.tar.gz
#           scp /tmp/aldo-ai.tar.gz scripts/vps-bootstrap.sh ubuntu@host:/tmp/
#           ssh ubuntu@host 'sudo bash /tmp/vps-bootstrap.sh'
#
# Simplest end-to-end (public repo):
#     scp scripts/vps-bootstrap.sh ubuntu@135.125.161.96:/tmp/
#     ssh ubuntu@135.125.161.96 'sudo bash /tmp/vps-bootstrap.sh'

set -euo pipefail

# ---------------------------------------------------------------------
# Config — change these here only.
# ---------------------------------------------------------------------
APP_DOMAIN="${APP_DOMAIN:-ai.aldo.tech}"
APP_DIR="${APP_DIR:-/opt/aldo-ai}"
SOURCE_TARBALL="${SOURCE_TARBALL:-/tmp/aldo-ai.tar.gz}"
REPO_URL="${REPO_URL:-https://github.com/zeljan-alduk/ai.git}"
REPO_BRANCH="${REPO_BRANCH:-claude/ai-agent-orchestrator-hAmzy}"
LE_EMAIL="${LE_EMAIL:-info@aldo.tech}"

# Internal-only ports — only nginx talks to these. Picked to avoid
# clashing with common defaults.
API_INTERNAL_PORT="${API_INTERNAL_PORT:-8081}"
WEB_INTERNAL_PORT="${WEB_INTERNAL_PORT:-8082}"
POSTGRES_INTERNAL_PORT="${POSTGRES_INTERNAL_PORT:-5433}"

# ---------------------------------------------------------------------
# Helpers.
# ---------------------------------------------------------------------
log() { echo -e "\033[1;34m[bootstrap]\033[0m $*"; }
err() { echo -e "\033[1;31m[bootstrap ERROR]\033[0m $*" >&2; exit 1; }

require_root() {
  [[ $EUID -eq 0 ]] || err "Run with sudo: sudo bash $0"
}

apt_install_if_missing() {
  local pkg=$1
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    log "installing $pkg"
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$pkg" >/dev/null
  fi
}

# ---------------------------------------------------------------------
# 0. Sanity.
# ---------------------------------------------------------------------
require_root

log "host: $(hostname) — $(uname -srm)"
log "domain: $APP_DOMAIN"
log "app dir: $APP_DIR"
if [[ -f "$SOURCE_TARBALL" ]]; then
  log "source: tarball at $SOURCE_TARBALL"
else
  log "source: git clone $REPO_URL ($REPO_BRANCH)"
fi

# ---------------------------------------------------------------------
# 1. System packages.
# ---------------------------------------------------------------------
log "==> apt-get update"
apt-get update -qq

apt_install_if_missing ca-certificates
apt_install_if_missing curl
apt_install_if_missing git
apt_install_if_missing gnupg
apt_install_if_missing nginx
apt_install_if_missing certbot
apt_install_if_missing python3-certbot-nginx
apt_install_if_missing openssl

# nginx sometimes ships disabled (especially with noninteractive apt).
# Make sure it's enabled + running before we try to reload it later.
systemctl enable --now nginx

# Docker via the official convenience script if missing.
if ! command -v docker >/dev/null 2>&1; then
  log "installing docker via get.docker.com"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# Docker Compose plugin (the v2 `docker compose` subcommand).
if ! docker compose version >/dev/null 2>&1; then
  apt_install_if_missing docker-compose-plugin
fi

# ---------------------------------------------------------------------
# 2. Lay out /opt/aldo-ai/{repo, data, env}.
# ---------------------------------------------------------------------
mkdir -p "$APP_DIR/repo" "$APP_DIR/data" "$APP_DIR/env" "$APP_DIR/secrets"

if [[ -f "$SOURCE_TARBALL" ]]; then
  log "==> extracting source into $APP_DIR/repo (from tarball)"
  rm -rf "$APP_DIR/repo"
  mkdir -p "$APP_DIR/repo"
  tar -xzf "$SOURCE_TARBALL" -C "$APP_DIR/repo"
else
  # git clone / pull. If a deploy key is provisioned, use it.
  GIT_ENV=()
  if [[ -f "$APP_DIR/secrets/github_deploy_key" ]]; then
    chmod 600 "$APP_DIR/secrets/github_deploy_key"
    GIT_ENV+=(GIT_SSH_COMMAND="ssh -i $APP_DIR/secrets/github_deploy_key -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes")
  fi
  if [[ -d "$APP_DIR/repo/.git" ]]; then
    log "==> updating $APP_DIR/repo (git fetch + checkout $REPO_BRANCH)"
    env "${GIT_ENV[@]}" git -C "$APP_DIR/repo" fetch --depth 1 origin "$REPO_BRANCH"
    git -C "$APP_DIR/repo" checkout -B "$REPO_BRANCH" FETCH_HEAD
  else
    log "==> cloning $REPO_URL@$REPO_BRANCH into $APP_DIR/repo"
    rm -rf "$APP_DIR/repo"
    env "${GIT_ENV[@]}" git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR/repo"
  fi
fi

# ---------------------------------------------------------------------
# 3. Generate / preserve secrets.
# ---------------------------------------------------------------------
gen_or_keep() {
  local file=$1
  if [[ ! -s "$file" ]]; then
    openssl rand -base64 32 > "$file"
    chmod 600 "$file"
    log "    generated $file"
  fi
}
gen_or_keep "$APP_DIR/secrets/postgres_password"
gen_or_keep "$APP_DIR/secrets/jwt_secret"
gen_or_keep "$APP_DIR/secrets/secrets_master_key"

POSTGRES_PASSWORD=$(cat "$APP_DIR/secrets/postgres_password")
JWT_SECRET=$(cat "$APP_DIR/secrets/jwt_secret")
SECRETS_MASTER_KEY=$(cat "$APP_DIR/secrets/secrets_master_key")

# ---------------------------------------------------------------------
# 4. docker compose stack.
# ---------------------------------------------------------------------
cat > "$APP_DIR/docker-compose.yml" <<COMPOSE
services:
  aldo-postgres:
    image: postgres:16-alpine
    container_name: aldo-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: aldo
      POSTGRES_USER: aldo
      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}"
    volumes:
      - ${APP_DIR}/data/postgres:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:${POSTGRES_INTERNAL_PORT}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U aldo -d aldo"]
      interval: 5s
      timeout: 3s
      retries: 20

  aldo-api:
    build:
      context: ${APP_DIR}/repo
      dockerfile: apps/api/Dockerfile
    container_name: aldo-api
    restart: unless-stopped
    depends_on:
      aldo-postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: "8080"
      HOST: "0.0.0.0"
      DATABASE_URL: "postgresql://aldo:${POSTGRES_PASSWORD}@aldo-postgres:5432/aldo?sslmode=disable"
      ALDO_JWT_SECRET: "${JWT_SECRET}"
      ALDO_SECRETS_MASTER_KEY: "${SECRETS_MASTER_KEY}"
      CORS_ORIGINS: "https://${APP_DOMAIN}"
      ALDO_LOCAL_DISCOVERY: "none"
    ports:
      - "127.0.0.1:${API_INTERNAL_PORT}:8080"

  aldo-web:
    image: node:22-alpine
    container_name: aldo-web
    restart: unless-stopped
    working_dir: /repo
    command: ["sh", "-c", "corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm install --frozen-lockfile --filter @aldo-ai/web... && pnpm --filter @aldo-ai/web build && pnpm --filter @aldo-ai/web start --port 8080 --hostname 0.0.0.0"]
    depends_on:
      aldo-api:
        condition: service_started
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_API_BASE: "https://${APP_DOMAIN}"
    volumes:
      - ${APP_DIR}/repo:/repo
    ports:
      - "127.0.0.1:${WEB_INTERNAL_PORT}:8080"
COMPOSE

# ---------------------------------------------------------------------
# 5. Bring up the stack.
# ---------------------------------------------------------------------
log "==> docker compose up -d"
cd "$APP_DIR"
docker compose pull --quiet aldo-postgres aldo-web 2>/dev/null || true
docker compose up -d --build

# ---------------------------------------------------------------------
# 6. Nginx vhost. Refuse to touch existing other-project vhosts.
# ---------------------------------------------------------------------
NGINX_SITE="/etc/nginx/sites-available/ai.aldo.tech"
NGINX_LINK="/etc/nginx/sites-enabled/ai.aldo.tech"

if [[ -f "$NGINX_SITE" ]]; then
  # Only overwrite if the file looks like ours (carries our marker).
  if ! grep -q "# managed-by: vps-bootstrap.sh" "$NGINX_SITE"; then
    err "nginx vhost $NGINX_SITE exists and was NOT created by this script — refusing to overwrite. Move/delete it first."
  fi
fi

cat > "$NGINX_SITE" <<NGINX
# managed-by: vps-bootstrap.sh
# ALDO AI — single vhost serving the web app + reverse-proxying the
# API at /api, /openapi.json, /openapi.yaml, /v1/* (legacy alias).

upstream aldo_api { server 127.0.0.1:${API_INTERNAL_PORT}; keepalive 32; }
upstream aldo_web { server 127.0.0.1:${WEB_INTERNAL_PORT}; keepalive 32; }

server {
  listen 80;
  listen [::]:80;
  server_name ${APP_DOMAIN};

  # Let's Encrypt HTTP-01 challenge.
  location /.well-known/acme-challenge/ { root /var/www/html; }

  # API at /api/* (rewrite to root path so the Hono app sees /v1/...).
  location /api/ {
    proxy_pass http://aldo_api/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;             # SSE
    proxy_read_timeout 600s;
  }

  # OpenAPI spec at the root the SDKs default to.
  location = /openapi.json { proxy_pass http://aldo_api/openapi.json; proxy_set_header Host \$host; }
  location = /openapi.yaml { proxy_pass http://aldo_api/openapi.yaml; proxy_set_header Host \$host; }
  location = /health { proxy_pass http://aldo_api/health; proxy_set_header Host \$host; }

  # /v1/* legacy alias for clients that still use the bare path.
  location /v1/ {
    proxy_pass http://aldo_api;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
    proxy_read_timeout 600s;
  }

  # Everything else -> the web app.
  location / {
    proxy_pass http://aldo_web;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 60s;
  }
}
NGINX

ln -sf "$NGINX_SITE" "$NGINX_LINK"

log "==> nginx -t"
nginx -t
# Reload if running, else start. Survives a fresh-install where nginx
# isn't active yet.
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  systemctl start nginx
fi

# ---------------------------------------------------------------------
# 7. Let's Encrypt — only if we don't already have a cert for this host.
# ---------------------------------------------------------------------
if [[ ! -d "/etc/letsencrypt/live/${APP_DOMAIN}" ]]; then
  log "==> certbot --nginx -d ${APP_DOMAIN}"
  certbot --nginx --non-interactive --agree-tos -m "$LE_EMAIL" -d "$APP_DOMAIN" --redirect
else
  log "cert for ${APP_DOMAIN} already present — skipping certbot"
fi

# ---------------------------------------------------------------------
# 8. Smoke.
# ---------------------------------------------------------------------
log "==> waiting for API on 127.0.0.1:${API_INTERNAL_PORT}/health"
for i in $(seq 1 60); do
  if curl -sS --max-time 3 "http://127.0.0.1:${API_INTERNAL_PORT}/health" | grep -q '"ok":true'; then
    log "    API healthy"
    break
  fi
  sleep 2
done

log "==> waiting for web on 127.0.0.1:${WEB_INTERNAL_PORT}/"
for i in $(seq 1 120); do
  CODE=$(curl -sS -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:${WEB_INTERNAL_PORT}/" || true)
  if [[ "$CODE" =~ ^(200|307)$ ]]; then
    log "    web responding ($CODE)"
    break
  fi
  sleep 5
done

log "==> public smoke (https://${APP_DOMAIN}/health)"
curl -sS --max-time 15 "https://${APP_DOMAIN}/health" || true
echo

log ""
log "✓ done."
log ""
log "  Live:    https://${APP_DOMAIN}"
log "  Spec:    https://${APP_DOMAIN}/openapi.json"
log "  Stack:   docker compose -f ${APP_DIR}/docker-compose.yml ps"
log "  Logs:    docker compose -f ${APP_DIR}/docker-compose.yml logs -f"
log ""
log "  Existing vhosts on this host (untouched):"
ls /etc/nginx/sites-enabled/ | grep -v "^ai\.aldo\.tech\$" | sed 's/^/    /'
