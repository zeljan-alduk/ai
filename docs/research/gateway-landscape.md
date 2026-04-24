# Model Gateway Landscape & Integration Plan

## 1. Gateway Options Comparison

| Feature | LiteLLM | Portkey | OpenRouter | Helicone | Martian / Not Diamond | Roll-Your-Own |
|---------|---------|---------|-----------|----------|----------------------|---------------|
| **What it does well** | Unified SDK/proxy for 100+ APIs; cost tracking; load balancing; logging | 200+ models; smart failover; governance; observability; production-proven (2T tokens/day) | Managed inference; 1600+ models; structured output support; tool calling native | Observability-first; semantic caching; distributed architecture; low latency (50-80ms) | Dynamic routing; cost optimization (20-96% savings); latency-aware routing | Full control; no vendor lock-in; custom logic |
| **What it lacks** | Observability dashboard is minimal; limited to SDK pattern | Steeper learning curve; less suited for budget-tier routing | No local model support; provider-dependent; SaaS only | Weak for intelligent routing; primarily observability | Proprietary; black-box; limited transparency | Maintenance burden; reinvent common patterns |
| **License** | Apache 2.0 | Open source (Mar 2026); enterprise license | Proprietary SaaS | Apache 2.0 | Proprietary (API-only) | N/A |
| **Maintenance health** | Active (releases Jan 2025+); strong community | Heavy development (1.0 release pending); Series A funded | Cloud-based; regular updates | Steady; enterprise support available | Well-funded; actively developed | Self-managed |
| **Tool-use fidelity** | Pass-through (depends on provider); SDK handles serialization | Provider-agnostic; conversion layer for OpenAI incompatible models | Native OpenAI format; parallel function calling | Pass-through | Provider-aware; optimization logic | Custom implementation |
| **Structured-output support** | Via provider (json_schema); OpenAI format | Via provider conversion | json_schema + strict schema mode; streaming support | Via provider (observability only) | Via provider routing | Custom grammar/validation |
| **Streaming** | Full support; SSE compatible | Full support | Full support | Full support | Full support | Custom implementation |
| **Retries & fallback** | Basic retry; limited fallback chains | Intelligent fallback on configurable errors; canary deployments | Implicit (pool-based) | No; observability only | Priority-based model switching | Manual implementation |
| **Observability hooks** | Cost + latency; basic logging | Rich (cost, latency, errors, usage); audit logs; governance | Via 3rd party | Deep: traces, sessions, semantic analysis | Embedded (routing metrics) | Custom instrumentation |

**Recommendation lens:** LiteLLM for unified interface + cost tracking; Portkey for production reliability + governance; OpenRouter for managed multi-cloud; build routing intelligence separately.

---

## 2. Local-Backend Adapters

| Backend | API Shape | Tool Use | Structured Output | Streaming | Gotchas |
|---------|-----------|----------|-------------------|-----------|---------|
| **Ollama** | OpenAI-compatible (/v1/chat/completions) | ✓ Native (via tools param); Llama 3.1+; streaming tool calls | ✓ JSON schema + Pydantic/Zod models | ✓ SSE; full streaming with tools | Model availability; performance varies by hardware; prompt template inference needed |
| **llama.cpp** | OpenAI-compatible (llama-server); native REST | ✓ Via GBNF grammar conversion; llama-cpp-agent framework available | ✓ GBNF (Lark/EBNF grammar); JSON schema → GBNF conversion built-in | ✓ Full support | GBNF startup cost; grammar-to-JSON mapping must be precise; template handling critical |
| **vLLM** | OpenAI-compatible; native REST | ✓ Via tool_choice='required'; structured output backend | ✓ Outlines / xgrammar / llguidance; 4 modes (guided_choice, guided_regex, guided_json, guided_grammar) | ✓ Full support | Backend choice (xgrammar default in v1.x); context length; batching overhead with constraints |
| **SGLang** | Native (sgl.gen primitives); OpenAI compat layer | ✓ Primitives (regex, select) for local models; tool support in dev roadmap (Q3 2024+) | ✓ Regex + grammar primitives; llguidance backend support; compressed FSM for speed | ✓ Full support | Interop with OpenAI models requires translation; FSM precompilation overhead |
| **MLX-LM** | Native Python API; no HTTP server | ✗ No native; requires wrapper | ✓ Outlines integration; experimental | ✗ No built-in streaming | Apple Silicon only; GGUF export required for production; limited fine-tuning ecosystem |
| **TGI** | OpenAI-compatible (Messages API); native | ✓ OpenAI-compatible; full tool support | ✓ JSON + regex grammars via Outlines | ✓ Full support | Requires HF model format; grammar compilation overhead; outlines dependency |
| **LM Studio** | OpenAI-compatible REST + WebSocket | ✓ Native + custom; remote MCP support | ✓ GGUF (llama.cpp grammar) + MLX (Outlines); JSON schema conversion | ✓ Full support | GUI-dependent for some config; context length quirks; two backends (GGUF vs MLX) |

