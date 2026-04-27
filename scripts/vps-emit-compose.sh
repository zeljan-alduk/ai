#!/usr/bin/env bash
# ALDO AI — emit /opt/aldo-ai/docker-compose.yml from current state.
#
# Idempotent. Reads:
#   - $APP_DIR/secrets/postgres_password
#   - $APP_DIR/secrets/jwt_secret
#   - $APP_DIR/secrets/secrets_master_key
# Detects the edge proxy's docker network (the same way vps-bootstrap.sh
# does) and attaches aldo-api/aldo-web to it when one is found.
#
# Called by:
#   - vps-bootstrap.sh after writing/preserving secrets
#   - vps-deploy.sh on every deploy, so compose-shape changes ship via
#     the webhook without needing a bootstrap rerun
#
# Inputs (env, all have defaults):
#   APP_DIR, APP_DOMAIN, API_INTERNAL_PORT, WEB_INTERNAL_PORT,
#   POSTGRES_INTERNAL_PORT, EDGE_STRATEGY (auto|external|system)

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/aldo-ai}"
APP_DOMAIN="${APP_DOMAIN:-ai.aldo.tech}"
API_INTERNAL_PORT="${API_INTERNAL_PORT:-8081}"
WEB_INTERNAL_PORT="${WEB_INTERNAL_PORT:-8082}"
POSTGRES_INTERNAL_PORT="${POSTGRES_INTERNAL_PORT:-5433}"
EDGE_STRATEGY="${EDGE_STRATEGY:-auto}"

[[ -s "$APP_DIR/secrets/postgres_password"  ]] || { echo "missing $APP_DIR/secrets/postgres_password" >&2; exit 1; }
[[ -s "$APP_DIR/secrets/jwt_secret"         ]] || { echo "missing $APP_DIR/secrets/jwt_secret" >&2; exit 1; }
[[ -s "$APP_DIR/secrets/secrets_master_key" ]] || { echo "missing $APP_DIR/secrets/secrets_master_key" >&2; exit 1; }

POSTGRES_PASSWORD=$(cat "$APP_DIR/secrets/postgres_password")
JWT_SECRET=$(cat "$APP_DIR/secrets/jwt_secret")
SECRETS_MASTER_KEY=$(cat "$APP_DIR/secrets/secrets_master_key")

POSTGRES_PASSWORD_URL=$(printf '%s' "$POSTGRES_PASSWORD" \
  | python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read(),safe=''))")

# --- Detect edge proxy network ---------------------------------------
EDGE_PROXY_NETWORK=""
detect_external() {
  local container_id
  container_id=$(docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' \
    | awk '/0\.0\.0\.0:80->/{print $1; exit}' || true)
  [[ -n "$container_id" ]] || return 1
  EDGE_PROXY_NETWORK=$(docker inspect "$container_id" \
    --format '{{range $k, $_ := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -n1 || true)
  [[ -n "$EDGE_PROXY_NETWORK" ]] || return 1
  return 0
}

if [[ "$EDGE_STRATEGY" == "external" ]] || { [[ "$EDGE_STRATEGY" == "auto" ]] && detect_external; }; then
  EDGE_STRATEGY=external
elif [[ "$EDGE_STRATEGY" == "system" ]]; then
  : # forced system — don't probe
else
  EDGE_STRATEGY=system
fi

# --- Render compose snippets -----------------------------------------
COMPOSE_API_NETWORKS="      - aldo-internal"
COMPOSE_WEB_NETWORKS="      - aldo-internal"
COMPOSE_EXTERNAL_NETWORK_BLOCK=""
COMPOSE_API_PORTS="    ports:
      - \"127.0.0.1:${API_INTERNAL_PORT}:8080\""
COMPOSE_WEB_PORTS="    ports:
      - \"127.0.0.1:${WEB_INTERNAL_PORT}:8080\""

if [[ "$EDGE_STRATEGY" == "external" ]]; then
  COMPOSE_API_NETWORKS="      - aldo-internal
      - aldo-edge"
  COMPOSE_WEB_NETWORKS="      - aldo-internal
      - aldo-edge"
  COMPOSE_EXTERNAL_NETWORK_BLOCK="
  aldo-edge:
    name: ${EDGE_PROXY_NETWORK}
    external: true"
fi

cat > "$APP_DIR/docker-compose.yml" <<COMPOSE
# managed-by: scripts/vps-emit-compose.sh
# regenerated on every deploy; do not edit by hand
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
    networks:
      - aldo-internal
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
      DATABASE_URL: "postgresql://aldo:${POSTGRES_PASSWORD_URL}@aldo-postgres:5432/aldo?sslmode=disable"
      ALDO_JWT_SECRET: "${JWT_SECRET}"
      ALDO_SECRETS_MASTER_KEY: "${SECRETS_MASTER_KEY}"
      CORS_ORIGINS: "https://${APP_DOMAIN}"
      ALDO_LOCAL_DISCOVERY: "none"
${COMPOSE_API_PORTS}
    networks:
${COMPOSE_API_NETWORKS}

  aldo-web:
    build:
      context: ${APP_DIR}/repo
      dockerfile: apps/web/Dockerfile
    container_name: aldo-web
    restart: unless-stopped
    depends_on:
      aldo-api:
        condition: service_started
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_API_BASE: "https://${APP_DOMAIN}"
${COMPOSE_WEB_PORTS}
    networks:
${COMPOSE_WEB_NETWORKS}

networks:
  aldo-internal:
    driver: bridge${COMPOSE_EXTERNAL_NETWORK_BLOCK}
COMPOSE

echo "[emit-compose] wrote $APP_DIR/docker-compose.yml (edge=$EDGE_STRATEGY${EDGE_PROXY_NETWORK:+, network=$EDGE_PROXY_NETWORK})"
