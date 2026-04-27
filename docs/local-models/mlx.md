# MLX (Apple Silicon)

Native `mlx_lm.server` adapter for ALDO AI. macOS-on-Apple-Silicon's
fastest local-LLM path; Linux and other platforms continue to use the
`openai-compat` adapter against Ollama / vLLM / llama.cpp / LM Studio.

## Install + spin up the server

```bash
pip install mlx-lm           # 0.21+ for tool-calling support
python -m mlx_lm.server \
    --model mlx-community/Qwen2.5-7B-Instruct-4bit \
    --port 8081
```

The server exposes `/v1/chat/completions`, `/v1/embeddings`, and a
plain `/health` probe.

## Register the model with the gateway

The seed catalog (`platform/gateway/fixtures/models.yaml`) already
contains illustrative MLX entries — operators override these with
their own catalog. A minimal entry looks like:

```yaml
- id: mlx-qwen2.5-7b-instruct-4bit
  provider: mlx
  providerKind: mlx
  locality: local
  capabilityClass: local-reasoning
  provides: [tool-use, function-calling, streaming, structured-output]
  privacyAllowed: [public, internal, sensitive]
  effectiveContextTokens: 32768
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 }
  providerConfig:
    baseUrl: http://localhost:8081
    extra:
      quantization: q4         # informational
      kvCacheQuantized: true   # int8 kv cache
      # draftModel: mlx-community/Qwen2.5-0.5B-Instruct-4bit  # speculative decoding
      # samplerSeed: 1234
```

The MLX-specific knobs (`quantization`, `kvCacheQuantized`,
`draftModel`, `samplerSeed`) live under `providerConfig.extra` and are
translated by the adapter into the snake_case fields `mlx_lm.server`
expects. Other backends ignore these — adding them does not break
LLM-agnosticism.

`MLX_BASE_URL` overrides the base URL at runtime; the API's
`/v1/models` `available` flag flips to `true` once the env var is set
or the default `http://localhost:8081` resolves.

## Eval-harness comparison

Compare quantization tiers head-to-head by registering the same model
under different ids:

```yaml
- id: mlx-qwen2.5-7b-instruct-4bit
  providerConfig: { baseUrl: http://localhost:8081, extra: { quantization: q4 } }
- id: mlx-qwen2.5-7b-instruct-bf16
  providerConfig: { baseUrl: http://localhost:8082, extra: { quantization: bf16 } }
```

Then run the eval sweep:

```bash
aldo eval run agency/agents/code-reviewer.yaml \
    --model mlx-qwen2.5-7b-instruct-4bit \
    --model mlx-qwen2.5-7b-instruct-bf16 \
    --suite suites/code-review.yaml
```

Usage rows tag each row with `provider=mlx, model=<id>` so the
quant-tier comparison shows up directly in the eval report.

## Constraints

- The adapter is a thin wrapper over `createOpenAICompatAdapter` —
  SSE parsing, tool-call buffering, and finish-reason mapping are
  inherited unchanged. MLX-specific behaviour lives entirely inside
  `platform/gateway/src/providers/mlx.ts`.
- Privacy tier `sensitive` is allowed: the model never leaves the box.
- The router never branches on `provider === 'mlx'`; routing remains
  capability/privacy/cost based.
