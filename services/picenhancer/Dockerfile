# services/picenhancer/Dockerfile
#
# Container image for the picenhancer Hono server (the live runtime
# behind ai.aldo.tech/live/picenhancer). The Next.js web app at
# /live/picenhancer proxies multipart POST + SSE responses through to
# this container via the PIXMEND_BACKEND_URL env on aldo-web.
#
# Engine: ImageMagick by default (`convert -filter Lanczos -unsharp`).
# Sub-second on a CPU-only VPS, which is what we have. The Real-ESRGAN
# AI engine is opt-in via PIXMEND_ENGINE=realesrgan — useful on a Mac
# (Metal) or a real GPU host. Earlier revisions of this image bundled
# realesrgan-ncnn-vulkan + Mesa software Vulkan (llvmpipe), but on a
# CPU-only VPS the AI binary takes 40+s before its first progress tick
# and the upstream HTTP/2 proxy times out the SSE stream — not usable.
# Swap PIXMEND_ENGINE in compose if a GPU host appears.
#
# Build context = repo root (set by docker-compose `build.context`).
# Dockerfile path is therefore `services/picenhancer/Dockerfile`.

FROM node:22-bookworm-slim

# Just ca-certificates for HTTPS; sharp ships its own libvips prebuilt
# binary inside the npm package (linux-x64 / linux-arm64 / darwin-arm64
# all covered) so we don't need any system-level image libraries.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/picenhancer

# Hono server + UI shell (the UI is also reachable directly at the
# container port, mostly useful for ops smoke-testing — public traffic
# goes through the Next.js proxy at ai.aldo.tech/live/picenhancer).
COPY services/picenhancer/package.json ./
RUN npm install --omit=dev --no-fund --no-audit
COPY services/picenhancer/server.ts ./
COPY services/picenhancer/public ./public

ENV NODE_ENV=production \
    PIXMEND_ROOT=/opt/picenhancer \
    PIXMEND_IN=/var/lib/picenhancer/in \
    PIXMEND_OUT=/var/lib/picenhancer/out \
    PIXMEND_PUB=/opt/picenhancer/public \
    PIXMEND_HOST=0.0.0.0 \
    PIXMEND_PORT=4000 \
    PIXMEND_ENGINE=sharp

# Persistent input/output directories. docker-compose can mount a named
# volume here to avoid losing in-flight uploads on container restart.
RUN mkdir -p /var/lib/picenhancer/in /var/lib/picenhancer/out

EXPOSE 4000

# tsx runs the TS entrypoint directly. The dependency closure for the
# server is small (hono + @hono/node-server + tsx), so the cold-start
# tax of skipping a build step is negligible compared to ImageMagick's
# per-request work.
CMD ["npx", "tsx", "server.ts"]
