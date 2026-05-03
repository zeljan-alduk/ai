"""
picenhancer — AI super-resolution + face restoration pipeline.

Spawned by the Hono server (server.ts, runAiPlus) per request. Runs on
CPU; the picenhancer container ships PyTorch CPU + onnxruntime + the
two model weights pre-downloaded.

Pipeline:
  1. Real-ESRGAN x4 (xinntao/Real-ESRGAN) on the full image. Generative
     super-resolution that hallucinates plausible high-frequency detail
     instead of just resampling. ~3–8 s on a moderate CPU for typical
     phone-size inputs.
  2. Face detection + GFPGAN v1.4 (TencentARC/GFPGAN) on each detected
     face crop. Restores teeth, eyes, skin, hair definition that pure
     SR can't recover. The GFPGANer.enhance() call composites the
     restored faces back into the SR'd background.
  3. For ×8 / ×16, an additional Lanczos pass on top of the x4 result
     (so the AI work happens once at native scale, then we upsample
     the rest with a clean kernel — much faster than running SR twice).

Progress is emitted as one JSON object per line on stdout (NDJSON) so
the Hono server can parse it and forward as SSE events to the page:
    {"stage":"boot"}
    {"stage":"models_loading"}
    {"stage":"models_loaded"}
    {"stage":"inference_start"}
    {"stage":"progress","pct":50}
    {"stage":"done","ms":7421,"faces":1}

Errors go to stderr; non-zero exit code surfaces as a UI error.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def emit(stage: str, **kwargs: object) -> None:
    """One JSON-line progress event on stdout."""
    print(json.dumps({"stage": stage, **kwargs}), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="picenhancer AI pipeline")
    parser.add_argument("--input", required=True, help="path to source image")
    parser.add_argument("--output", required=True, help="path to write enhanced PNG")
    parser.add_argument(
        "--scale", type=int, default=4, choices=[4, 8, 16],
        help="final scale factor; 4 = single AI pass, 8/16 = AI x4 + Lanczos",
    )
    parser.add_argument(
        "--face", type=int, default=1,
        help="1 = run GFPGAN on detected faces, 0 = SR only",
    )
    parser.add_argument(
        "--models-dir", default="/opt/picenhancer/models",
        help="directory containing the pre-downloaded model weights",
    )
    args = parser.parse_args()

    emit("boot")

    # Heavy imports happen here so 'boot' lands first in the SSE stream
    # and the bar can move while torch + the model files load (~2–4 s).
    import numpy as np
    from PIL import Image

    emit("models_loading")
    import torch  # noqa: F401  (forces native lib load before realesrgan)
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from realesrgan import RealESRGANer

    models = Path(args.models_dir)
    realesrgan_path = models / "RealESRGAN_x4plus.pth"
    gfpgan_path = models / "GFPGANv1.4.pth"

    if not realesrgan_path.exists():
        print(f"missing model: {realesrgan_path}", file=sys.stderr)
        return 2

    # Real-ESRGAN x4plus: 23-block RRDBNet, 64 features, x4. Standard.
    rrdb = RRDBNet(
        num_in_ch=3, num_out_ch=3, num_feat=64,
        num_block=23, num_grow_ch=32, scale=4,
    )
    upsampler = RealESRGANer(
        scale=4,
        model_path=str(realesrgan_path),
        model=rrdb,
        # Tile-size 400px keeps peak memory bounded on a small VPS;
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
        # GFPGAN's .enhance() detects faces, restores each crop with the
        # GAN, and pastes them back into the SR'd background passed via
        # bg_upsampler. One call does the whole face pipeline.
        from gfpgan import GFPGANer
        face_enhancer = GFPGANer(
            model_path=str(gfpgan_path),
            upscale=4,
            arch="clean",
            channel_multiplier=2,
            bg_upsampler=upsampler,
        )

    emit("models_loaded")

    # GFPGAN/Real-ESRGAN both work in BGR uint8 (OpenCV convention).
    img_pil = Image.open(args.input).convert("RGB")
    img_rgb = np.array(img_pil)
    img_bgr = img_rgb[:, :, ::-1]  # RGB -> BGR

    emit("inference_start", w=img_pil.width, h=img_pil.height)
    t0 = time.time()

    faces = 0
    if face_enhancer is not None:
        # has_aligned=False: GFPGAN runs its own face detector + alignment.
        # only_center_face=False: restore every face, not just the central one.
        # paste_back=True: composite restored faces into the SR'd background.
        cropped_faces, restored_faces, restored_bgr = face_enhancer.enhance(
            img_bgr,
            has_aligned=False,
            only_center_face=False,
            paste_back=True,
        )
        faces = len(restored_faces or [])
        out_bgr = restored_bgr
        emit("progress", pct=70, faces=faces)
    else:
        # Pure SR path — no face pass.
        out_bgr, _ = upsampler.enhance(img_bgr, outscale=4)
        emit("progress", pct=70, faces=0)

    out_rgb = out_bgr[:, :, ::-1]

    # ×8 / ×16: take the AI x4 output and extend with Lanczos. AI super
    # at the source scale is what matters for quality; a final Lanczos
    # to ×8/×16 is much faster than running SR a second time and the
    # quality difference is small once the source has been restored.
    if args.scale > 4:
        ratio = args.scale // 4
        h, w = out_rgb.shape[:2]
        out_pil = Image.fromarray(out_rgb)
        out_pil = out_pil.resize((w * ratio, h * ratio), Image.LANCZOS)
        out_rgb = np.array(out_pil)

    emit("progress", pct=90)

    # Save as PNG. Compression level 6 = good size/speed balance.
    Image.fromarray(out_rgb).save(args.output, "PNG", compress_level=6)

    emit("done", ms=int((time.time() - t0) * 1000), faces=faces, scale=args.scale)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 — the parent process needs the message
        print(f"enhance.py crashed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
