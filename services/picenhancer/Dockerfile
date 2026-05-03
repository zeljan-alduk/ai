# services/picenhancer/Dockerfile
#
# Container image for the picenhancer Hono server (the live runtime
# behind ai.aldo.tech/live/picenhancer). Wraps the upstream
# realesrgan-ncnn-vulkan binary; the Next.js web app at /live/picenhancer
# proxies multipart POST + SSE responses through to this container via
# the PIXMEND_BACKEND_URL env on aldo-web.
#
# GPU situation: realesrgan-ncnn-vulkan needs a Vulkan loader. On a
# typical CPU-only VPS we install Mesa's `mesa-vulkan-drivers` which
# ships llvmpipe — a software Vulkan implementation. That keeps the
# stack working on hosts without a GPU at the cost of 5–15× slowdown
# vs. Apple Silicon Metal. When the host gains a real GPU the same
# image picks it up automatically (libvulkan1 enumerates real devices
# first).
#
# Build context = repo root (set by docker-compose `build.context`).
# Dockerfile path is therefore `services/picenhancer/Dockerfile`.

FROM node:22-bookworm-slim

# OS deps:
#   ca-certificates / curl / unzip — fetch the binary
#   libgomp1                       — OpenMP runtime needed by ncnn
#   libvulkan1                     — Vulkan loader
#   mesa-vulkan-drivers            — llvmpipe (software Vulkan) fallback
#   imagemagick                    — `identify` for image dimensions
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip \
      libgomp1 libvulkan1 mesa-vulkan-drivers \
      imagemagick \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/picenhancer

# Pin the upstream realesrgan-ncnn-vulkan release. v0.2.5.0 is the
# latest tagged binary release. Override at build time with
# `--build-arg RESRGAN_URL=...` if a newer build is preferred.
ARG RESRGAN_URL=https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip

RUN mkdir -p bin \
 && curl -fsSL "${RESRGAN_URL}" -o /tmp/r.zip \
 && unzip -q /tmp/r.zip -d bin \
 && rm /tmp/r.zip \
 && chmod +x bin/realesrgan-ncnn-vulkan \
 && ls bin

# Hono server + UI shell (the UI is also reachable directly at the
# container port, mostly useful for ops smoke-testing — public traffic
# goes through the Next.js proxy at ai.aldo.tech/live/picenhancer).
COPY services/picenhancer/package.json ./
RUN npm install --omit=dev --no-fund --no-audit
COPY services/picenhancer/server.ts ./
COPY services/picenhancer/public ./public

ENV NODE_ENV=production \
    PIXMEND_ROOT=/opt/picenhancer \
    PIXMEND_BIN=/opt/picenhancer/bin/realesrgan-ncnn-vulkan \
    PIXMEND_MODELS=/opt/picenhancer/bin/models \
    PIXMEND_IN=/var/lib/picenhancer/in \
    PIXMEND_OUT=/var/lib/picenhancer/out \
    PIXMEND_PUB=/opt/picenhancer/public \
    PIXMEND_HOST=0.0.0.0 \
    PIXMEND_PORT=4000 \
    PIXMEND_DIMS_CMD=identify

# Persistent input/output directories. docker-compose can mount a named
# volume here to avoid losing in-flight uploads on container restart.
RUN mkdir -p /var/lib/picenhancer/in /var/lib/picenhancer/out

EXPOSE 4000

# tsx runs the TS entrypoint directly. The dependency closure for the
# server is small (hono + @hono/node-server + tsx), so the cold-start
# tax of skipping a build step is negligible compared to the model load.
CMD ["npx", "tsx", "server.ts"]
