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
