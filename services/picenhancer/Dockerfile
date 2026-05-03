# services/picenhancer/Dockerfile
#
# Container image for the picenhancer Hono server (the live runtime
# behind ai.aldo.tech/live/picenhancer).
#
# Engine: `sharp` (libvips Lanczos-3 + perceptual sharpen) by default.
# Sub-second on a CPU-only VPS, ships fine without any GPU stack.
#
# AI-plus engine (Real-ESRGAN x4 ONNX + GFPGAN face restore) is the
# next iteration; held back from this image until the build pipeline is
# debugged on the VPS. The Hono server still understands aiplus +
# realesrgan engines via PIXMEND_ENGINE — they just need the
# corresponding tooling baked in.
#
# Build context = repo root (set by docker-compose `build.context`).

FROM node:22-bookworm-slim

# ca-certificates for HTTPS; sharp ships its own libvips prebuilt
# binary inside the npm package (linux-x64 / linux-arm64 / darwin-arm64
# all covered) so we don't need any system-level image libraries.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/picenhancer

COPY services/picenhancer/package.json ./
RUN npm install --omit=dev --no-fund --no-audit
COPY services/picenhancer/server.ts ./
COPY services/picenhancer/public ./public
# Python scripts ship with the image so a future `aiplus` engine can
# enable without a Dockerfile rebuild — just install Python + onnxruntime
# + the model weights.
COPY services/picenhancer/scripts ./scripts

ENV NODE_ENV=production \
    PIXMEND_ROOT=/opt/picenhancer \
    PIXMEND_IN=/var/lib/picenhancer/in \
    PIXMEND_OUT=/var/lib/picenhancer/out \
    PIXMEND_PUB=/opt/picenhancer/public \
    PIXMEND_HOST=0.0.0.0 \
    PIXMEND_PORT=4000 \
    PIXMEND_ENGINE=sharp

# Persistent input/output directories. docker-compose mounts a named
# volume here to keep in-flight uploads + outputs across restarts.
RUN mkdir -p /var/lib/picenhancer/in /var/lib/picenhancer/out

EXPOSE 4000

CMD ["npx", "tsx", "server.ts"]
