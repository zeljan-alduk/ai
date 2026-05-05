/**
 * /changelog — public, curated changelog.
 *
 * Hand-curated. Update when something user-facing ships. The bar is
 * "would a customer or prospect care?" — internal refactors don't go
 * here. Date format is ISO; newest at the top.
 *
 * Why curated, not auto-generated: most commits are internal noise. A
 * good changelog is a product surface, not a git log dump.
 */

import Link from 'next/link';

export const metadata = {
  title: 'Changelog — ALDO AI',
  description: 'What we ship, week by week. Public. Updated on every meaningful release.',
};

interface Entry {
  readonly date: string;
  readonly title: string;
  /** A short paragraph in a customer-readable tone. */
  readonly body: string;
  readonly tag:
    | 'platform'
    | 'web'
    | 'sdk'
    | 'security'
    | 'docs'
    | 'ops'
    | 'mcp'
    | 'eval'
    | 'billing';
}

/**
 * Tag styling — semantic-token-tinted pills that flip with the theme.
 * Each pill uses a `bg-<role>/12 text-<role> ring-<role>/30` shape so
 * the same tokens that drive status pills elsewhere are reused here.
 */
const TAG_BADGE: Record<Entry['tag'], string> = {
  platform: 'bg-accent/12 text-accent ring-accent/30',
  web: 'bg-accent/12 text-accent ring-accent/30',
  sdk: 'bg-success/12 text-success ring-success/30',
  security: 'bg-danger/12 text-danger ring-danger/30',
  docs: 'bg-warning/12 text-warning ring-warning/30',
  ops: 'bg-fg-muted/15 text-fg-muted ring-border',
  mcp: 'bg-success/12 text-success ring-success/30',
  eval: 'bg-warning/12 text-warning ring-warning/30',
  billing: 'bg-fg-muted/15 text-fg-muted ring-border',
};

/**
 * NEWEST AT TOP. When you ship something user-facing, prepend a row
 * here and update apps/web/app/(marketing)/roadmap/page.tsx if it
 * removes or moves a roadmap item.
 */
