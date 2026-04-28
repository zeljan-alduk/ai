# Multi-stage build for the @aldo-ai/web Next.js app.
#
# Same shape as apps/api/Dockerfile so the VPS bootstrap can build both
# from `docker compose up --build` instead of running `pnpm install` at
# container start (which kept fighting with the host-mounted volume).
#
# The web prebuild runs `tsx scripts/generate-api-docs.ts` and a search
# indexer — both need devDependencies (`tsx`). So we install with
# `--prod=false` and the build stage runs the prebuild explicitly.

# ---- 1. Install deps for the web workspace ----
FROM public.ecr.aws/docker/library/node:22-alpine AS deps
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Lockfile + workspace metadata first (best Docker layer caching).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
# @aldo-ai/web depends on @aldo-ai/api-contract via the workspace.
COPY platform/api-contract/package.json platform/api-contract/

# --prod=false so devDependencies (tsx, tailwind, postcss, types) land.
# --filter @aldo-ai/web... installs the focus package and its closure.
RUN pnpm install --frozen-lockfile --prod=false --filter @aldo-ai/web...

# ---- 2. Bring in the actual sources ----
FROM deps AS sources
WORKDIR /repo

COPY platform/api-contract ./platform/api-contract
COPY apps/web ./apps/web
COPY tsconfig.base.json ./

# The web prebuild's `generate-api-docs.ts` regex-scans the API route
# sources (apps/api/src/routes/*.ts) to enumerate endpoints. It does
# NOT execute them — it just reads the .ts source — so we copy only
# the routes directory, not the rest of @aldo-ai/api or its deps.
COPY apps/api/src/routes ./apps/api/src/routes

# ---- 3. Build (next build, which triggers prebuild via tsx) ----
FROM sources AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
# Build needs NODE_ENV=production so Next emits an optimised build.
ENV NODE_ENV=production
RUN pnpm --filter @aldo-ai/web build

# ---- 4. Runtime image ----
FROM public.ecr.aws/docker/library/node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# corepack so `pnpm start` resolves; cheap to include and keeps the CMD
# symmetric with how Next is invoked in dev.
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy the built workspace.
COPY --from=build --chown=node:node /repo /repo

USER node
WORKDIR /repo/apps/web

EXPOSE 8080

# Pure-Node health check — node:22-alpine has no curl/wget by default.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||8080)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["pnpm", "start", "--port", "8080", "--hostname", "0.0.0.0"]
