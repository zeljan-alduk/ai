# syntax=docker/dockerfile:1.7
# Multi-stage build for the @aldo-ai/api Hono server.
# Built and pushed to ghcr.io by .github/workflows/deploy-api.yml on tag.

# ---- 1. Install all workspace deps (cached) ----
FROM node:22-alpine AS deps
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy lockfile + workspace metadata only (maximises Docker layer cache).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY platform/api-contract/package.json platform/api-contract/
COPY platform/registry/package.json platform/registry/
COPY platform/storage/package.json platform/storage/
COPY platform/types/package.json platform/types/

RUN pnpm install --frozen-lockfile --filter @aldo-ai/api...

# ---- 2. Copy source + build ----
FROM deps AS build
WORKDIR /repo

COPY platform/types ./platform/types
COPY platform/api-contract ./platform/api-contract
COPY platform/registry ./platform/registry
COPY platform/storage ./platform/storage
COPY apps/api ./apps/api
COPY tsconfig.base.json ./

RUN pnpm --filter @aldo-ai/api build

# ---- 3. Runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

RUN apk add --no-cache tini && \
    addgroup -g 1001 aldo && \
    adduser -u 1001 -G aldo -s /bin/sh -D aldo

# Copy the built workspace.
COPY --from=build --chown=aldo:aldo /repo /repo

USER aldo
WORKDIR /repo/apps/api

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:${PORT:-8080}/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/index.js"]