const ENTRIES: ReadonlyArray<Entry> = [
  {
    date: '2026-05-06',
    tag: 'web',
    title: '/local-models — public, browser-direct LLM scanner + quality × speed bench',
    body:
      'New public surface at ai.aldo.tech/local-models. Probes 127.0.0.1 directly ' +
      'from the browser for any OpenAI-compatible LLM (Ollama, LM Studio, vLLM, ' +
      'llama.cpp), then runs an eight-case eval suite on the model you pick — ' +
      'pass/fail per case, TTFT, tokens, reasoning split, tok/s — streamed live ' +
      'as each case completes. Hosted API is not in the path: every byte is ' +
      "between the visitor's browser and 127.0.0.1, no signup, nothing leaves " +
      'localhost. Per-runtime probe-status strip with one-click CORS recipes ' +
      '(OLLAMA_ORIGINS / LM Studio toggle / vllm --allowed-origins / ' +
      'llama.cpp --http-cors-origin) for the runtimes that didn\'t respond. ' +
      'Capability chips on each discovered model (Vision / Tool Use / Reasoning ' +
      '/ Embedding) inferred from the id. Bench rows expand to show the full ' +
      "prompt, the expected condition, the model's actual output (with the " +
      'matched needle highlighted), the reasoning trace, and the evaluator ' +
      'detail. Hero CTA "Scan local models" on the marketing landing.',
  },
  {
    date: '2026-05-06',
    tag: 'platform',
    title: '`aldo bench --suite` — quality × speed model rating from the CLI',
    body:
      'CLI counterpart to the web /local-models flow. ' +
      '`aldo bench --suite local-model-rating --model <id>` fires the same ' +
      'eight cases at any OpenAI-compatible endpoint and prints a fixed-width ' +
      'ASCII table per case (case · pass · total · tok in/out · reason% · tok/s) ' +
      'plus a summary footer with pass-rate, avg tok/s, avg reasoning ratio, ' +
      'and p95 latency. Engine lives in @aldo-ai/bench-suite (workspace package) ' +
      'and is shared with the new POST /v1/bench/suite SSE API endpoint. ' +
      '`aldo models discover --scan` adds a curated ~60-port localhost sweep ' +
      'on top of the well-known LLM ports; `--exhaustive` walks 1024..65535. ' +
      'CORS posture documented in the local-models guide.',
  },
  {
    date: '2026-05-05',
    tag: 'eval',
    title: 'Agency dry-run unblocked at $0 — LM Studio probe stamps real `provides` + harness exits cleanly',
    body:
      'Two real findings from re-running the agency dry-run harness against ' +
      'LM Studio + qwen/qwen3.6-35b-a3b. (1) The LM Studio probe in ' +
      '@aldo-ai/local-discovery called `lookupCapabilities(id)` and stored the ' +
      'result, then ignored it and pushed `provides: ["streaming"]` hardcoded. ' +
      "ollama.ts had this right months ago; lmstudio.ts had drifted. One-line " +
      'fix; qwen3.6 / qwen3-4b now correctly tag tool-use + structured-output + ' +
      'reasoning + 128k-context. Added a Gemma-4 family rule too. (2) The ' +
      'live:network harness recorded a stage failure in <1s but kept the Node ' +
      'event loop alive for 10+ minutes because the spawned MCP server children ' +
      '(aldo-fs / aldo-shell / aldo-git / aldo-memory, all stdio-attached) ' +
      "didn't unref. Explicit `process.exit(r.ok ? 0 : 1)` in run-live-network.mjs. " +
      'After both fixes, the harness lands the failure in 5611ms and exits with ' +
      'code 1 cleanly — operators on CI no longer see a false 10-minute hang. ' +
      'One layer deeper of failure now visible (openai-compat `response_format: ' +
      "json_object` not accepted by LM Studio); captured on the roadmap.",
  },
  {
    date: '2026-05-05',
    tag: 'platform',
    title: 'aldo code — peer parity with Claude Code / Codex / Aider',
    body:
      'Eight new features across two commits land aldo CLI peer-of-Claude-Code: ' +
      '`@path` inline file references (every `@<relative-path>` in a brief expands ' +
      'to a fenced block with the file body — refuses absolute paths and `..` ' +
      'traversal, marks binary + oversize files), `/diff` (unified diff of session-' +
      'modified files via `git diff`), `/plan` + `/go` (the next turn drafts a ' +
      'numbered plan with no tool calls; `/go` clears the flag), status line ' +
      'with branch + plan-mode + model + cost, persistent shell session ' +
      '(`shell.cd` / `shell.pwd` / `shell.export` / `shell.unset` / `shell.env` — ' +
      'a subsequent `shell.exec` inherits the cwd + env, the way humans expect a ' +
      'shell to work), `/web <url>` (fetch + HTML strip + 256 KB cap into a system ' +
      'entry), `/mcp` (lists every tool the session has access to, grouped by ' +
      'server), `/task <agent> <brief>` (dispatches a focused subagent through ' +
      'the same supervisor as the main run), and a hooks system (' +
      '`~/.aldo/hooks.json` + `<workspace>/.aldo/hooks.json` with preRun / postRun ' +
      '/ preTool / postTool entries, env-injected ALDO_RUN_ID + ALDO_TOOL_NAME + ' +
      'ALDO_TOOL_ARGS_JSON + ALDO_TOOL_RESULT_JSON, failures log but never tear ' +
      'down a run). Smoked end-to-end against LM Studio + qwen/qwen3.6-35b-a3b: ' +
      '`/task` dispatched a subagent that returned a real code review of a ' +
      '`function add(a,b)` snippet flagging the type-coercion bug; `/plan` ' +
      'produced a 3-step numbered plan to add `divide(a,b)` to `@sum.ts`. ' +
      '225/225 cli tests + 1 skipped (was 184 baseline). 29/29 mcp-shell tests ' +
      '(was 22). Typecheck clean across both packages.',
  },
  {
    date: '2026-05-05',
    tag: 'platform',
    title: '`aldo run` + `aldo code` — live local-discovery merge + --model pin',
    body:
      'Two real CLI gaps closed. (1) The CLI bootstrap previously loaded only ' +
      'the YAML catalog; discovered models (Ollama / LM Studio / vLLM / llama.cpp ' +
      '/ MLX) never reached the gateway registry, so `aldo run` could only route ' +
      'to catalog rows. apps/api/src/runtime-bootstrap.ts had done the merge for ' +
      'months — this commit ports the same logic. `aldo run` (and `aldo code`) ' +
      'now go through `bootstrapAsync`, which probes local-discovery when ' +
      'ALDO_LOCAL_DISCOVERY is set, projects discovered rows into the ' +
      'RegisteredModel shape, and merges them with the catalog (catalog wins on ' +
      'id collision so explicit YAML stays authoritative). (2) `--model <id>` ' +
      'was parsed but never wired into the runtime — silently ignored. New ' +
      '`BootstrapOptions.pinModelId` filters the enabled-models list down to a ' +
      'single id before the registry is built; `aldo run --model X` and ' +
      '`aldo code --model X` both forward through. Tested end-to-end: ' +
      '`ALDO_LOCAL_DISCOVERY=lmstudio aldo run qwen-smoke --model ' +
      'qwen/qwen3.6-35b-a3b --inputs ' + "'{\"task\":\"reply ALIVE\"}'" + ' --json` → ' +
      '`{"ok":true,"output":"ALIVE","elapsedMs":7287}`. New `--models <path>` ' +
      'flag on both commands lets an operator filter the catalog when the ' +
      'shipped one ranks differently than they want.',
  },
  {
    date: '2026-05-05',
    tag: 'platform',
    title: 'Customer engagement surface — milestones, sign-off, change requests',
    body:
      'New API surface at /v1/engagements. Threads grouped runs by thread_id but lacked ' +
      'engagement-shaped semantics; the new endpoints add slugged engagements with ' +
      'status (active/paused/complete/archived), milestones with sign-off + reject + ' +
      'rejection reason captured, and threaded comments in three kinds (comment, ' +
      'change_request, architecture_decision). Sign-off pins the customer’s user id and ' +
      'a server timestamp so an audit trail exists for every approved milestone; ' +
      'rejecting a milestone is terminal (a fresh milestone is required for re-review) ' +
      'so the agency can’t silently re-sign work the customer already turned down. ' +
      'Tenant-scoped throughout. The customer-facing UI lands as a follow-up; the wire ' +
      'surface is complete and the platform owner can drive a friendly-first-customer ' +
      'engagement through it via REST today. 14 new tests; 568/568 apps/api green.',
  },
  {
    date: '2026-05-05',
    tag: 'platform',
    title: 'Telegram + Email integration channels — approval-from-anywhere',
    body:
      'Two new IntegrationRunners on the existing fan-out primitive. Telegram posts to ' +
      'api.telegram.org/bot/sendMessage with chat_id + MarkdownV2-formatted text ' +
      '(reserved chars escaped so a `.` or `(` never desyncs the parser; bot token ' +
      'never logged); hostname is locked. Email v0 supports Resend transactional API ' +
      'with Bearer auth + html + text bodies and a tags field carrying the event id ' +
      'for idempotency. New event kind `approval_requested` for the approval-gate ' +
      'fan-out so an operator can subscribe a Telegram bot and approve a run from ' +
      'their phone while away from a keyboard. Bot tokens + Resend api keys go ' +
      'through the same wave-7 secrets envelope so neither hits the DB in cleartext. ' +
      '11 new tests; 30/30 @aldo-ai/integrations green.',
  },
  {
    date: '2026-05-05',
    tag: 'platform',
    title: 'Hybrid CLI — `aldo run --route auto|local|hosted`',
    body:
      '`aldo run` now decides local-vs-hosted automatically by comparing the agent’s ' +
      'required capability classes against what local-discovery says is reachable. ' +
      'Local-only agents (privacy_tier: sensitive, capability_class: local-reasoning) ' +
      'stay on the user’s machine; cloud-tier agents delegate to ai.aldo.tech via REST ' +
      'when the user has set ALDO_API_TOKEN. `--route hosted` and `--route local` ' +
      'override the auto rule with a typed error if the requested side can’t serve ' +
      '(no ALDO_API_TOKEN, etc.). The hosted runner is a thin REST wrapper around ' +
      'POST /v1/runs + GET /v1/runs/:id polling; transient poll non-200s log to stderr ' +
      'without killing the run; HostedRunTimeoutError fires when the run never reaches ' +
      'a terminal status. The agency primitive is now reachable from a user’s laptop ' +
      'without re-implementing the orchestrator on the client side. 18 new tests.',
  },
  {
    date: '2026-05-05',
    tag: 'platform',
    title: 'Engagement-level budget cap — hard ceiling for unsupervised runs',
    body:
      'Per-run caps (modelPolicy.budget.usdMax) bound a single iterative loop. An ' +
      'unsupervised agency engagement spans 100+ runs across the supervisor’s ' +
      'composite tree; a stuck loop on a frontier model can burn $200 overnight if no ' +
      'tenant-level ceiling fires. New `tenant_budget_caps` table with per-tenant USD ' +
      'ceiling, optional rolling-window start, and hard-stop vs soft-cap toggle. POST ' +
      '/v1/runs now refuses dispatch with HTTP 402 tenant_budget_exceeded when the cap ' +
      'is reached (capUsd + totalUsd in the error envelope). Soft caps fire the ' +
      'existing budget_threshold notification without terminating in-flight runs. New ' +
      'GET/PUT /v1/tenants/me/budget-cap endpoints; usdMax: null clears the ceiling. ' +
      '12 new tests.',
  },
  {
    date: '2026-05-05',
    tag: 'eval',
    title: 'Live:network agency dry-run — operator-invokable, $0 against local Ollama',
    body:
      '§13 / item 5.5b finished closing: `runDryRun({mode: \'live:network\'})` now ' +
      'produces a real signal against any provider the operator has configured, ' +
      'including local Ollama (free). Three harness gaps fixed during dogfood: cache ' +
      'poisoning between sibling tests, undefined runStoreCount in failure paths, no ' +
      'programmatic failureReason. New apps/api/tests/agency-dry-run/run-live-network.mjs ' +
      'operator script prints the post-mortem and a tail line with ' +
      'ok / runStoreCount / failureReason / spawn count. The smoke is env-gated by ' +
      'ALDO_DRY_RUN_LIVE=1 so CI never burns inference. The agency primitive ships in ' +
      'three forms (stub / live no-network / live:network) and the harness is now ' +
      'instrumented enough to find what’s wrong with a real dispatch instead of ' +
      'crashing on its own internals.',
  },
  {
    date: '2026-05-04',
    tag: 'platform',
    title: 'aldo code — interactive coding TUI for the iterative loop',
    body:
      'New CLI subcommand pairing `IterativeAgentRun` with a Claude-Code-style ink TUI. ' +
      '`aldo code --tui [brief]` boots a multi-turn shell with streaming conversation, ' +
      'inline tool tiles for fs.read/write + shell.exec (⟳ pending / ✓ ok / ✕ error), ' +
      'modal approval dialogs for `tools.approvals: always` calls (a/r/v keybinds), ' +
      'slash commands (/help /clear /save <path> /model /tools /exit), ' +
      'and cross-session resume via `aldo code --tui --resume <thread-id>` ' +
      'backed by JSON sidecars at ~/.aldo/code-sessions/. ' +
      'Headless mode (`aldo code "brief"`) streams RunEvents as JSONL for scripting + CI. ' +
      'Synthetic AgentSpec built per-invocation; default tool ACL is the full coding kit; ' +
      '--tools narrows; refs outside the platform vouch-list are silently dropped. ' +
      '93 vitest cases (parser, reducer, render snapshots, persistence round-trip) + 1 gated smoke. ' +
      'See docs/guides/aldo-code.md.',
  },
  {
    date: '2026-05-04',
    tag: 'web',
    title: 'Assistant chat panel + /runs/[id] — tool tiles + approval banner',
    body:
      'The floating assistant panel now renders the new `tool` SSE frame inline as ' +
      'collapsible tiles between user message and assistant reply, preserving the ' +
      'chronological "user → tool → assistant text" order. ' +
      'On /runs/[id], a yellow banner surfaces every pending approval with one-click ' +
      'Approve and reason-required Reject buttons; the running-status redirect to ' +
      '/live skips when there are pending approvals so the approver lands on the ' +
      'page they need. 4-second polling while pending; refreshes the cycle tree on ' +
      'resolution. Closes the user-visible loop on §10 (assistant retarget) and #9 ' +
      '(approval gates).',
  },
  {
    date: '2026-05-04',
    tag: 'platform',
    title: 'Assistant retargeted onto IterativeAgentRun — tool calls in chat',
    body:
      '/v1/assistant/stream now drives the synthetic `__assistant__` agent against ' +
      'the iterative loop instead of a stub gateway call. The chat panel can answer ' +
      'questions by calling read-only fs tools (fs.read/list/search/stat) when ' +
      'ASSISTANT_TOOLS is enabled. Default tool ACL is read-only; operators opt into ' +
      'write/exec via the env var; refs not in the vouch-list silently dropped. SSE ' +
      'wire backward-compat: `delta` and `done` frames unchanged; new `tool` frame ' +
      'for tool calls (older clients ignore unknown types). Each chat turn is a real ' +
      'Run row replayable via /runs/[id] with the §9 cycle tree. 34 vitest cases ' +
      '(spec builder, frame translator, chat-shape engine integration).',
  },
  {
    date: '2026-05-04',
    tag: 'platform',
    title: 'Approval gates + frontier-coding capability (Sprint 3)',
    body:
      'New engine primitive: `tools.approvals: always` on an agent spec suspends the ' +
      'iterative loop on every gated tool call until an out-of-band approver resolves. ' +
      'Three new API routes (GET /v1/runs/:id/approvals, POST /approve, POST /reject); ' +
      'fail-closed on misconfiguration (no controller wired → synthetic rejection so ' +
      'a destructive tool can never silently dispatch). Plus a new `coding-frontier` ' +
      'capability class on the gateway: agents that require it route to Claude Opus / ' +
      'Sonnet / GPT-5 / Gemini-2.5-Pro (whichever the tenant has keys for) and refuse ' +
      'to fall back to local — local models deliberately do not advertise the ' +
      'capability so the platform can never silently downgrade a frontier-coding ' +
      'contract. 31 vitest cases.',
  },
  {
    date: '2026-05-04',
    tag: 'platform',
    title: 'IterativeAgentRun — the leaf-loop primitive (MISSING_PIECES §9)',
    body:
      'New engine primitive: agents declare an `iteration:` block with maxCycles, ' +
      'contextWindow, summaryStrategy (rolling-window | periodic-summary), and ' +
      'declarative termination conditions (text-includes | tool-result | ' +
      'budget-exhausted). The runtime drives a per-cycle loop — model call → parallel ' +
      'tool dispatch via Promise.all → maybe-compress history at 80% utilisation → ' +
      'next cycle. Per-cycle events (cycle.start, model.response, tool.results, ' +
      'history.compressed) round-trip through the run store; /runs/[id] gains a ' +
      'collapsible cycle tree replay UI. Reference agent: ' +
      'agency/development/local-coder-iterative.yaml drives an end-to-end smoke that ' +
      'writes a real .ts file + runs printf "tsc OK" to terminate via tool-result. ' +
      'Eval rubric extracts { text, finalToolResult, cycles, terminatedBy } from an ' +
      'iterative run for the existing string-based evaluators (contains / regex / ' +
      'rubric / llm_judge). 68 vitest cases.',
  },
  {
    date: '2026-05-03',
    tag: 'platform',
    title: 'API ↔ engine bridge — agent runs actually execute end-to-end',
    body: 'POST /v1/runs no longer just persists a queued row and stops. The route now drives the engine in-process: privacy-tier router decides → run row pre-recorded with a pinned id → executor fires → live local-discovery merges Ollama / vLLM / llama.cpp / LM Studio / MLX into the gateway → completion streams back → events land on the same row /v1/runs/:id is polling. Composite orchestrator (sequential / parallel / debate / iterative supervisors) wired into the runtime; MCP toolHost backed by the in-repo aldo-fs server (lazy stdio spawn); background scanner picks up orphaned queued runs every 30s; lastModel / lastProvider / total cost project from a real usage_records mirror. Default ON — explicit `false` disables.',
  },
  {
    date: '2026-05-03',
    tag: 'docs',
    title: 'Local-LLM testing recipe — Ollama + LM Studio against ALDO',
    body: 'docs/local-llm-testing.md: two paths. (A) local dev — `pnpm --filter @aldo-ai/api dev` with ALDO_LOCAL_DISCOVERY=ollama,lmstudio reaches your existing engines at the default ports, no internet exposure. (B) hosted tunnel — cloudflared (with `--http-host-header localhost:11434` for Ollama) exposes local engines so prod ALDO can call into your laptop. Includes a standalone scripts/local-llm-demo.ts that proves the gateway adapter against either backend in one command, plus a Playwright spec covering both paths.',
  },
  {
    date: '2026-05-03',
    tag: 'web',
    title: 'Landing page — three iterations of depth (16 new sections)',
    body: '"Five things only ALDO does" platform-invariant cards with inline SVG flows; "Define an agent in 8 lines" Python/TypeScript/YAML tabs; CSS-keyframe replay-across-models loop; Built-for-Engineer/PM/SRE personas; honest 19-row × 4-col comparison table; 8-card MCP integrations grid with copy-config; six annotated product surface mockups (flame graph, eval playground, N-way compare, prompts editor, spend dashboard, status page); ecosystem grid for every model + protocol + client; 30-second CLI quickstart terminal; built-in-the-open with last-7-commits timeline; pricing teaser; resource hub; honest compliance posture; FAQ; sticky scroll-rail nav; 4-column footer sitemap; founder story; hero dashboard cycle. First Load JS: 116 kB.',
  },
  {
    date: '2026-05-03',
    tag: 'web',
    title: 'Wave-4 frontend — prompts, threads, sharing, ⌘K, N-way compare, tags, spend',
    body: 'Prompts as first-class data with version history + diff + playground (closes Vellum + LangSmith Hub). Threads view groups runs by thread_id with chat-style transcripts. Inline thumbs / comments on runs + public read-only /share/<slug> links. /runs/compare extended to 6 simultaneous runs with stack-bar charts and median-deviation diff highlighting. Tag-based search + filter sheet on /runs (status pills, time presets, model + tag pickers, inline tag editor). Cost / spend dashboard at /observability/spend with budget alerts + CSV export. Linear-style ⌘K command palette across every surface, with g-prefix chord shortcuts (g a, g r, g e, g p, g d, g s) and a `?` overlay.',
  },
  {
    date: '2026-05-02',
    tag: 'platform',
    title: 'Wave-3 — net-new wedges + half-shipped backends finished',
    body: 'Git integration (read-only sync from a customer GitHub/GitLab repo into the agent registry — net-new vs the field). Hosted MCP HTTP/SSE transport so any HTTP-only client (ChatGPT, Cursor) can drive ALDO via mcp.aldo.tech. Eval scorer playground with picker + per-row scores + aggregate panel + score histogram (closes Braintrust). Per-template fork on /gallery (closes AutoGen-Studio + CrewAI). Self-host Helm chart + Terraform modules for AWS/GCP/Azure (closes LangSmith Self-Hosted, real artifacts not marketing copy). Retention enforcement job actually deletes old runs per plan policy (turns docs/data-retention.md from policy into reality). Per-model effectiveContextTokens lookup table replaces the hardcoded 8192. Real DB ping in /api/health (was inferred). Leaf-only termination conditions enforced at the engine.',
  },
  {
    date: '2026-05-02',
    tag: 'platform',
    title: 'Wave-MVP ship-readiness — license, projects, termination, MCP introspection',
    body: 'License canonicalised to FSL-1.1-ALv2 across the repo. project_id retrofit on agents + runs (multi-team isolation lights up; project picker in the sidebar). Termination conditions wired into the supervisor orchestrator (maxTurns / maxUsd / textMention / successRoles + `run.terminated_by` event). MCP tool inputSchema introspection in the engine (no more `{type:"object"}` placeholders — real schemas pulled from each connected server). Stripe checkout gap-filled — backend was 90% built; the dead pricing CTAs now mint real test-mode checkout sessions when STRIPE_* env is configured. Architecture diagram a11y violation fixed at three call sites. SDKs (Python + TypeScript) and the VS Code extension hardened for publish; release workflows have confirm-version guards.',
  },
  {
    date: '2026-05-02',
    tag: 'ops',
    title: 'In-house status page at /status (no vendor)',
    body: 'Polls the API + web + database every 30s; 30-day incident history backed by a JSON file in the repo (commit-driven publishing via ISR). Architecture-diagram a11y fix at three call sites; axe ACKNOWLEDGED_VIOLATION_IDS tightened to the colour-contrast carve-out only. Linked from the marketing footer + the /docs sidebar.',
  },
  {
    date: '2026-05-02',
    tag: 'docs',
    title: 'Operational docs — runbook, retention, support intake',
    body: 'docs/runbook.md (deploy + rollback, 5xx triage, DB restore, on-call decision tree). docs/data-retention.md (storage categories, tiered defaults, deletion SLA, sub-processor list, GDPR posture). docs/support-intake.md (P0–P3 triage matrix, SLA wording per plan, escalation chain). PROGRESS.md + PLANS.md indexed at the repo root.',
  },
  {
    date: '2026-04-27',
    tag: 'web',
    title: 'New landing page, sales kit, and pitch deck',
    body: 'Marketing surface gets a code-first hero, an inline architecture diagram, and a trust strip with verticals (no fake logos). Three /vs/* comparison pages (CrewAI, LangSmith, Braintrust) ship side-by-side. Customer-facing /sales/one-pager, /sales/overview, and /deck routes added — same talking points, three formats. ⌘P-friendly print stylesheets on each.',
  },
  {
    date: '2026-04-27',
    tag: 'ops',
    title: 'Self-hosted at ai.aldo.tech with auto-deploy on every push',
    body: 'Production now runs on our own VPS instead of Fly + Vercel — coexisting with the existing edge nginx proxy on the same host (it stays untouched). Every push to main or our active dev branch fires a GitHub Actions workflow that calls a token-gated webhook on the VPS to git fetch + rebuild + redeploy in under five minutes. The operator is no longer in the deploy loop.',
  },
  {
    date: '2026-04-26',
    tag: 'security',
    title: 'CodeQL pass: XSS, ReDoS, TOCTOU, and modulo-bias fixes',
    body: 'Eleven CodeQL findings triaged across the docs renderer (sanitize-html with explicit allowlists), the share-slug generator (rejection sampling instead of mod), the markdown URL regex (length-bounded), and the file readers in the FS MCP server (open + handle.stat instead of stat + read).',
  },
  {
    date: '2026-04-25',
    tag: 'platform',
    title: 'Custom domains, per-tenant quotas, and distributed rate-limiting (wave 16)',
    body: 'Bring-your-own domain support for hosted tenants. Per-tenant quotas (runs/month, dataset rows, secrets) configurable per plan. Postgres-advisory-lock token-bucket rate limiter applied to the runs API and playground for fair-share between tenants on shared deployments.',
  },
  {
    date: '2026-04-22',
    tag: 'platform',
    title: 'Replayable run tree + per-node model swap',
    body: 'Every run, every supervisor node, every tool call is now checkpointed. Re-execute any step against a different model — the run-compare view shows token-by-token diffs and the cost rollup at every node.',
  },
  {
    date: '2026-04-20',
    tag: 'platform',
    title: 'Privacy-tier router fails closed',
    body: 'Agents tagged privacy_tier: sensitive can no longer dispatch to a cloud-class model — the router refuses before the gateway ever calls a provider. Every blocked attempt is a row in the audit log with the reason. This is the architectural commitment most competitors cannot match without a rewrite.',
  },
  {
    date: '2026-04-18',
    tag: 'platform',
    title: 'Local-model auto-discovery — Ollama, vLLM, llama.cpp, LM Studio, MLX',
    body: 'On boot the gateway probes the well-known local ports for each runtime and merges what it finds into the model registry. The eval harness then compares local vs frontier on the same agent spec — model choice becomes data-driven instead of vibes-driven.',
  },
  {
    date: '2026-04-15',
    tag: 'sdk',
    title: 'Python and TypeScript SDKs + CLI',
    body: 'aldo-ai (Python) and @aldo-ai/sdk (TypeScript) ship the same shape: typed clients for runs, agents, evals, datasets, secrets. The aldo CLI bundles run / eval / dataset commands plus a one-shot tenant-bootstrap. VS Code extension wires the CLI into the editor.',
  },
  {
    date: '2026-04-12',
    tag: 'platform',
    title: 'Multi-agent supervisors: sequential, parallel, debate, iterative',
    body: 'Four supervisor strategies built into the orchestrator. Each composes deterministically — the cost rollup at the root of the run tree always sums what every leaf actually consumed.',
  },
  {
    date: '2026-04-08',
    tag: 'eval',
    title: 'Eval-gated promotion',
    body: 'Agent specs declare a threshold + rubric. Re-promotion to the active version is blocked if the eval score regresses. The same rubric runs in CI and in production — one source of truth, no review-as-vibes.',
  },
  {
    date: '2026-04-04',
    tag: 'security',
    title: 'Sandboxed tool execution + prompt-injection scanner',
    body: 'Every MCP tool call runs through process isolation, a prompt-injection spotlighter (suspicious instructions in tool output get quarantined), and an output scanner before the result reaches the agent.',
  },
  {
    date: '2026-04-01',
    tag: 'docs',
    title: 'Public docs site at /docs with searchable index',
    body: 'Markdown-rendered docs, in-page TOC, full-text search index built at compile time. Concepts (agency, agents, supervisors, evals, privacy tiers) plus reference for the SDKs and the API.',
  },
];

