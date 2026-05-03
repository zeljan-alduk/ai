# services/picenhancer/Dockerfile
#
# Container image for the picenhancer Hono server (the live runtime
# behind ai.aldo.tech/live/picenhancer).
#
# Engine: `aiplus` by default — Real-ESRGAN x4 (generative SR) +
# GFPGAN v1.4 (face restoration on detected faces). Runs on CPU via
# PyTorch CPU. Slow per-request (3–15 s) but actually competitive with
# Topaz / Tenorshare-class output on faces. The Hono server spawns the
# Python script `scripts/enhance.py` once per request and forwards the
# NDJSON progress events as SSE to the page.
#
# `sharp` (libvips Lanczos-3) and `realesrgan` (ncnn-vulkan binary) are
# kept as opt-in alternatives via PIXMEND_ENGINE.
#
# Build context = repo root (set by docker-compose `build.context`).

FROM node:22-bookworm-slim

# OS deps:
#   ca-certificates / curl   — fetch model weights at build time
#   python3 / pip / venv     — host the AI pipeline
#   libgl1 / libglib2.0      — runtime deps for opencv-python-headless
#   libgomp1                 — OpenMP runtime that PyTorch links against
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl \
      python3 python3-pip python3-venv \
      libgl1 libglib2.0-0 libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/picenhancer

# --- Python deps ------------------------------------------------------
# Venv to comply with PEP 668 (Debian 12 protects system Python).
RUN python3 -m venv /opt/picenhancer/venv
ENV PATH="/opt/picenhancer/venv/bin:${PATH}"
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# torch CPU only. Pin to 2.0.1 + tv 0.15.2 — the last combo where
# torchvision still ships `transforms.functional_tensor`, which
# basicsr 1.4.2 imports. Newer torchvision removed it and breaks
# basicsr at import time. Pin avoids the runtime patch.
RUN pip install --no-cache-dir --verbose \
      --index-url https://download.pytorch.org/whl/cpu \
      "torch==2.0.1+cpu" "torchvision==0.15.2+cpu"

# Numerics + image I/O. numpy<2 because basicsr/realesrgan haven't
# adopted the numpy 2.0 ABI yet.
RUN pip install --no-cache-dir \
      "numpy<2" "Pillow>=10,<11" "opencv-python-headless"

# Real-ESRGAN + GFPGAN + their basicsr/facexlib deps. Last published
# versions; well-tested with torch 2.0.1.
RUN pip install --no-cache-dir \
      "basicsr==1.4.2" "facexlib==0.3.0" \
      "realesrgan==0.3.0" "gfpgan==1.3.8" \
      "tqdm" "lmdb" "yapf"

# --- Pre-download model weights --------------------------------------
# Bake into the image so the first request doesn't pay a 400 MB
# download tax. Both URLs are stable upstream releases.
RUN mkdir -p /opt/picenhancer/models \
 && curl -fsSL -o /opt/picenhancer/models/RealESRGAN_x4plus.pth \
      https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth \
 && curl -fsSL -o /opt/picenhancer/models/GFPGANv1.4.pth \
      https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth \
 && ls -la /opt/picenhancer/models

# Sanity: the libraries import cleanly. Catches a broken pip combo at
# build time rather than the first user request.
RUN python3 -c "from realesrgan import RealESRGANer; from gfpgan import GFPGANer; print('ok')"

# --- Hono server + UI shell + Python script --------------------------
COPY services/picenhancer/package.json ./
RUN npm install --omit=dev --no-fund --no-audit
COPY services/picenhancer/server.ts ./
COPY services/picenhancer/public ./public
COPY services/picenhancer/scripts ./scripts

ENV NODE_ENV=production \
    PIXMEND_ROOT=/opt/picenhancer \
    PIXMEND_IN=/var/lib/picenhancer/in \
    PIXMEND_OUT=/var/lib/picenhancer/out \
    PIXMEND_PUB=/opt/picenhancer/public \
    PIXMEND_HOST=0.0.0.0 \
    PIXMEND_PORT=4000 \
    PIXMEND_ENGINE=aiplus \
    PIXMEND_PYTHON=/opt/picenhancer/venv/bin/python3 \
    PIXMEND_AIPLUS_SCRIPT=/opt/picenhancer/scripts/enhance.py \
    PIXMEND_MODELS_DIR=/opt/picenhancer/models

# Persistent input/output directories. docker-compose mounts a named
# volume here to keep in-flight uploads + outputs across restarts.
RUN mkdir -p /var/lib/picenhancer/in /var/lib/picenhancer/out

EXPOSE 4000

CMD ["npx", "tsx", "server.ts"]
