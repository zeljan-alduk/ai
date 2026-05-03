# TODO

> Short-term punch list of items that need a deliberate touch.
> Larger horizon lives in [`PLANS.md`](./PLANS.md) (action-ordered)
> and [`ROADMAP.md`](./ROADMAP.md) (full backlog).
> Public-facing version: <https://ai.aldo.tech/roadmap>.

---

## Open dependabot PRs that need manual integration

Each of these is a major version bump that auto-merge would have
broken. They want a focused commit per PR (typecheck → fix surface →
run tests → ship).

| # | Bump | What to do | Risk |
|---|---|---|---|
| [#8](https://github.com/zeljan-alduk/ai/pull/8) | vitest 2.1.9 → 4.1.5 | Config + assertion shape; rerun all 1184 tests; expect a few `expect.any(Function)` / mock-shape changes. | medium |
| [#9](https://github.com/zeljan-alduk/ai/pull/9) | @biomejs/biome 1.9.4 → 2.4.13 | Rule renames + config schema breaking change. Run `pnpm biome migrate` then `pnpm biome check`. | medium |
| [#10](https://github.com/zeljan-alduk/ai/pull/10) | opentelemetry group | `@opentelemetry/api` ≥1.10 changed the SpanStatusCode enum location; check `platform/observability/src/*`. | medium |
| [#12](https://github.com/zeljan-alduk/ai/pull/12) | commander 12 → 14 | Option-parsing changes. Affects `apps/cli`. | low |
| [#15](https://github.com/zeljan-alduk/ai/pull/15) | typescript group | `tsc` lib defaults can flip thousands of inferred types. Run typecheck across all 9 packages. | high |
| [#17](https://github.com/zeljan-alduk/ai/pull/17) | next 15 → 16 | App Router + middleware shape changes. Will need to re-test every web e2e. | high |
| [#18](https://github.com/zeljan-alduk/ai/pull/18) | zod 3 → 4 | We have 50+ Zod surfaces (api-contract, billing, runs, agents, prompts, …). Schema shape changes. | high |
| [#14](https://github.com/zeljan-alduk/ai/pull/14) | hono 4.12.15 → 4.12.16 | Has **merge conflicts** with main — needs a rebase before we can decide. Patch bump, should be safe once rebased. | low |

**Suggested order**: low/medium first (#14 → #12 → #9 → #8 → #10),
then the high-risk ones one at a time (#15 → #18 → #17). Each on
its own commit so a regression is bisectable.

---

## Engine ↔ orchestrator: composite-spawn hangs

The wave-X bridge made leaf agents execute end-to-end against local
models. Composite agents (sequential / parallel / debate / iterative)
route correctly through the new simulator-merges-discovery path, but
the run sits in `queued` forever after the supervisor row is
created — the orchestrator never reports that the children started.

Where to look:
- `platform/engine/src/runtime.ts` — the composite branch in
  `runAgent()`, specifically the call to `orchestrator.runComposite()`.
  The `SupervisorRuntimeAdapter.spawnChild` wired in
  `apps/api/src/runtime-bootstrap.ts` doesn't appear to be reached.
- `platform/orchestrator/src/strategies/sequential.ts` — first
  strategy executed; instrument with logging to see whether it's
  awaiting an unresolved promise.
- The `setOrchestrator` call in `runtime-bootstrap.ts` runs after
  `new PlatformRuntime(…)`. Confirm the assignment lands (private
  field via the documented chicken-and-egg setter).
- The supervisor's `LeafAgentRun` may not flush `run.completed` until
  every child does — and a child that never starts blocks indefinitely.

Repro: run `local-pair` (composite of `local-summarizer` +
`local-reviewer`) against the local API with `qwen3:14b` available;
status sticks at `queued` past the 5-minute mark.

Reference agents to test against once fixed: `agency/direction/local-pair.yaml`
and the seeded `tech-lead` (after lowering its `200k-context` requirement
or once a 200k-context local model is in the catalog).

---

## Founder action items (only you can do these)

Already in [`PLANS.md`](./PLANS.md), restated for at-a-glance:

| | Item | Effort |
|---|---|---|
| 🔑 | **Stripe** — 5 GitHub secrets + dashboard products/prices/webhook | 1–2 hr → unlocks revenue |
| 🔑 | **PYPI_API_TOKEN, NPM_PUBLISH_TOKEN, VSCE_PAT** + Marketplace publisher account + screenshots | 2 hr → SDKs + extension public |
| 🌐 | **mcp.aldo.tech deploy** — DNS A record + edge nginx route + TLS + docker-compose entry for the `aldo-mcp-http` container that's already built and tested | 30 min |
| 📦 | **OCI Helm chart publish workflow** — one-shot `helm push aldo-ai-0.1.0.tgz oci://ghcr.io/aldo-tech-labs/charts` once ghcr credentials are wired | 1 hr |
| 🔐 | **Git OAuth-app registration** (GitHub + GitLab) — eliminates customer PAT minting in the wave-3 git integration | 2 hr |
| 📞 | **Operational fillers** — on-call number, VPS provider name (Hetzner?) for sub-processor list, edge nginx access-log path, scheduled `pg_dump` cron + offsite | ~3 hr cumulative |
| 👥 | **First paying customer outreach** — single highest-leverage move | weeks elapsed |

---

## Smaller engineering follow-ups (can be batched)

Items that aren't blocking anything but have a clear next-step:

- **Engine resolve `agent.promptRef`** (one-file follow-up in
  `@aldo-ai/registry` spec loader) — wave-4 prompts data + UI shipped;
  the engine still inlines prompt text instead of fetching from the
  prompts-store.
- **Production `PromptRunner` via the gateway** — the wave-4
  `/v1/prompts/:id/test` endpoint returns a deterministic stub
  today. Wire it through the real gateway with capability routing +
  privacy enforcement + telemetry into `usage_records`.
- **Background scanner picks up `runs.inputs_jsonb`** — the wave-X
  scanner that recovers orphaned queued runs respawns with empty
  inputs because the column doesn't exist. Migration that adds it +
  POST `/v1/runs` persists alongside the queued row + scanner reads
  it back.
- **cmdk fork-template direct fork** — today the wave-4 command
  palette's "Fork template…" sub-prompt navigates to `/gallery` for
  the user to click a card. Wiring it into the existing
  `POST /v1/gallery/fork` needs the gallery to expose a stable
  per-template id over the auth-proxy first.
- **Spend dashboard `date_trunc + GROUP BY` SQL pivot** — JS-side
  bucket fold beats 3 round-trips on pglite up to ~1M usage rows in
  a 90-day window. Pivot when the first tenant crosses that.
- **Per-row USD cost in eval-playground** — the playground table
  reserves the column today but reports `0` because the gateway
  doesn't surface per-call USD on the response.
- **Tag SQL CHECK constraint** on `runs.tags` — would prevent the
  occasional whitespace / uppercase tag from sneaking in. Defer until
  audit confirms zero historical violations in the seed data.
- **Real-cluster Helm e2e** (kind-in-CI smoke + per-cloud nightly)
  — chart lints + templates + kubeconforms green offline, but no
  live `helm install` validation.
- **Bidirectional git sync** — write agent edits in `/agents/[name]`
  back to the connected repo via PR. Net-new wedge — combined with
  the wave-3 read-only sync, the repo becomes the source of truth
  and ALDO is the IDE.
- **LM Studio capability inference** — the new wave-X
  `model-capabilities.ts` lookup keys on un-prefixed names like
  `qwen3`. LM Studio surfaces models as `qwen/qwen3-4b`; the
  publisher prefix should be stripped before the regex runs.
  Quick fix in `normaliseModelId`.

---

## Documentation gaps

- **`docs/local-llm-testing.md`** — already comprehensive but predates
  the API↔engine bridge + the `model-capabilities.ts` family inference.
  Add a "what to expect at runtime" section pointing at the new
  log lines (`[run-executor] runAgent resolved`, `[run-executor]
  bundle ready`, scheduler tick lines).
- **`docs/runbook.md`** — add the on-call number, VPS provider name,
  edge nginx access-log path placeholders once the founder fills them
  in.
- **`docs/data-retention.md`** — currently lists Hetzner as a guess;
  confirm + replace with the actual sub-processor name.
- **`/docs/guides/composite-agents.md`** — doesn't exist yet. Once
  the composite-spawn hang is fixed, write it: how to spec a
  composite, how the four strategies differ, how the cost roll-up
  works, how to debug via the run tree.