export default function ChangelogPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <header className="border-b border-border pb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Changelog
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          What we ship.
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-fg-muted">
          Public, curated. Updated on every meaningful release. Ships fast — we&rsquo;re a small
          team that does big-team things by doing them often.
        </p>
        <p className="mt-3 text-sm text-fg-muted">
          See what&rsquo;s coming next on the{' '}
          <Link href="/roadmap" className="text-accent underline-offset-2 hover:underline">
            roadmap
          </Link>
          .
        </p>
      </header>

      <ol className="mt-10 space-y-10">
        {ENTRIES.map((e) => (
          <li
            key={`${e.date}-${e.title}`}
            className="grid grid-cols-1 gap-3 sm:grid-cols-[7rem,1fr] sm:gap-6"
          >
            <div className="font-mono text-[12px] text-fg-faint sm:pt-1.5">{e.date}</div>
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[16px] font-semibold tracking-tight text-fg">{e.title}</h2>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${TAG_BADGE[e.tag]}`}
                >
                  {e.tag}
                </span>
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{e.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <footer className="mt-16 rounded-xl border border-border bg-bg-elevated p-6">
        <h3 className="text-[15px] font-semibold tracking-tight text-fg">Want to be notified?</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
          Sign up to the digest at the bottom of the{' '}
          <Link href="/" className="text-accent underline-offset-2 hover:underline">
            homepage
          </Link>
          , or email{' '}
          <a className="text-accent underline-offset-2 hover:underline" href="mailto:info@aldo.tech">
            info@aldo.tech
          </a>
          .
        </p>
        <Link
          href="/signup"
          className="mt-4 inline-flex rounded bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90"
        >
          Try the trial →
        </Link>
      </footer>
    </article>
  );
}
