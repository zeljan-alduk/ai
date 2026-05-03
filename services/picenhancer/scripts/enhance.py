"""
picenhancer — face restoration (default) + optional Real-ESRGAN x4 upscale.

Spawned by the Hono server (server.ts, runAiPlus) per request. Runs on
CPU via PyTorch; the picenhancer container ships torch CPU + the four
.pth model weights pre-downloaded at build time.

Modes (controlled by --scale):
  --scale 1   ENHANCE ONLY (default). GFPGAN face restoration at the
              source resolution. No SR pass. Output is the same size
              as the input. Fast: 3–10 s for a typical portrait. This
              is what most "AI image enhance" products do — restore
              the face, keep the dimensions.
  --scale 4   ENHANCE + UPSCALE x4. Real-ESRGAN x4 background +
              GFPGAN per face, composited back. Slower (10–30 s).
  --scale 8   ENHANCE + UPSCALE x8. AI x4 then Lanczos extension.
  --scale 16  ENHANCE + UPSCALE x16. AI x4 then Lanczos extension.

A background heartbeat thread emits a `progress` tick every ~4 seconds
during the (otherwise blocking) GFPGANer.enhance call, so the SSE
stream stays alive past the upstream proxy's HTTP/2 idle timeout.

Progress is emitted as one JSON object per line on stdout (NDJSON).
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path


def emit(stage: str, **kwargs: object) -> None:
    print(json.dumps({"stage": stage, **kwargs}), flush=True)


def run_with_heartbeat(target_fn, label: str, base_pct: int, max_pct: int):
    """Run target_fn in a worker thread and emit a heartbeat
    `progress` event every 4 seconds until it returns. The pct in
    each tick walks from base_pct toward max_pct asymptotically so
    the bar keeps moving without overshooting.

    Returns target_fn's return value, or re-raises its exception.
    """
    box: list = [None]
    err: list = [None]
    done = threading.Event()

    def runner() -> None:
        try:
            box[0] = target_fn()
        except BaseException as e:  # noqa: BLE001
            err[0] = e
        finally:
            done.set()

    t = threading.Thread(target=runner, daemon=True)
    t.start()

    elapsed = 0.0
    pct = float(base_pct)
    while not done.wait(4.0):
        elapsed += 4.0
        # Asymptotic walk toward max_pct: each tick covers ~25 % of the
        # remaining gap. Keeps the bar visibly moving without ever
        # claiming we're "done" before we are.
        pct = pct + (max_pct - pct) * 0.25
        emit("progress", pct=int(pct), heartbeat=int(elapsed), phase=label)

    if err[0] is not None:
        raise err[0]
    return box[0]


def main() -> int:
    parser = argparse.ArgumentParser(description="picenhancer AI pipeline")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--scale", type=int, default=1, choices=[1, 4, 8, 16],
        help="1 = enhance only (default); 4/8/16 = enhance + upscale",
    )
    parser.add_argument(
        "--face", type=int, default=1,
        help="1 = run GFPGAN on detected faces, 0 = SR/passthrough only",
    )
    parser.add_argument(
        "--models-dir", default="/opt/picenhancer/models",
    )
    args = parser.parse_args()

    emit("boot")

    # Lazy heavy imports so 'boot' lands first in the SSE stream.
    import cv2
    import numpy as np

    emit("models_loading")
    import torch  # noqa: F401  (forces native lib load before basicsr)

    models = Path(args.models_dir)
    realesrgan_path = models / "RealESRGAN_x4plus.pth"
    gfpgan_path = models / "GFPGANv1.4.pth"

    if not gfpgan_path.exists():
        print(f"missing model: {gfpgan_path}", file=sys.stderr)
        return 2

    # Background upsampler is only needed for upscale modes (scale > 1).
    bg_upsampler = None
    if args.scale > 1:
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from realesrgan import RealESRGANer

        rrdb = RRDBNet(
            num_in_ch=3, num_out_ch=3, num_feat=64,
            num_block=23, num_grow_ch=32, scale=4,
        )
        bg_upsampler = RealESRGANer(
            scale=4,
            model_path=str(realesrgan_path),
            model=rrdb,
            tile=400,
            tile_pad=10,
            pre_pad=0,
            half=False,
            device="cpu",
        )

    face_enhancer = None
    if args.face:
        from gfpgan import GFPGANer
        # upscale=1 keeps the output at source resolution in enhance-only
        # mode. For upscale modes (>=4) we still pass upscale=4 because
        # GFPGAN delegates to the bg_upsampler whose scale is fixed at 4;
        # the further x8/x16 pass happens via Lanczos below.
        gfp_upscale = 4 if args.scale > 1 else 1
        face_enhancer = GFPGANer(
            model_path=str(gfpgan_path),
            upscale=gfp_upscale,
            arch="clean",
            channel_multiplier=2,
            bg_upsampler=bg_upsampler,
        )

    emit("models_loaded")

    img_bgr = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if img_bgr is None:
        from PIL import Image
        pil = Image.open(args.input).convert("RGB")
        img_bgr = np.array(pil)[:, :, ::-1].copy()

    h, w = img_bgr.shape[:2]
    emit("inference_start", w=int(w), h=int(h), mode="enhance" if args.scale == 1 else f"upscale-x{args.scale}")
    t0 = time.time()

    faces = 0
    emit("progress", pct=15, phase="inference")

    if face_enhancer is not None:
        # GFPGANer.enhance is a single blocking call. Wrap with a
        # heartbeat thread so the SSE stream gets a tick every ~4 s,
        # which prevents the upstream HTTP/2 proxy from killing the
        # connection on long jobs (the "network error" failure mode).
        def do_enhance():
            return face_enhancer.enhance(
                img_bgr,
                has_aligned=False,
                only_center_face=False,
                paste_back=True,
            )

        cropped, restored, out_bgr = run_with_heartbeat(
            do_enhance, label="face_enhance", base_pct=20, max_pct=80,
        )
        faces = len(restored or [])
    elif bg_upsampler is not None:
        def do_sr():
            return bg_upsampler.enhance(img_bgr, outscale=4)

        out_bgr, _ = run_with_heartbeat(do_sr, label="sr", base_pct=20, max_pct=80)
    else:
        # Pure passthrough — only happens with --face 0 --scale 1.
        out_bgr = img_bgr

    emit("progress", pct=85, faces=faces)

    # x8 / x16 extension via Lanczos on top of the AI x4 result.
    if args.scale > 4:
        ratio = args.scale // 4
        out_h, out_w = out_bgr.shape[:2]
        out_bgr = cv2.resize(
            out_bgr,
            (out_w * ratio, out_h * ratio),
            interpolation=cv2.INTER_LANCZOS4,
        )

    emit("progress", pct=95)
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
