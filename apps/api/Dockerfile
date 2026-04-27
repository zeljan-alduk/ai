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
COPY platform/billing/package.json platform/billing/
COPY platform/cache/package.json platform/cache/
COPY platform/engine/package.json platform/engine/
COPY platform/eval/package.json platform/eval/
COPY platform/gateway/package.json platform/gateway/
COPY platform/guards/package.json platform/guards/
COPY platform/integrations/package.json platform/integrations/
COPY platform/local-discovery/package.json platform/local-discovery/
COPY platform/observability/package.json platform/observability/
COPY platform/openapi/package.json platform/openapi/
COPY platform/orchestrator/package.json platform/orchestrator/
# Wave-16D — distributed rate-limiter workspace.
COPY platform/rate-limit/package.json platform/rate-limit/
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
# Wave 14C: outbound integrations (Slack/GitHub/Discord/webhook). The
# /v1/integrations routes + the notification-sink dispatcher call into
# @aldo-ai/integrations; the package source must ride along with the
# image (same lesson family as wave-6.5 / wave-7 / wave-10).
COPY platform/integrations ./platform/integrations
# Wave 11: /v1/billing/* routes call into @aldo-ai/billing for the
# subscription store, checkout/portal/webhook helpers, and the
# trial-gate middleware. The package boots in placeholder mode when
# STRIPE_* env vars are unset; the source needs to ride along with the
# image either way (same lesson family as wave-6.5 / wave-7 / wave-10).
COPY platform/billing ./platform/billing
# Wave 16C: LLM-response cache. The /v1/cache/* routes + the
# CacheMiddleware wired into the gateway construction need the
# package source at runtime under tsx (same lesson family as
# wave-6.5 / wave-7 / wave-10).
COPY platform/cache ./platform/cache
# Wave 8: /v1/models calls @aldo-ai/local-discovery on each request to
# probe well-known local-LLM ports and merge results into the response.
COPY platform/local-discovery ./platform/local-discovery
# Wave 9: composite (multi-agent) supervisor runtime. The /v1/runs
# create-run path delegates to the engine, which delegates to the
# orchestrator when the spec carries a `composite` block. The engine
# package + observability primitives are needed too — both are
# transitive deps of @aldo-ai/orchestrator.
COPY platform/engine ./platform/engine
COPY platform/observability ./platform/observability
COPY platform/orchestrator ./platform/orchestrator
# Wave 16D: distributed rate-limit + per-tenant quotas + custom
# domains. The /v1/auth/* + /v1/runs + /v1/playground/run middlewares
# call into @aldo-ai/rate-limit on every request; the source must
# ride along under tsx for runtime resolution.
COPY platform/rate-limit ./platform/rate-limit
# Wave 15: the canonical OpenAPI 3.1 spec is materialised at runtime
# from the contract Zod schemas by @aldo-ai/openapi (used by the
# /openapi.json + /openapi.yaml routes).
COPY platform/openapi ./platform/openapi
# Wave 10: on boot, apps/api walks `agency/` and seeds the canonical
# `default` tenant's registry from the YAML specs. Without this COPY
# the seed is silently skipped and every new tenant who calls
# /v1/tenants/me/seed-default gets `{copied:0,skipped:0}`.
COPY agency ./agency
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
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# tsx is a runtime dep of @aldo-ai/api; the binary is at
# `node_modules/.bin/tsx` thanks to pnpm's hoisted-bin layout.
# Honours SIGTERM directly via Node — no tini needed.
CMD ["node_modules/.bin/tsx", "src/index.ts"]
