# Multi-stage build for the @aldo-ai/api Hono server.
# Built and pushed to ghcr.io by .github/workflows/deploy-api.yml on tag.
# Uses buildkit's default frontend (no `# syntax=` pin) for portability.
#
# Base image pulled from AWS Public ECR which mirrors Docker Hub Library
# images. Avoids the Docker Hub auth-endpoint flakiness during builds.
#
# Runtime strategy: workspace packages publish `.ts` source (the
# package.json `main` fields point at `./src/index.ts`). Rather than
# compiling each platform/* package to `dist/` and rewriting `main`,
# we run the API under `tsx` so Node can resolve TypeScript imports
# at runtime. tsx is therefore a *runtime* dependency in apps/api.

# ---- 1. Install runtime deps + sources for the api workspace ----
FROM public.ecr.aws/docker/library/node:22-alpine AS deps
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Lockfile + workspace metadata first (best Docker layer caching).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY platform/api-contract/package.json platform/api-contract/
COPY platform/eval/package.json platform/eval/
COPY platform/gateway/package.json platform/gateway/
COPY platform/guards/package.json platform/guards/
COPY platform/registry/package.json platform/registry/
COPY platform/sandbox/package.json platform/sandbox/
COPY platform/secrets/package.json platform/secrets/
COPY platform/storage/package.json platform/storage/
COPY platform/types/package.json platform/types/

# `pnpm install` with `--prod=false` so the workspace symlinks resolve
# devDependencies needed by the API's transitive workspace deps, but we
# pass `--filter @aldo-ai/api...` so only the api workspace + its
# dependency closure is materialised.
RUN pnpm install --frozen-lockfile --prod=false --filter @aldo-ai/api...

# ---- 2. Bring in the actual TypeScript sources ----
FROM deps AS sources
WORKDIR /repo

COPY platform/types ./platform/types
COPY platform/api-contract ./platform/api-contract
COPY platform/registry ./platform/registry
COPY platform/storage ./platform/storage
# The /v1/models route reads platform/gateway/fixtures/models.yaml at
# a path resolved relative to apps/api/src/routes/models.ts. Bundle the
# fixtures (and the rest of the gateway package, harmless and small)
# into the image so /v1/models returns the registry instead of [].
COPY platform/gateway ./platform/gateway
# /v1/eval/* routes call into @aldo-ai/eval at runtime (suite parser,
# sweep runner, promotion gate). Wave 6.5 added the dependency to
# apps/api/package.json — the image must ship the package source too.
COPY platform/eval ./platform/eval
# Wave 7 adds isolation + prompt-injection guards + tenant secrets. The
# engine ToolHost calls into @aldo-ai/sandbox; the gateway middleware
# imports @aldo-ai/guards; /v1/secrets/* routes use @aldo-ai/secrets.
COPY platform/sandbox ./platform/sandbox
COPY platform/guards ./platform/guards
COPY platform/secrets ./platform/secrets
COPY apps/api ./apps/api
COPY tsconfig.base.json ./

# ---- 3. Runtime image ----
FROM public.ecr.aws/docker/library/node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# Copy the materialised workspace from the sources stage.
COPY --from=sources --chown=node:node /repo /repo

USER node
WORKDIR /repo/apps/api

EXPOSE 8080

# Pure-Node health check — no wget/curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# tsx is a runtime dep of @aldo-ai/api; the binary is at
# `node_modules/.bin/tsx` thanks to pnpm's hoisted-bin layout.
# Honours SIGTERM directly via Node — no tini needed.
CMD ["node_modules/.bin/tsx", "src/index.ts"]
