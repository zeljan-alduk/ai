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
apt_install_if_missing openssl
apt_install_if_missing python3

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
# 1b. Detect a pre-existing edge proxy.
#
# If a docker-managed nginx already owns ports 80/443 (the slovenia-transit
# pattern: container name "transit-nginx", config dir mounted from
# /opt/slovenia-transit/nginx/conf.d, certbot via webroot volumes), we
# plug ai.aldo.tech into THAT nginx instead of running our own. This keeps
# the existing site untouched and avoids a port-80 fight.
#
# Strategy is detected → strategy is "external"; otherwise "system".
# Override with EDGE_STRATEGY=external|system if you want to force it.
# ---------------------------------------------------------------------
EDGE_STRATEGY="${EDGE_STRATEGY:-auto}"
EDGE_PROXY_CONTAINER=""
EDGE_PROXY_CONF_DIR=""
EDGE_PROXY_NETWORK=""
EDGE_PROXY_GATEWAY=""
EDGE_CERTBOT_ETC_VOL=""
EDGE_CERTBOT_VAR_VOL=""
EDGE_CERTBOT_WEBROOT_VOL=""

detect_edge_proxy() {
  # Find a container that owns 0.0.0.0:80 (the docker-proxy will be listed).
  local container_id
  container_id=$(docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' \
    | awk '/0\.0\.0\.0:80->/{print $1; exit}')
  [[ -n "$container_id" ]] || return 1
  EDGE_PROXY_CONTAINER=$(docker inspect "$container_id" --format '{{.Name}}' | sed 's|^/||')

  # Pull the conf.d host bind-mount.
  EDGE_PROXY_CONF_DIR=$(docker inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/etc/nginx/conf.d"}}{{.Source}}{{end}}{{end}}')
  [[ -n "$EDGE_PROXY_CONF_DIR" && -d "$EDGE_PROXY_CONF_DIR" ]] || return 1

  # Pull the docker network (first one wins; for slovenia-transit it's the only one).
  EDGE_PROXY_NETWORK=$(docker inspect "$container_id" \
    --format '{{range $k, $_ := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -n1)
  [[ -n "$EDGE_PROXY_NETWORK" ]] || return 1
  EDGE_PROXY_GATEWAY=$(docker network inspect "$EDGE_PROXY_NETWORK" \
    --format '{{(index .IPAM.Config 0).Gateway}}')
  [[ -n "$EDGE_PROXY_GATEWAY" ]] || return 1

  # Pull certbot volumes (look for the three standard mount points).
  EDGE_CERTBOT_ETC_VOL=$(docker inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/etc/letsencrypt"}}{{.Name}}{{end}}{{end}}')
  EDGE_CERTBOT_VAR_VOL=$(docker inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/var/lib/letsencrypt"}}{{.Name}}{{end}}{{end}}')
  EDGE_CERTBOT_WEBROOT_VOL=$(docker inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/var/www/certbot"}}{{.Name}}{{end}}{{end}}')
  [[ -n "$EDGE_CERTBOT_ETC_VOL" && -n "$EDGE_CERTBOT_WEBROOT_VOL" ]] || return 1

  return 0
}

if [[ "$EDGE_STRATEGY" == "system" ]]; then
  log "edge strategy: system (forced) — installing host nginx + certbot"
elif [[ "$EDGE_STRATEGY" == "external" ]] || detect_edge_proxy; then
  if [[ "$EDGE_STRATEGY" != "external" ]]; then
    EDGE_STRATEGY="external"
  fi
  log "edge strategy: external — plugging into '$EDGE_PROXY_CONTAINER'"
  log "  conf dir:        $EDGE_PROXY_CONF_DIR"
  log "  docker network:  $EDGE_PROXY_NETWORK (gateway $EDGE_PROXY_GATEWAY)"
  log "  certbot etc vol: $EDGE_CERTBOT_ETC_VOL"
  log "  webroot vol:     $EDGE_CERTBOT_WEBROOT_VOL"
else
  EDGE_STRATEGY="system"
  log "edge strategy: system — no docker edge proxy detected, installing host nginx"
fi

if [[ "$EDGE_STRATEGY" == "system" ]]; then
  apt_install_if_missing nginx
  apt_install_if_missing certbot
  apt_install_if_missing python3-certbot-nginx
  systemctl enable --now nginx
else
  # Defensive: if a previous run installed host nginx, make sure it's
  # not active — it would fight $EDGE_PROXY_CONTAINER for port 80.
  if systemctl list-unit-files nginx.service >/dev/null 2>&1; then
    if systemctl is-active --quiet nginx; then
      log "host nginx is running and would conflict with $EDGE_PROXY_CONTAINER — disabling"
      systemctl disable --now nginx
    fi
    # Clean up any stale vhost the system path left behind.
    rm -f /etc/nginx/sites-enabled/ai.aldo.tech /etc/nginx/sites-available/ai.aldo.tech
  fi
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

# Deploy-webhook bearer token. Hex (no base64 padding) so it pastes
# cleanly into Authorization headers.
if [[ ! -s "$APP_DIR/secrets/deploy_token" ]]; then
  openssl rand -hex 32 > "$APP_DIR/secrets/deploy_token"
  chmod 600 "$APP_DIR/secrets/deploy_token"
  log "    generated $APP_DIR/secrets/deploy_token"
fi

POSTGRES_PASSWORD=$(cat "$APP_DIR/secrets/postgres_password")
JWT_SECRET=$(cat "$APP_DIR/secrets/jwt_secret")
SECRETS_MASTER_KEY=$(cat "$APP_DIR/secrets/secrets_master_key")

# ---------------------------------------------------------------------
# 4. docker compose stack — delegate to scripts/vps-emit-compose.sh so
# the same template is used by both the bootstrap and webhook deploys.
# ---------------------------------------------------------------------
chmod +x "$APP_DIR/repo/scripts/vps-emit-compose.sh"
APP_DIR="$APP_DIR" \
APP_DOMAIN="$APP_DOMAIN" \
API_INTERNAL_PORT="$API_INTERNAL_PORT" \
WEB_INTERNAL_PORT="$WEB_INTERNAL_PORT" \
POSTGRES_INTERNAL_PORT="$POSTGRES_INTERNAL_PORT" \
EDGE_STRATEGY="$EDGE_STRATEGY" \
  bash "$APP_DIR/repo/scripts/vps-emit-compose.sh"

# ---------------------------------------------------------------------
# 5. Bring up the stack.
# ---------------------------------------------------------------------
log "==> docker compose up -d"
cd "$APP_DIR"
docker compose pull --quiet aldo-postgres aldo-web 2>/dev/null || true
docker compose up -d --build

# ---------------------------------------------------------------------
# 6. Reverse-proxy vhost. Two paths:
#
#    - external strategy: drop a conf-snippet into the docker edge
#      proxy's host-mounted conf.d/ and reload it.
#    - system strategy:   drop a vhost into /etc/nginx/sites-* and
#      reload host nginx.
#
# In the external case we do this in TWO passes: first an HTTP-only
# snippet that serves the ACME challenge so certbot can issue, then the
# full HTTP+HTTPS snippet once the cert is on disk.
# ---------------------------------------------------------------------
write_external_vhost_http_only() {
  cat > "$EDGE_PROXY_CONF_DIR/zzz-ai-aldo-tech.conf" <<NGINX
# managed-by: vps-bootstrap.sh
# ALDO AI — HTTP-only bootstrap vhost. Serves only the ACME challenge so
# certbot can issue. Replaced with the full HTTP+HTTPS vhost after issuance.

server {
  listen 80;
  listen [::]:80;
  server_name ${APP_DOMAIN};

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location / {
    return 503 "ai.aldo.tech: bootstrapping...\n";
  }
}
NGINX
}

write_external_vhost_full() {
  cat > "$EDGE_PROXY_CONF_DIR/zzz-ai-aldo-tech.conf" <<NGINX
# managed-by: vps-bootstrap.sh
# ALDO AI — served by the existing edge proxy ($EDGE_PROXY_CONTAINER).
# Containers aldo-api / aldo-web are attached to the edge docker network
# so we resolve them by name. The deploy webhook runs on the host (port
# 9999, 0.0.0.0) and is reached via the docker bridge gateway.

upstream aldo_api { server aldo-api:8080; keepalive 32; }
upstream aldo_web { server aldo-web:8080; keepalive 32; }
upstream aldo_admin { server ${EDGE_PROXY_GATEWAY}:9999; keepalive 8; }

server {
  listen 80;
  listen [::]:80;
  server_name ${APP_DOMAIN};

  location /.well-known/acme-challenge/ { root /var/www/certbot; }

  location / { return 301 https://\$host\$request_uri; }
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name ${APP_DOMAIN};

  ssl_certificate     /etc/letsencrypt/live/${APP_DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${APP_DOMAIN}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;
  ssl_prefer_server_ciphers on;
  ssl_session_cache shared:SSL_aldo:10m;
  ssl_session_timeout 10m;

  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;

  client_max_body_size 25m;

  location /api/ {
    proxy_pass http://aldo_api/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;             # SSE
    proxy_read_timeout 600s;
  }

  location = /openapi.json { proxy_pass http://aldo_api/openapi.json; proxy_set_header Host \$host; }
  location = /openapi.yaml { proxy_pass http://aldo_api/openapi.yaml; proxy_set_header Host \$host; }
  location = /health       { proxy_pass http://aldo_api/health;       proxy_set_header Host \$host; }

  # Documentation viewers live as Next.js pages under /api/* — must be
  # routed to aldo_web BEFORE the catch-all /api/ block above sends
  # them to aldo_api (which 401s every non-/v1 path).
  location = /api/docs  { proxy_pass http://aldo_web; proxy_http_version 1.1; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; }
  location = /api/redoc { proxy_pass http://aldo_web; proxy_http_version 1.1; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; }

  location /_admin/ {
    proxy_pass http://aldo_admin/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 600s;
    client_max_body_size 1m;
  }

  location /v1/ {
    proxy_pass http://aldo_api;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
    proxy_read_timeout 600s;
  }

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
}

reload_edge_proxy() {
  log "==> testing edge nginx config inside $EDGE_PROXY_CONTAINER"
  if ! docker exec "$EDGE_PROXY_CONTAINER" nginx -t; then
    err "edge nginx config invalid — aborting before reload"
  fi
  docker exec "$EDGE_PROXY_CONTAINER" nginx -s reload
  log "    reloaded $EDGE_PROXY_CONTAINER"
}

if [[ "$EDGE_STRATEGY" == "external" ]]; then
  log "==> writing HTTP-only vhost into $EDGE_PROXY_CONF_DIR (for ACME)"
  if [[ -f "$EDGE_PROXY_CONF_DIR/zzz-ai-aldo-tech.conf" ]] \
      && ! grep -q "# managed-by: vps-bootstrap.sh" "$EDGE_PROXY_CONF_DIR/zzz-ai-aldo-tech.conf"; then
    err "$EDGE_PROXY_CONF_DIR/zzz-ai-aldo-tech.conf exists and is not ours — refusing to overwrite"
  fi
  write_external_vhost_http_only
  reload_edge_proxy
else
  NGINX_SITE="/etc/nginx/sites-available/ai.aldo.tech"
  NGINX_LINK="/etc/nginx/sites-enabled/ai.aldo.tech"
  if [[ -f "$NGINX_SITE" ]] && ! grep -q "# managed-by: vps-bootstrap.sh" "$NGINX_SITE"; then
    err "nginx vhost $NGINX_SITE exists and was NOT created by this script — refusing to overwrite"
  fi
  cat > "$NGINX_SITE" <<NGINX
# managed-by: vps-bootstrap.sh
# ALDO AI — single vhost serving the web app + reverse-proxying the API.

upstream aldo_api { server 127.0.0.1:${API_INTERNAL_PORT}; keepalive 32; }
upstream aldo_web { server 127.0.0.1:${WEB_INTERNAL_PORT}; keepalive 32; }

server {
  listen 80;
  listen [::]:80;
  server_name ${APP_DOMAIN};

  location /.well-known/acme-challenge/ { root /var/www/html; }

  location /api/ {
    proxy_pass http://aldo_api/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
    proxy_read_timeout 600s;
  }

  location = /openapi.json { proxy_pass http://aldo_api/openapi.json; proxy_set_header Host \$host; }
  location = /openapi.yaml { proxy_pass http://aldo_api/openapi.yaml; proxy_set_header Host \$host; }
  location = /health       { proxy_pass http://aldo_api/health;       proxy_set_header Host \$host; }

  # Documentation viewers live as Next.js pages under /api/* — route
  # them to aldo_web BEFORE the catch-all /api/ block above sends
  # them to aldo_api (which 401s every non-/v1 path).
  location = /api/docs  { proxy_pass http://aldo_web; proxy_http_version 1.1; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; }
  location = /api/redoc { proxy_pass http://aldo_web; proxy_http_version 1.1; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; }

  location /_admin/ {
    proxy_pass http://127.0.0.1:9999/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 600s;
    client_max_body_size 1m;
  }

  location /v1/ {
    proxy_pass http://aldo_api;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
    proxy_read_timeout 600s;
  }

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
  if systemctl is-active --quiet nginx; then
    systemctl reload nginx
  else
    systemctl start nginx
  fi
fi

# ---------------------------------------------------------------------
# 6b. Deploy webhook — systemd-managed python service that fronts
#     scripts/vps-deploy.sh behind a bearer token. nginx already routes
#     /_admin/* to 127.0.0.1:9999.
# ---------------------------------------------------------------------
WEBHOOK_SRC="$APP_DIR/repo/scripts/vps-deploy-webhook.py"
WEBHOOK_DST="$APP_DIR/webhook/vps-deploy-webhook.py"
WEBHOOK_UNIT="/etc/systemd/system/aldo-deploy-webhook.service"

mkdir -p "$APP_DIR/webhook" "$APP_DIR/logs"
cp "$WEBHOOK_SRC" "$WEBHOOK_DST"
chmod +x "$APP_DIR/repo/scripts/vps-deploy.sh"

# In external-edge mode the docker proxy reaches us via the bridge
# gateway, so the webhook must listen on 0.0.0.0 (filtered by host
# firewall + bearer token). In system mode it stays on 127.0.0.1.
WEBHOOK_BIND_HOST="127.0.0.1"
if [[ "$EDGE_STRATEGY" == "external" ]]; then
  WEBHOOK_BIND_HOST="0.0.0.0"
fi

cat > "$WEBHOOK_UNIT" <<UNIT
[Unit]
Description=ALDO AI deploy webhook
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
Environment=APP_DIR=${APP_DIR}
Environment=API_INTERNAL_PORT=${API_INTERNAL_PORT}
Environment=WEBHOOK_HOST=${WEBHOOK_BIND_HOST}
ExecStart=/usr/bin/python3 ${WEBHOOK_DST}
Restart=on-failure
RestartSec=3
StandardOutput=append:${APP_DIR}/logs/webhook.log
StandardError=append:${APP_DIR}/logs/webhook.log

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now aldo-deploy-webhook.service
systemctl restart aldo-deploy-webhook.service

# ---------------------------------------------------------------------
# 7. Let's Encrypt.
#
# external strategy: run certbot in a one-off docker container against
# the edge proxy's existing certbot volumes (webroot challenge served
# by our bootstrap HTTP-only vhost).
#
# system strategy: certbot --nginx (HTTP-01) against host nginx.
# ---------------------------------------------------------------------
if [[ "$EDGE_STRATEGY" == "external" ]]; then
  if docker run --rm \
      -v "${EDGE_CERTBOT_ETC_VOL}:/etc/letsencrypt" \
      -v "${EDGE_CERTBOT_VAR_VOL}:/var/lib/letsencrypt" \
      -v "${EDGE_CERTBOT_WEBROOT_VOL}:/var/www/certbot" \
      certbot/certbot certificates 2>/dev/null \
      | grep -q "Domains: ${APP_DOMAIN}\b"; then
    log "cert for ${APP_DOMAIN} already present in $EDGE_CERTBOT_ETC_VOL — skipping certbot"
  else
    log "==> certbot certonly --webroot -d ${APP_DOMAIN} (via docker)"
    docker run --rm \
      -v "${EDGE_CERTBOT_ETC_VOL}:/etc/letsencrypt" \
      -v "${EDGE_CERTBOT_VAR_VOL}:/var/lib/letsencrypt" \
      -v "${EDGE_CERTBOT_WEBROOT_VOL}:/var/www/certbot" \
      certbot/certbot certonly \
        --webroot -w /var/www/certbot \
        --non-interactive --agree-tos -m "$LE_EMAIL" \
        -d "$APP_DOMAIN"
  fi

  log "==> swapping in full HTTP+HTTPS vhost"
  write_external_vhost_full
  reload_edge_proxy
else
  if [[ ! -d "/etc/letsencrypt/live/${APP_DOMAIN}" ]]; then
    log "==> certbot --nginx -d ${APP_DOMAIN}"
    certbot --nginx --non-interactive --agree-tos -m "$LE_EMAIL" -d "$APP_DOMAIN" --redirect
  else
    log "cert for ${APP_DOMAIN} already present — skipping certbot"
  fi
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

DEPLOY_TOKEN=$(cat "$APP_DIR/secrets/deploy_token")

log ""
log "✓ done."
log ""
log "  Live:    https://${APP_DOMAIN}"
log "  Spec:    https://${APP_DOMAIN}/openapi.json"
log "  Stack:   docker compose -f ${APP_DIR}/docker-compose.yml ps"
log "  Logs:    docker compose -f ${APP_DIR}/docker-compose.yml logs -f"
log "  Webhook: journalctl -u aldo-deploy-webhook -f"
log ""
log "  Deploy token (paste this to Claude in chat — keep it secret):"
log ""
echo "    $DEPLOY_TOKEN"
log ""
log "  Smoke the webhook:"
log "    curl -sS https://${APP_DOMAIN}/_admin/health"
log "    curl -sS -X POST -H 'Authorization: Bearer <token>' \\"
log "      -H 'Content-Type: application/json' -d '{\"branch\":\"claude/ai-agent-orchestrator-hAmzy\"}' \\"
log "      https://${APP_DOMAIN}/_admin/deploy"
log ""
log "  Edge strategy: $EDGE_STRATEGY"
if [[ "$EDGE_STRATEGY" == "external" ]]; then
  log "    via container: $EDGE_PROXY_CONTAINER"
  log "    vhost file:    $EDGE_PROXY_CONF_DIR/zzz-ai-aldo-tech.conf"
  log "    other vhosts in that conf.d (untouched):"
  ls "$EDGE_PROXY_CONF_DIR" 2>/dev/null | grep -v "^zzz-ai-aldo-tech\.conf\$" | sed 's/^/      /'
else
  log "    Existing host vhosts (untouched):"
  ls /etc/nginx/sites-enabled/ 2>/dev/null | grep -v "^ai\.aldo\.tech\$" | sed 's/^/      /'
fi
