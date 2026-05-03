"""
picenhancer — Real-ESRGAN x4 super-resolution via ONNX Runtime CPU.

Spawned by the Hono server (server.ts, runAiPlus) per request. The
runtime container ships only onnxruntime + numpy + Pillow; the model
file (realesrgan_x4plus.onnx) is converted from the upstream .pth at
build time by scripts/convert_to_onnx.py.

Pipeline:
  1. Real-ESRGAN x4 (xinntao/Real-ESRGAN) on the full image, executed
     tile-by-tile because the model would otherwise blow per-tile
     memory on large inputs.
  2. For ×8 / ×16, an additional Lanczos pass on top of the AI x4
     output. Running SR twice would double the slowest part of the
     pipeline; a final Lanczos preserves the restored detail at much
     lower cost.

GFPGAN face restoration is the obvious follow-up; deferred for now
because reliable ONNX exports are scarce and the alignment + paste-
back pipeline is non-trivial without the GFPGANer wrapper.

Progress is emitted as one JSON object per line on stdout (NDJSON):
    {"stage":"boot"}
    {"stage":"models_loading"}
    {"stage":"models_loaded"}
    {"stage":"inference_start","w":480,"h":360}
    {"stage":"progress","pct":42}
    {"stage":"done","ms":7421,"faces":0,"scale":4}
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def emit(stage: str, **kwargs: object) -> None:
    print(json.dumps({"stage": stage, **kwargs}), flush=True)


def run_tiled(
    sess,  # ort.InferenceSession
    arr_uint8,  # np.ndarray, HxWxC uint8
    tile: int,
    overlap: int,
    on_progress=None,
) -> "np.ndarray":  # noqa: F821
    """Tile the input, run x4 inference per tile, stitch with overlap.

    Each tile is fed with `overlap` pixels of context around the cropped
    region; the inference output's central region (1:1 over the original
    crop, ×4 in pixel count) is what we keep. This avoids edge artefacts
    where the model sees a hard image boundary.
    """
    import numpy as np  # local import — keeps boot event timing clean

    h, w, _ = arr_uint8.shape
    out = np.zeros((h * 4, w * 4, 3), dtype=np.float32)

    n_y = (h + tile - 1) // tile
    n_x = (w + tile - 1) // tile
    total = n_y * n_x
    done = 0

    for ty in range(n_y):
        for tx in range(n_x):
            y0 = ty * tile
            x0 = tx * tile
            y1 = min(y0 + tile, h)
            x1 = min(x0 + tile, w)
            # Padded source region (with overlap context, clamped).
            py0 = max(0, y0 - overlap)
            px0 = max(0, x0 - overlap)
            py1 = min(h, y1 + overlap)
            px1 = min(w, x1 + overlap)
            tile_in = arr_uint8[py0:py1, px0:px1, :]

            # NCHW float32 in [0, 1].
            inp = tile_in.transpose(2, 0, 1)[None, ...].astype(np.float32) / 255.0
            outs = sess.run(None, {"input": inp})
            tile_out = (outs[0][0].transpose(1, 2, 0) * 255.0).clip(0, 255)

            # Crop the central region back to the un-padded tile in ×4
            # output coords; place at the matching offset.
            off_y = (y0 - py0) * 4
            off_x = (x0 - px0) * 4
            crop_h = (y1 - y0) * 4
            crop_w = (x1 - x0) * 4
            out[y0 * 4 : y1 * 4, x0 * 4 : x1 * 4, :] = tile_out[
                off_y : off_y + crop_h,
                off_x : off_x + crop_w,
                :,
            ]
            done += 1
            if on_progress is not None:
                on_progress(done, total)

    return out.clip(0, 255).astype(np.uint8)


def main() -> int:
    parser = argparse.ArgumentParser(description="picenhancer ONNX SR pipeline")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--scale", type=int, default=4, choices=[4, 8, 16])
    parser.add_argument(
        "--face", type=int, default=0,
        help="face restoration (GFPGAN) — not yet supported in ONNX engine",
    )
    parser.add_argument(
        "--models-dir", default="/opt/picenhancer/models",
    )
    parser.add_argument(
        "--tile", type=int, default=192,
        help="per-tile input size in source pixels (output is ×4)",
    )
    parser.add_argument(
        "--overlap", type=int, default=16,
        help="overlap context per tile, helps suppress seam artefacts",
    )
    args = parser.parse_args()

    emit("boot")

    # Lazy heavy imports so 'boot' lands first in the SSE stream.
    import numpy as np
    import onnxruntime as ort
    from PIL import Image

    model_path = Path(args.models_dir) / "realesrgan_x4plus.onnx"
    if not model_path.exists():
        print(f"missing model: {model_path}", file=sys.stderr)
        return 2

    emit("models_loading")
    sess_options = ort.SessionOptions()
    # Default = 0 → onnxruntime auto-picks intra-op threads from NCPU.
    sess_options.intra_op_num_threads = 0
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ort.InferenceSession(
        str(model_path),
        sess_options=sess_options,
        providers=["CPUExecutionProvider"],
    )
    emit("models_loaded")

    img = np.array(Image.open(args.input).convert("RGB"))
    emit("inference_start", w=int(img.shape[1]), h=int(img.shape[0]))
    t0 = time.time()

    def on_tile(done: int, total: int) -> None:
        # Map tile progress into 30..90% of the global bar; the 10% before
        # this is reserved for boot+model_load stages emitted earlier.
        pct = 30 + int((done / max(total, 1)) * 60)
        emit("progress", pct=pct, tile=done, of=total)

    out = run_tiled(
        sess, img,
        tile=args.tile, overlap=args.overlap,
        on_progress=on_tile,
    )

    # ×8 / ×16: extend the AI x4 output via Lanczos. Quality hit is
    # small once detail has been restored at the source scale.
    if args.scale > 4:
        ratio = args.scale // 4
        h, w = out.shape[:2]
        out_pil = Image.fromarray(out)
        out_pil = out_pil.resize((w * ratio, h * ratio), Image.LANCZOS)
        out = np.array(out_pil)

    emit("progress", pct=95)
    Image.fromarray(out).save(args.output, "PNG", compress_level=6)
    emit("done", ms=int((time.time() - t0) * 1000), faces=0, scale=args.scale)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        import traceback

        traceback.print_exc(file=sys.stderr)
        print(f"enhance.py crashed: {e}", file=sys.stderr)
        sys.exit(1)
