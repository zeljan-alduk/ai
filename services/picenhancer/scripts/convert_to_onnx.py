"""
Build-time helper: convert a Real-ESRGAN x4plus .pth checkpoint into a
dynamic-shape .onnx model the runtime container can use without
PyTorch installed.

Run inside the converter stage of services/picenhancer/Dockerfile;
the resulting realesrgan_x4plus.onnx is COPY'd into the runtime stage.
"""
import sys

import torch
from basicsr.archs.rrdbnet_arch import RRDBNet


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: convert_to_onnx.py <src.pth> <dst.onnx>", file=sys.stderr)
        return 2
    src, dst = sys.argv[1], sys.argv[2]

    # Real-ESRGAN x4plus = 23-block RRDBNet with 64 features, scale 4.
    # Standard config from xinntao's repo.
    model = RRDBNet(
        num_in_ch=3, num_out_ch=3, num_feat=64,
        num_block=23, num_grow_ch=32, scale=4,
    )
    state = torch.load(src, map_location="cpu", weights_only=False)
    # Real-ESRGAN ships the EMA weights under 'params_ema' (preferred);
    # fall back to 'params' / raw dict for community checkpoints.
    state_dict = (
        state.get("params_ema")
        or state.get("params")
        or state
    )
    model.load_state_dict(state_dict, strict=True)
    model.eval()

    # Dynamic batch + spatial dims so the runtime can feed any tile size.
    dummy = torch.randn(1, 3, 64, 64)
    torch.onnx.export(
        model,
        dummy,
        dst,
        opset_version=17,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={
            "input": {0: "batch", 2: "h", 3: "w"},
            "output": {0: "batch", 2: "h", 3: "w"},
        },
        do_constant_folding=True,
    )
    print(f"wrote {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
