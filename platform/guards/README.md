# @aldo-ai/guards

Prompt-injection defences for the ALDO AI gateway. Three layers, each
optional and configurable per-agent via the `tools.guards` block on the
agent.v1 spec:

1. **Spotlighting** — wraps any tool result fed back to a model in
   `<untrusted-content source="...">` delimiters and tells the model in
   the system prompt to never follow instructions inside such blocks.
2. **Output scanner** — regex tripwire for URLs to non-allowlisted hosts,
   long base64 blobs, prompt-leak markers (curated list — see
   `output-scanner.ts`) and excessive markdown link density.
3. **Dual-LLM quarantine** — large or suspect tool output is routed
   through a *separate* gateway call whose response is constrained to a
   JSON schema. The privileged model never sees the raw bytes.

The guards run as `GatewayMiddleware`. The middleware's `before` hook
intercepts inbound requests (where tool results live) and `after` runs
on every outbound delta. No code path here imports a provider SDK —
the quarantine call routes by capability class through the same
`ModelGateway`.
