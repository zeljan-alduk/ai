# services/picenhancer/Dockerfile
#
# Container image for the picenhancer Hono server (the live runtime
# behind ai.aldo.tech/live/picenhancer).
#
# Engine: `aiplus` by default — Real-ESRGAN x4 generative SR via
# ONNX Runtime CPU (no PyTorch in the runtime image, no GPU/Vulkan).
# Tile-based inference with overlap to bound peak memory and avoid
# seam artefacts. Lanczos extension on top for ×8 / ×16.
#
# Two-stage build:
#   1. converter — installs torch+CPU briefly to load the upstream
#      .pth checkpoint and export it to .onnx with dynamic shapes.
#      Throwaway image; only the produced .onnx file is COPY'd
#      forward.
#   2. runtime   — node:22-bookworm-slim + python3 + onnxruntime CPU
#      + numpy + Pillow + the .onnx model + the Hono server. ~400 MB
#      total vs. ~2 GB for a torch-bundled image.
#
# `sharp` (libvips Lanczos-3) and `realesrgan` (ncnn-vulkan binary)
# are kept as opt-in alternatives via PIXMEND_ENGINE.

# ===================== STAGE 1: convert .pth -> .onnx =====================
FROM python:3.11-slim-bookworm AS converter

WORKDIR /work

# curl + torch CPU stack + the OpenCV native deps that basicsr pulls in
# transitively. libgl1 + libglib2.0-0 are the libGL.so.1 / libgthread
# providers — without them `import cv2` blows up at import time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip

# All deps in one pip resolve so the torch pin survives basicsr's
# unconstrained torch dep (otherwise pip uninstalls torch==2.0.1+cpu
# and reinstalls torch==2.11.0 from PyPI to satisfy basicsr's setup.py,
# which then breaks because torchvision >= 0.17 removed
# transforms.functional_tensor that basicsr 1.4.2 imports).
RUN pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      --extra-index-url https://pypi.org/simple \
      "torch==2.0.1+cpu" "torchvision==0.15.2+cpu" \
      "numpy<2" "Pillow>=10,<11" \
      "basicsr==1.4.2" \
      "onnx==1.16.2"

# Belt-and-suspenders: patch basicsr's functional_tensor import in case
# pip resolution decides to upgrade torchvision in a future build.
# torchvision 0.17+ moved rgb_to_grayscale to transforms.functional.
RUN sed -i 's|from torchvision.transforms.functional_tensor import rgb_to_grayscale|from torchvision.transforms.functional import rgb_to_grayscale|' \
    /usr/local/lib/python3.11/site-packages/basicsr/data/degradations.py 2>/dev/null || true

# Pre-download the upstream Real-ESRGAN x4plus checkpoint (~64 MB).
RUN curl -fsSL -o RealESRGAN_x4plus.pth \
      https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth \
 && ls -lh RealESRGAN_x4plus.pth

COPY services/picenhancer/scripts/convert_to_onnx.py .
RUN python convert_to_onnx.py RealESRGAN_x4plus.pth realesrgan_x4plus.onnx \
 && ls -lh realesrgan_x4plus.onnx


# ============================ STAGE 2: runtime ============================
FROM node:22-bookworm-slim

# OS deps:
#   ca-certificates    — outbound HTTPS for any future model fetches
#   python3 / pip /
#     venv             — host the ONNX inference script
#   libgomp1           — OpenMP runtime onnxruntime links against
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      python3 python3-pip python3-venv \
      libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/picenhancer

# Venv (PEP 668 protects system Python on Debian 12).
RUN python3 -m venv /opt/picenhancer/venv
ENV PATH="/opt/picenhancer/venv/bin:${PATH}"

# Lean Python deps. onnxruntime CPU wheel is ~50 MB.
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir \
      "onnxruntime==1.17.3" "numpy<2" "Pillow>=10,<11"

# Carry only the produced .onnx forward — no torch in the runtime image.
COPY --from=converter /work/realesrgan_x4plus.onnx /opt/picenhancer/models/realesrgan_x4plus.onnx

# Sanity: the runtime can load the model. Catches a mismatched
# onnxruntime opset at build time rather than the first user request.
RUN python3 -c "import onnxruntime as ort; ort.InferenceSession('/opt/picenhancer/models/realesrgan_x4plus.onnx', providers=['CPUExecutionProvider']); print('ok')"

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
