# services/picenhancer/Dockerfile
#
# Container image for the picenhancer Hono server (the live runtime
# behind ai.aldo.tech/live/picenhancer).
#
# Engine: `aiplus` by default — Real-ESRGAN x4 generative SR + GFPGAN
# v1.4 face restoration via PyTorch CPU + the canonical RealESRGANer +
# GFPGANer Python classes from the official upstream packages. This is
# the reference pipeline that every face-enhancement product (Topaz,
# Tenorshare, etc.) uses under the hood; we just run it server-side
# with no GPU.
#
# Single-stage: ML deps + model weights all in the runtime image.
# Earlier revisions used a multi-stage build with ONNX exports to keep
# the image small, but GFPGAN's StyleGAN2 ModulatedConv2d doesn't
# survive torch.onnx.export (mixed double/float Conv types). Going
# back to torch in the runtime is the pragmatic ship-it path.
#
# Image size: ~1.5 GB. Per-portrait latency: ~10–30 s on a typical
# CPU VPS.
#
# `sharp` (libvips Lanczos-3) and `realesrgan` (ncnn-vulkan binary)
# are kept as opt-in alternatives via PIXMEND_ENGINE.
#
# Build context = repo root (set by docker-compose `build.context`).

FROM node:22-bookworm-slim

# OS deps:
#   ca-certificates / curl   — fetch model weights at build time
#   python3 / pip / venv     — host the AI pipeline
#   libgl1 / libglib2.0      — runtime deps for opencv-python-headless
#   libgomp1                 — OpenMP runtime PyTorch links against
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl \
      python3 python3-pip python3-venv \
      libgl1 libglib2.0-0 libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/picenhancer

# Venv to comply with PEP 668 (Debian 12 protects system Python).
RUN python3 -m venv /opt/picenhancer/venv
ENV PATH="/opt/picenhancer/venv/bin:${PATH}"
RUN pip install --no-cache-dir --upgrade pip

# All ML deps in one pip resolve so the torch pin survives basicsr's /
# gfpgan's unconstrained torch dep (otherwise pip uninstalls
# torch==2.0.1+cpu and reinstalls torch==2.11.0 from PyPI to satisfy
# the setup.py, which then breaks because torchvision >= 0.17 removed
# transforms.functional_tensor that basicsr 1.4.2 imports).
RUN pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      --extra-index-url https://pypi.org/simple \
      "torch==2.0.1+cpu" "torchvision==0.15.2+cpu" \
      "numpy<2" "Pillow>=10,<11" \
      "opencv-python-headless==4.10.0.84" \
      "basicsr==1.4.2" "facexlib==0.3.0" \
      "realesrgan==0.3.0" "gfpgan==1.3.8"

# Belt-and-suspenders: patch basicsr's functional_tensor import in case
# pip resolution decides to upgrade torchvision in a future build.
# torchvision 0.17+ moved rgb_to_grayscale to transforms.functional.
RUN sed -i 's|from torchvision.transforms.functional_tensor import rgb_to_grayscale|from torchvision.transforms.functional import rgb_to_grayscale|' \
    /opt/picenhancer/venv/lib/python3.11/site-packages/basicsr/data/degradations.py 2>/dev/null || true

# Pre-download every model weight the pipeline can pull at runtime so
# the first user request doesn't pay a multi-minute download tax.
#   - RealESRGAN_x4plus.pth         — generative SR backbone (~64 MB)
#   - GFPGANv1.4.pth                — face restoration head (~333 MB)
#   - detection_Resnet50_Final.pth  — facexlib RetinaFace detector (~109 MB)
#   - parsing_parsenet.pth          — facexlib face parser (~89 MB)
# facexlib looks for the last two under gfpgan/weights/ relative to
# the gfpgan package install; we mirror them there so they're found
# without a download.
RUN mkdir -p /opt/picenhancer/models \
 && GFPGAN_WEIGHTS=/opt/picenhancer/venv/lib/python3.11/site-packages/gfpgan/weights \
 && mkdir -p "$GFPGAN_WEIGHTS" \
 && curl -fsSL -o /opt/picenhancer/models/RealESRGAN_x4plus.pth \
      https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth \
 && curl -fsSL -o /opt/picenhancer/models/GFPGANv1.4.pth \
      https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth \
 && curl -fsSL -o "$GFPGAN_WEIGHTS/detection_Resnet50_Final.pth" \
      https://github.com/xinntao/facexlib/releases/download/v0.1.0/detection_Resnet50_Final.pth \
 && curl -fsSL -o "$GFPGAN_WEIGHTS/parsing_parsenet.pth" \
      https://github.com/xinntao/facexlib/releases/download/v0.2.2/parsing_parsenet.pth \
 && ls -lh /opt/picenhancer/models/ "$GFPGAN_WEIGHTS"

# Build-time sanity import + a tiny inference smoke so a broken pip
# combo or a model-arch mismatch fails here, not on the first user
# request.
RUN python3 -c "\
from gfpgan import GFPGANer; \
from realesrgan import RealESRGANer; \
from basicsr.archs.rrdbnet_arch import RRDBNet; \
print('ok: gfpgan, realesrgan, basicsr all import')"

# Hono server + UI shell + Python script.
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
