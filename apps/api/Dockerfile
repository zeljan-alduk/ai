# Multi-stage build for the @aldo-ai/api Hono server.
# Built and pushed to ghcr.io by .github/workflows/deploy-api.yml on tag.
# Uses buildkit's default frontend (no `# syntax=` pin) for portability.
#
# Base image pulled from AWS Public ECR which mirrors Docker Hub Library
# images. Avoids the Docker Hub auth-endpoint flakiness during builds.

# ---- 1. Install all workspace deps (cached) ----
FROM public.ecr.aws/docker/library/node:22-alpine AS deps
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
FROM public.ecr.aws/docker/library/node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# Use the `node` user that ships with the official image (UID 1000).
# No extra apk install; alpine network-cert issues are skipped.
COPY --from=build --chown=node:node /repo /repo

USER node
WORKDIR /repo/apps/api

EXPOSE 8080

# Pure-Node health check — no wget/curl required inside the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Hono on Node honours SIGTERM directly; no need for tini as PID 1.
CMD ["node", "dist/src/index.js"]
