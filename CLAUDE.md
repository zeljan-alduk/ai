# Meridian — working notes for agents

## Non-negotiable constraints

1. **LLM-agnostic.** No code path may hardcode a provider (OpenAI, Anthropic,
   Google, Ollama, vLLM, …). Everything goes through the model gateway.
   Agents declare **capabilities** they need; the gateway chooses a model.
   Switching providers must be a config change, never a code change.

2. **Local models are first-class.** Ollama, llama.cpp, vLLM, MLX, TGI must
   work out of the box. The eval harness must be able to compare a frontier
   model vs. a local model on the same agent spec.

3. **Privacy tiers are enforced by the platform.** An agent marked
   `privacy_tier: sensitive` must be physically incapable of reaching a
   cloud model — the router drops it, not the agent author.

4. **Agents are data.** Defined in YAML, versioned, eval-gated before
   promotion. No Python class hierarchy for agent types.

5. **Every run is replayable.** Full message/tool-call history checkpointed;
   any step can be re-executed with a different model.

6. **MCP is the tool standard.** Prefer MCP servers over bespoke tool code.

## Layout

See README.md.

## Reference agency

`agency/` contains the dogfood organization (principal, architect,
engineers, reviewers, …). Use it as the test case for every platform
feature: if the feature doesn't help Meridian Labs ship, we don't need it.