**Summary:** Ollama is easiest entry; llama.cpp + vLLM are production-grade for local inference; SGLang excels at constrained decoding speed.

---

## 3. Capability Matrix

| Model | Tool Use | JSON Mode | Structured Output | Vision | 128k Ctx | 1M Ctx | Reasoning | Long Output | Code FIM | Fast Draft |
|-------|----------|-----------|-------------------|--------|----------|--------|-----------|------------|----------|-----------|
| **Claude Opus 4.7** | ✓ | ✓ | ✓ | ✓ (98.5% accuracy; 3x resolution) | ✓ | ✓ | ✓ (strong) | ✓ | Unknown | ✓ (xhigh effort) |
| **Claude Sonnet 4.6** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **GPT-5.5** | ✓ (97% fidelity) | ✓ | ✓ (strict + regex) | ✓ | ✓ | ✓ (1M) | ✓ | ✓ | Unknown | ✓ |
| **Gemini 2.5 Pro** | ✓ | ✓ | ✓ (strict enforcement) | ✓ | ✓ | ✓ (1M+) | ✓ | ✓ | Unknown | ✓ |
| **Grok-4 / 4.1** | ✓ | ✓ | Unknown | ✓ (v4+; real-time web) | ✓ | ✓ (2M; Grok 4 Fast) | ✓ (strong in 4.1) | ✓ | Unknown | ✓ |
| **Qwen2.5-Coder-32B** | Partial (instruction-tuned) | ✓ | Unknown | ✗ | ✓ (130k) | ✗ | ✓ (strong on math) | ✓ | ✓ | ✓ |
| **Llama 3.3 70B** | ✓ | ✓ | Unknown | ✗ | ✓ | ✗ | Partial | ✓ | ✓ | ✓ |
| **Mistral Large** | ✓ | ✓ | Unknown | ✗ | ✓ | ✗ | Partial | ✓ | ✓ | ✓ |
| **Phi-4** | Partial | ✓ | Unknown | ✗ | ✓ | ✗ | Partial (local optimized) | ✓ | ✓ | ✓ |
| **DeepSeek-V3** | ✓ (strong) | ✓ | Unknown | ✗ (v4 adds vision) | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ |

**Notes:** "Structured Output" = constrained decoding support on local runs; "Fast Draft" = speculative decoding / draft model support. Mark "Unknown" conservatively.

---

## 4. Tool-Use Fidelity Gap & Constrained Decoding

**The problem:** Smaller local models (< 30B) generate invalid tool-call JSON 5–15% of the time without constraints.

**State of constrained decoding (2024–2025):**

- **llama.cpp GBNF:** Robust; converts JSON schema → context-free grammar; ~50μs overhead per token (negligible); bottleneck is grammar size & startup.
- **Outlines (FSM):** Fast, widely integrated (TGI, MLX, LM Studio); O(1) token cost; limitation is precomputation memory & setup time for large schemas.
- **XGrammar:** Now default in vLLM 1.x; 100× acceleration via pushdown automaton; 2.21% invalid JSON rate on xgrammar, but beats Outlines.
- **llguidance (Guidance/LLGuidance):** Microsoft's Rust engine; fastest (50μs per token); 0.12% invalid JSON rate; supports arbitrary CFG; new in 2025.
- **SGLang:** Proprietary compressed FSM; supports regex, select, tools; strong for regex-constrained; tool support in development.
- **vLLM guided_choice / guided_regex / guided_json / guided_grammar:** Abstraction over backends; easy to swap (xgrammar → llguidance).

**Recommendation for Meridian:**
- **Cloud models (OpenAI, Anthropic, Gemini, Grok):** Use native tool definitions; they handle serialization.
- **Local models < 30B parameters:** Auto-enable constrained decoding on ALL tool calls.
- **Backend priority:** llguidance (0.12% error) → xgrammar (vLLM default) → GBNF (llama.cpp fallback).
- **Tool-call format:** Convert to model's native format; store schema alongside tool definition for grammar generation.

---

## 5. Concrete Recommendation

**Stack: Use Portkey 2.0 open-source gateway as the router transport, wrap it with a custom capability-matcher layer that implements tool-aware routing logic, use llguidance for constrained decoding on all local tool calls, and ship adapters in priority order: (1) Ollama + llama.cpp (easiest, widest model support), (2) vLLM (production performance), (3) SGLang (constrained decoding speed), (4) TGI (HF ecosystem), (5) LM Studio (user-friendly desktop).**

