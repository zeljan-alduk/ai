"""
Build-time helper: convert GFPGANv1.4.pth -> dynamic-shape .onnx.

Pattern mirrors convert_to_onnx.py for Real-ESRGAN. Used only in the
Dockerfile's converter stage; the resulting .onnx is COPY'd into the
runtime stage and loaded with onnxruntime.

GFPGAN's forward returns a tuple (restored_face, intermediate_maps).
We wrap the model so the ONNX graph emits only the restored face — the
intermediate outputs aren't useful for inference.
"""
import sys

import torch
from gfpgan.archs.gfpganv1_clean_arch import GFPGANv1Clean


class GFPGANWrap(torch.nn.Module):
    """Strip the auxiliary outputs so the ONNX export has a single tensor out."""

    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # GFPGANv1Clean.forward returns (out, out_rgbs) where out is the
        # restored image and out_rgbs is a list of intermediate scales
        # used for training only.
        out, _ = self.model(x, return_rgb=False)
        return out


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: convert_gfpgan_to_onnx.py <src.pth> <dst.onnx>", file=sys.stderr)
        return 2
    src, dst = sys.argv[1], sys.argv[2]

    # GFPGAN v1.4 "clean" arch — the version that doesn't depend on the
    # patched StyleGAN op (FusedLeakyReLU). 512x512 input, ch_mult=2.
    model = GFPGANv1Clean(
        out_size=512,
        num_style_feat=512,
        channel_multiplier=2,
        decoder_load_path=None,
        fix_decoder=False,
        num_mlp=8,
        input_is_latent=True,
        different_w=True,
        narrow=1,
        sft_half=True,
    )
    state = torch.load(src, map_location="cpu", weights_only=False)
    state_dict = state.get("params_ema") or state.get("params") or state
    model.load_state_dict(state_dict, strict=True)
    model.eval()

    wrapped = GFPGANWrap(model)
    dummy = torch.randn(1, 3, 512, 512)

    # Trace first so the StyleGAN2 ModulatedConv2d's dynamic kernel
    # reshape (which torch.onnx can't symbolically export) gets baked
    # into a constant for batch=1. We always run with batch=1 at
    # inference time, so the loss of dynamic batching is a non-issue.
    with torch.no_grad():
        traced = torch.jit.trace(wrapped, dummy, check_trace=False)

    torch.onnx.export(
        traced,
        dummy,
        dst,
        opset_version=17,
        input_names=["input"],
        output_names=["output"],
        do_constant_folding=True,
        # No dynamic_axes — the trace is fixed at 1×3×512×512 input
        # and the corresponding 1×3×512×512 output. The runtime crops
        # every face to 512×512 before inference anyway.
    )
    print(f"wrote {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
