# Multi-stage Docker build for @aldo-ai/mcp-platform — HTTP/SSE
# transport. This is the artefact deployed at mcp.aldo.tech.
#
# The stdio transport is shipped as an npm package and runs in the
# user's local environment; this Dockerfile is only meaningful for
# the hosted HTTP endpoint.
#
# Build:
#   docker build -f mcp-servers/aldo-platform/Dockerfile -t aldo-mcp-http:dev .
# Run:
#   docker run --rm -p 3030:3030 \
#     -e ALDO_BASE_URL=https://ai.aldo.tech \
#     aldo-mcp-http:dev
#
# Auth: clients pass their ALDO API key per request via
#   `Authorization: Bearer <key>` — no key is baked into the image,
#   no key is read from the env. Multi-tenant safe.
#
# Base image pulled from AWS Public ECR (mirrors Docker Hub Library)
# for parity with apps/api/Dockerfile and to avoid Docker Hub
# auth-endpoint flakiness.

# ---- 1. Install workspace deps ----
FROM public.ecr.aws/docker/library/node:22-alpine AS deps
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Lockfile + workspace metadata first (best Docker layer caching).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY mcp-servers/aldo-platform/package.json mcp-servers/aldo-platform/

# `--prod=false` so devDependencies (tsx, typescript) materialise —
# we run from compiled `dist/` so we don't strictly need tsx at
# runtime, but pnpm needs them to resolve the workspace correctly
# during install. The `--filter @aldo-ai/mcp-platform...` keeps the
# image tight by only materialising this package + its deps.
RUN pnpm install --frozen-lockfile --prod=false --filter @aldo-ai/mcp-platform...

# ---- 2. Compile TypeScript to dist/ ----
FROM deps AS build
WORKDIR /repo

COPY tsconfig.base.json ./
COPY mcp-servers/aldo-platform ./mcp-servers/aldo-platform

WORKDIR /repo/mcp-servers/aldo-platform
RUN pnpm build

# ---- 3. Runtime image ----
FROM public.ecr.aws/docker/library/node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3030
ENV HOST=0.0.0.0

# Copy the built workspace from the build stage. We bring across
# `node_modules/` from the deps stage too — it's already pruned to
# the @aldo-ai/mcp-platform dependency closure thanks to the
# `--filter` above.
COPY --from=build --chown=node:node /repo /repo

USER node
WORKDIR /repo/mcp-servers/aldo-platform

EXPOSE 3030

# Pure-Node health check — no wget/curl needed in the image.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3030)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# `dist/server-http.js` is the HTTP entry. We could also call
# `dist/index.js --transport http` — both routes are wired — but
# pointing straight at `server-http.js` is one less indirection in
# the deploy.
CMD ["node", "dist/server-http.js"]
