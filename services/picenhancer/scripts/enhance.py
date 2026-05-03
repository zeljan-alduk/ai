"""
picenhancer — Real-ESRGAN x4 super-resolution + GFPGAN v1.4 face restore.

Spawned by the Hono server (server.ts, runAiPlus) per request. Runs on
CPU via PyTorch; the picenhancer container ships torch CPU + the four
.pth model weights pre-downloaded at build time.

Pipeline:
  1. Build a RealESRGANer (RRDBNet x4) as the background upsampler.
  2. Build a GFPGANer with that bg_upsampler. GFPGANer.enhance() does
     the whole pipeline in one call: detect faces (facexlib RetinaFace),
     align each crop to the canonical 512x512 template, run GFPGAN per
     face, and paste the restored faces back into the SR'd background.
  3. For ×8 / ×16, an additional Lanczos pass on top of the AI x4
     output (faster than running SR twice, quality difference is small
     once detail is restored).

Progress is emitted as one JSON object per line on stdout (NDJSON):
    {"stage":"boot"}
    {"stage":"models_loading"}
    {"stage":"models_loaded"}
    {"stage":"inference_start","w":480,"h":360}
    {"stage":"progress","pct":42}
    {"stage":"done","ms":7421,"faces":1,"scale":4}
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def emit(stage: str, **kwargs: object) -> None:
    print(json.dumps({"stage": stage, **kwargs}), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="picenhancer AI pipeline")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--scale", type=int, default=4, choices=[4, 8, 16])
    parser.add_argument(
        "--face", type=int, default=1,
        help="1 = run GFPGAN on detected faces, 0 = SR only",
    )
    parser.add_argument(
        "--models-dir", default="/opt/picenhancer/models",
    )
    args = parser.parse_args()

    emit("boot")

    # Lazy heavy imports so 'boot' lands first in the SSE stream while
    # torch + the model files load (the slow part — typically 2–4 s).
    import cv2
    import numpy as np

    emit("models_loading")
    import torch  # noqa: F401  (forces native lib load before basicsr)
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from realesrgan import RealESRGANer

    models = Path(args.models_dir)
    realesrgan_path = models / "RealESRGAN_x4plus.pth"
    gfpgan_path = models / "GFPGANv1.4.pth"

    if not realesrgan_path.exists():
        print(f"missing model: {realesrgan_path}", file=sys.stderr)
        return 2

    # Real-ESRGAN x4plus = 23-block RRDBNet, 64 features, scale 4.
    rrdb = RRDBNet(
        num_in_ch=3, num_out_ch=3, num_feat=64,
        num_block=23, num_grow_ch=32, scale=4,
    )
    bg_upsampler = RealESRGANer(
        scale=4,
        model_path=str(realesrgan_path),
        model=rrdb,
        # 400 px tiles keep peak memory bounded on a small VPS;
        # tile_pad reduces seam artefacts at the tile boundaries.
        tile=400,
        tile_pad=10,
        pre_pad=0,
        # CPU has no fp16; this also avoids the bf16/cuda mismatch on
        # hosts where torch was built with CUDA but no GPU is present.
        half=False,
        device="cpu",
    )

    face_enhancer = None
    if args.face and gfpgan_path.exists():
        from gfpgan import GFPGANer
        face_enhancer = GFPGANer(
            model_path=str(gfpgan_path),
            upscale=4,
            arch="clean",
            channel_multiplier=2,
            bg_upsampler=bg_upsampler,
        )

    emit("models_loaded")

    # cv2.imread handles JPEG / PNG / WebP. Fall back to PIL for
    # anything cv2 can't open (rare; covers exotic formats).
    img_bgr = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if img_bgr is None:
        from PIL import Image
        pil = Image.open(args.input).convert("RGB")
        img_bgr = np.array(pil)[:, :, ::-1].copy()

    h, w = img_bgr.shape[:2]
    emit("inference_start", w=int(w), h=int(h))
    t0 = time.time()

    faces = 0
    emit("progress", pct=15, phase="inference")

    if face_enhancer is not None:
        # GFPGANer.enhance(): face detect -> align -> restore -> paste-back
        # over the background SR'd image. paste_back=True composites
        # restored faces into bg_upsampler's output.
        cropped, restored, out_bgr = face_enhancer.enhance(
            img_bgr,
            has_aligned=False,
            only_center_face=False,
            paste_back=True,
        )
        faces = len(restored or [])
        emit("progress", pct=85, faces=faces)
    else:
        # SR only — no face pass.
        out_bgr, _ = bg_upsampler.enhance(img_bgr, outscale=4)
        emit("progress", pct=85)

    # ×8 / ×16: extend the AI x4 output via Lanczos. Quality hit is
    # small once detail has been restored at the source scale.
    if args.scale > 4:
        ratio = args.scale // 4
        out_h, out_w = out_bgr.shape[:2]
        out_bgr = cv2.resize(
            out_bgr,
            (out_w * ratio, out_h * ratio),
            interpolation=cv2.INTER_LANCZOS4,
        )

    emit("progress", pct=95)
    # cv2.imwrite picks codec from extension; we always write .png.
    cv2.imwrite(args.output, out_bgr, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    emit("done", ms=int((time.time() - t0) * 1000), faces=faces, scale=args.scale)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        import traceback

        traceback.print_exc(file=sys.stderr)
        print(f"enhance.py crashed: {e}", file=sys.stderr)
        sys.exit(1)
