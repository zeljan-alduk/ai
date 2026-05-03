"""
picenhancer — Real-ESRGAN x4 super-resolution + GFPGAN v1.4 face restore.

Spawned by the Hono server (server.ts, runAiPlus) per request. Runs on
CPU via ONNX Runtime; the runtime container ships the converted .onnx
files (Real-ESRGAN, GFPGAN, YuNet) baked in at build time.

Pipeline:
  1. Real-ESRGAN x4 on the full image, executed tile-by-tile.
  2. YuNet face detection on the *source* (smaller, faster than
     detecting in the SR'd output). Returns bounding boxes + 5
     landmarks per face.
  3. For each face:
       a. Compute a similarity transform from the 5 landmarks to
          GFPGAN's canonical 512×512 face template.
       b. Warp the source crop to 512×512 input.
       c. Run GFPGAN ONNX → 512×512 restored face.
       d. Compute the inverse transform scaled by 4× (since the SR
          output is 4× the source) and warp the restored face back
          into the SR'd image with a soft mask blend.
  4. ×8/×16: Lanczos extension on top of the SR + face-restored
     output (running SR twice would double the slow step for
     negligible quality once detail is restored).

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
from typing import Optional


def emit(stage: str, **kwargs: object) -> None:
    print(json.dumps({"stage": stage, **kwargs}), flush=True)


# Canonical 5-point face template GFPGAN was trained against. (left eye,
# right eye, nose tip, left mouth corner, right mouth corner) in a
# 512×512 reference frame. These coordinates are the de-facto standard
# from FFHQ alignment + GFPGAN's training pipeline.
ARCFACE_TEMPLATE_512 = [
    (192.98, 239.94),
    (318.91, 240.19),
    (256.63, 314.01),
    (201.26, 371.41),
    (313.08, 371.85),
]


def estimate_similarity_transform(src_pts, dst_pts):
    """Solve a 2D similarity transform (rotation + uniform scale +
    translation) that maps src_pts → dst_pts in the least-squares sense.

    Returns a 2×3 affine matrix suitable for cv2.warpAffine.
    """
    import numpy as np

    src = np.asarray(src_pts, dtype=np.float64)
    dst = np.asarray(dst_pts, dtype=np.float64)
    src_mean = src.mean(axis=0)
    dst_mean = dst.mean(axis=0)
    src_c = src - src_mean
    dst_c = dst - dst_mean
    # Closed-form similarity transform via SVD (Umeyama).
    H = src_c.T @ dst_c
    U, _, Vt = np.linalg.svd(H)
    R = Vt.T @ U.T
    if np.linalg.det(R) < 0:
        Vt[-1, :] *= -1
        R = Vt.T @ U.T
    var_src = (src_c**2).sum() / len(src_c)
    s = (np.diag(np.linalg.svd(H, compute_uv=False)).sum() / (len(src_c) * var_src)) if var_src else 1.0
    T = dst_mean - s * (R @ src_mean)
    M = np.zeros((2, 3), dtype=np.float64)
    M[:, :2] = s * R
    M[:, 2] = T
    return M


def run_sr_tiled(sess, arr_uint8, tile: int, overlap: int, on_progress=None):
    """Tile the input, run x4 inference per tile, stitch with overlap."""
    import numpy as np

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
            py0 = max(0, y0 - overlap)
            px0 = max(0, x0 - overlap)
            py1 = min(h, y1 + overlap)
            px1 = min(w, x1 + overlap)
            tile_in = arr_uint8[py0:py1, px0:px1, :]
            inp = tile_in.transpose(2, 0, 1)[None, ...].astype(np.float32) / 255.0
            outs = sess.run(None, {"input": inp})
            tile_out = (outs[0][0].transpose(1, 2, 0) * 255.0).clip(0, 255)
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


def detect_faces(yunet_path: str, img_bgr) -> list:
    """Run YuNet face detector. Returns a list of (bbox, landmarks5)
    where landmarks5 is a list of 5 (x, y) tuples ordered:
    [left_eye, right_eye, nose, left_mouth, right_mouth].
    """
    import cv2
    import numpy as np

    h, w = img_bgr.shape[:2]
    detector = cv2.FaceDetectorYN_create(
        yunet_path,
        "",
        (w, h),
        score_threshold=0.6,
        nms_threshold=0.3,
        top_k=5000,
    )
    detector.setInputSize((w, h))
    _, faces = detector.detect(img_bgr)
    if faces is None:
        return []
    out = []
    for f in faces:
        # YuNet returns: x, y, w, h, eye_r_x, eye_r_y, eye_l_x, eye_l_y,
        # nose_x, nose_y, mouth_r_x, mouth_r_y, mouth_l_x, mouth_l_y, score
        # Convert YuNet's right/left convention to GFPGAN's left/right:
        # YuNet "right" eye is the viewer's right (subject's left); we
        # need to reorder to left/right from the viewer's perspective so
        # the warp matches the canonical template.
        x, y, ww, hh = f[0:4]
        bbox = (float(x), float(y), float(ww), float(hh))
        # Landmarks: YuNet ordering is [right_eye, left_eye, nose, right_mouth, left_mouth]
        # Template ordering: [left_eye, right_eye, nose, left_mouth, right_mouth]
        landmarks = [
            (float(f[6]), float(f[7])),    # left_eye
            (float(f[4]), float(f[5])),    # right_eye
            (float(f[8]), float(f[9])),    # nose
            (float(f[12]), float(f[13])),  # left_mouth
            (float(f[10]), float(f[11])),  # right_mouth
        ]
        out.append((bbox, landmarks))
    return out


def restore_faces(
    sr_uint8,           # the SR'd image (4× source dims), uint8 HxWxC
    src_uint8,          # the original source image, uint8 HxWxC
    faces,              # list of (bbox, landmarks5) detected in SOURCE
    gfpgan_sess,        # ONNX session for GFPGAN
    on_progress=None,
):
    """For each detected face: align to 512×512, run GFPGAN, paste back
    into the SR'd image with a feathered mask.
    """
    import cv2
    import numpy as np

    out = sr_uint8.copy()
    for i, (_bbox, landmarks) in enumerate(faces):
        # Align landmarks → canonical 512×512 template.
        M = estimate_similarity_transform(landmarks, ARCFACE_TEMPLATE_512)
        # Warp source crop to 512×512 (RGB for GFPGAN).
        src_rgb = src_uint8[:, :, ::-1] if src_uint8.shape[2] == 3 else src_uint8
        face_512 = cv2.warpAffine(
            src_rgb, M, (512, 512),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT_101,
        )
        # GFPGAN expects [-1, 1] normalised RGB, NCHW.
        face_in = (face_512.astype(np.float32) / 255.0 - 0.5) * 2.0
        face_in = face_in.transpose(2, 0, 1)[None, ...]
        restored = gfpgan_sess.run(None, {"input": face_in})[0][0]
        # Back to uint8 RGB.
        restored = (restored.transpose(1, 2, 0) * 0.5 + 0.5).clip(0, 1) * 255.0
        restored = restored.astype(np.uint8)

        # Inverse warp into SR space. Since the SR is 4× the source,
        # scale the source-space transform up by 4.
        scale_up = np.array([[4.0, 0.0, 0.0], [0.0, 4.0, 0.0], [0.0, 0.0, 1.0]])
        M_full = np.vstack([M, [0, 0, 1]])
        M_sr = scale_up @ np.linalg.inv(M_full)
        M_sr_2x3 = M_sr[:2, :]

        sr_h, sr_w = out.shape[:2]
        # Warp restored face back to full SR canvas + a soft alpha mask
        # so the blend is feathered at the face-bounding edges (avoids
        # a hard rectangle around the restored face).
        warped_face = cv2.warpAffine(
            restored, M_sr_2x3, (sr_w, sr_h),
            flags=cv2.INTER_LINEAR,
        )
        # Build an alpha mask the same way: warp a 512×512 ones-image
        # with a feathered border.
        mask = np.zeros((512, 512), dtype=np.float32)
        feather = 32
        mask[feather:-feather, feather:-feather] = 1.0
        mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=feather / 2)
        warped_mask = cv2.warpAffine(
            mask, M_sr_2x3, (sr_w, sr_h),
            flags=cv2.INTER_LINEAR,
        )
        warped_mask = warped_mask[:, :, None].clip(0, 1)
        # Composite (RGB on top of RGB; remember `out` is BGR-from-source path).
        out_rgb = out[:, :, ::-1].astype(np.float32)
        warped_face_f = warped_face.astype(np.float32)
        composite = warped_face_f * warped_mask + out_rgb * (1.0 - warped_mask)
        out = composite.clip(0, 255).astype(np.uint8)[:, :, ::-1]
        if on_progress is not None:
            on_progress(i + 1, len(faces))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="picenhancer ONNX SR + face restore")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--scale", type=int, default=4, choices=[4, 8, 16])
    parser.add_argument(
        "--face", type=int, default=1,
        help="1 = run YuNet face detect + GFPGAN restore, 0 = SR only",
    )
    parser.add_argument("--models-dir", default="/opt/picenhancer/models")
    parser.add_argument("--tile", type=int, default=192)
    parser.add_argument("--overlap", type=int, default=16)
    args = parser.parse_args()

    emit("boot")

    import numpy as np
    import onnxruntime as ort
    from PIL import Image

    models = Path(args.models_dir)
    sr_path = models / "realesrgan_x4plus.onnx"
    gfpgan_path = models / "gfpgan_v1_4.onnx"
    yunet_path = models / "face_detection_yunet.onnx"

    if not sr_path.exists():
        print(f"missing model: {sr_path}", file=sys.stderr)
        return 2

    emit("models_loading")
    so = ort.SessionOptions()
    so.intra_op_num_threads = 0
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sr_sess = ort.InferenceSession(
        str(sr_path), sess_options=so, providers=["CPUExecutionProvider"],
    )

    gfpgan_sess: Optional[ort.InferenceSession] = None
    if args.face and gfpgan_path.exists() and yunet_path.exists():
        gfpgan_sess = ort.InferenceSession(
            str(gfpgan_path), sess_options=so, providers=["CPUExecutionProvider"],
        )

    emit("models_loaded")

    img = np.array(Image.open(args.input).convert("RGB"))
    emit("inference_start", w=int(img.shape[1]), h=int(img.shape[0]))
    t0 = time.time()

    # Stage A: SR. Map per-tile progress into 10..70% of the global bar.
    def on_tile(done: int, total: int) -> None:
        pct = 10 + int((done / max(total, 1)) * 60)
        emit("progress", pct=pct, tile=done, of=total, stage="sr")

    sr_out = run_sr_tiled(sr_sess, img, tile=args.tile, overlap=args.overlap,
                          on_progress=on_tile)

    # Stage B: face restoration (optional).
    faces_count = 0
    if gfpgan_sess is not None:
        emit("progress", pct=72, stage="face_detect")
        img_bgr = img[:, :, ::-1]
        try:
            faces = detect_faces(str(yunet_path), img_bgr)
        except Exception as e:  # noqa: BLE001
            print(f"face detect failed: {e}", file=sys.stderr)
            faces = []
        faces_count = len(faces)
        if faces:
            emit("progress", pct=75, stage="face_restore", faces=faces_count)
            def on_face(done: int, total: int) -> None:
                pct = 75 + int((done / max(total, 1)) * 18)
                emit("progress", pct=pct, face=done, of=total, stage="face_restore")
            sr_out = restore_faces(sr_out, img, faces, gfpgan_sess, on_progress=on_face)

    # Stage C: ×8 / ×16 extension via Lanczos on top of the AI x4 result.
    if args.scale > 4:
        ratio = args.scale // 4
        h, w = sr_out.shape[:2]
        sr_out = np.array(
            Image.fromarray(sr_out).resize((w * ratio, h * ratio), Image.LANCZOS),
        )

    emit("progress", pct=95)
    Image.fromarray(sr_out).save(args.output, "PNG", compress_level=6)
    emit("done", ms=int((time.time() - t0) * 1000), faces=faces_count, scale=args.scale)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        import traceback

        traceback.print_exc(file=sys.stderr)
        print(f"enhance.py crashed: {e}", file=sys.stderr)
        sys.exit(1)