Rationale: Portkey already handles the multi-cloud boilerplate and has production pedigree (1T+ tokens/day); open-source core means no vendor lock-in. Custom router layer adds capability matching (tool-use, vision, context length, reasoning) and budget-aware model selection. llguidance is the fastest, most reliable constrained decoder; integrate it as a middleware interceptor on local tool calls. Ollama + llama.cpp are the rapid-feedback loop for developer testing; vLLM scales to production loads. This keeps the core platform cloud-neutral and avoids betting on any single provider's roadmap.

---

## 6. Open Questions

1. **Privacy tier enforcement:** How do we label models as "device-local," "self-hosted," "trusted-cloud" (e.g., AWS Bedrock on VPC), and "untrusted-cloud"? Who audits compliance? (Tentative: metadata tags on model definitions + gateway policy enforcer.)

2. **Prompt injection in tool definitions:** If an attacker can inject a tool schema, they can exfiltrate data via the tool_call JSON or cause model confusion. Do we sandbox tool schemas, version them, or use cryptographic signatures?

3. **Latency & cost tradeoff tuning:** The router must balance latency (route to a fast draft model locally) vs. cost (route to a cheaper cloud model) vs. quality (route to the best model). What's the decision tree? User-specified weights? Online learning from failure rates?

4. **Context-length degradation:** Many models claim 128k context but degrade past 32k. Should Meridian empirically measure max-useful context per model and advertise actual effective lengths, or trust provider specs?

5. **Streaming interruption & retries:** If a stream fails mid-generation (e.g., tool call starts but provider cuts off), can we replay to another provider? Or is streaming a one-shot bet?

6. **Tool-use JSON serialization across model APIs:** OpenAI uses `tool_calls` array with `name` + `arguments` JSON string; Claude uses XML `<tool_use>` blocks; Gemini uses `functionCall`. Should Meridian normalize to one wire format internally and translate per-provider, or pass through native formats and handle serialization at the application layer?

---

**Sources:**
- [LiteLLM GitHub](https://github.com/BerriAI/litellm)
- [LiteLLM Docs](https://docs.litellm.ai/docs/)
- [Portkey AI Gateway](https://portkey.ai/features/ai-gateway)
- [Portkey GitHub](https://github.com/Portkey-AI/gateway)
- [OpenRouter Tool Calling](https://openrouter.ai/docs/guides/features/tool-calling)
- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [Ollama Blog: Tool Support](https://ollama.com/blog/tool-support)
- [vLLM Guided Decoding](https://docs.vllm.ai/en/latest/features/structured_outputs/)
- [vLLM Tool Calling](https://docs.vllm.ai/en/latest/features/tool_calling/)
- [SGLang Documentation](https://docs.sglang.io/)
- [llama.cpp GBNF Grammar](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md)
- [LM Studio Structured Output](https://lmstudio.ai/docs/developer/openai-compat/structured-output)
- [LM Studio Tool Use](https://lmstudio.ai/docs/developer/openai-compat/tools)
- [TGI Guidance Support](https://huggingface.co/docs/text-generation-inference/en/basic_tutorials/using_guidance)
- [Claude Opus 4.7 Release](https://www.anthropic.com/news/claude-opus-4-7)
- [Claude Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [GPT-5 Structured Outputs](https://developers.openai.com/api/docs/guides/latest-model)
- [Gemini 2.5 Pro Features](https://blog.google/technology/developers/gemini-api-structured-outputs/)
- [Grok-4 Model Card](https://data.x.ai/2025-08-20-grok-4-model-card.pdf)
- [Qwen2.5-Coder Technical Report](https://arxiv.org/html/2409.12186v2)
- [DeepSeek-V3 Capabilities](https://www.bentoml.com/blog/the-complete-guide-to-deepseek-models-from-v3-to-r1-and-beyond)
- [XGrammar Paper](https://arxiv.org/pdf/2411.15100)
- [Constrained Decoding Benchmark](https://arxiv.org/html/2501.10868v1)
- [llguidance GitHub](https://github.com/guidance-ai/llguidance)
- [Helicone AI Gateway](https://www.helicone.ai/)
- [Portkey 2.0 Open Source Announcement](https://www.onenewspage.com/n/Press+Releases/1ztelp5rs6/Portkey-Gateway-is-Now-Fully-Open-Source.htm)
- [Ollama OpenAI Compatibility](https://docs.ollama.com/api/openai-compatibility)

