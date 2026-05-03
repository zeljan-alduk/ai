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
# Install into a venv at /opt/picenhancer/venv so the system Python
# stays clean and we can reference the interpreter directly.
RUN python3 -m venv /opt/picenhancer/venv
ENV PATH="/opt/picenhancer/venv/bin:${PATH}"

# torch CPU only — pull from the dedicated CPU index to avoid the
# 2 GB CUDA wheel. Pin to a known-good combo with realesrgan + gfpgan.
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      "torch==2.4.1+cpu" "torchvision==0.19.1+cpu" \
 && pip install --no-cache-dir \
      "numpy<2" "Pillow>=10" "opencv-python-headless==4.10.0.84" \
      "basicsr==1.4.2" "facexlib==0.3.0" \
      "realesrgan==0.3.0" "gfpgan==1.3.8" \
      "tqdm" "lmdb" "yapf"

# basicsr 1.4.2 imports torchvision.transforms.functional_tensor which
# was removed in torchvision 0.17+. Patch the one offending line so the
# import stops crashing. (Upstream basicsr is unmaintained as of 2024.)
RUN python3 - <<'PY'
import basicsr.data.degradations as d, pathlib, re
p = pathlib.Path(d.__file__)
src = p.read_text()
src = src.replace(
    'from torchvision.transforms.functional_tensor import rgb_to_grayscale',
    'from torchvision.transforms.functional import rgb_to_grayscale',
)
p.write_text(src)
PY

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
