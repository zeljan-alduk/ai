/**
 * "Five things only ALDO does" — the differentiator section.
 *
 * One card per platform invariant, each with a tiny inline visual.
 * The cards SHOW the differentiator, not just claim it. Card layout:
 *
 *   ┌─────────────────────────────┐
 *   │ tiny-visual                 │
 *   │ Title                       │
 *   │ Why it matters              │
 *   │ Who else does this          │
 *   │ → Read the docs             │
 *   └─────────────────────────────┘
 *
 * All visuals are inline SVG / Tailwind primitives — no images, no
 * runtime libs. Server-rendered. Dark/light parity throughout via
 * semantic tokens.
 */

import Link from 'next/link';

const ENGINES: ReadonlyArray<{ name: string; sub: string }> = [
  { name: 'Ollama', sub: 'macOS / Linux daemon' },
  { name: 'vLLM', sub: 'GPU serving' },
  { name: 'llama.cpp', sub: 'C++ runtime' },
  { name: 'MLX', sub: 'Apple Silicon' },
  { name: 'LM Studio', sub: 'desktop app' },
];

export function FiveThings() {
  return (
    <section id="five-things" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-12 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Five things only ALDO does
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            The five platform invariants nobody else stacks.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            The agent space has dozens of products. None of them ship all of these. Below, the five
            lines we drew that the others didn&rsquo;t — each with the receipts.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          <FiveCard
            badge="01"
            title="Privacy router as platform invariant"
            why="Mark an agent sensitive once. The gateway physically refuses to route it to a cloud model — fail-closed at the edge, not on author discipline."
            who="LangSmith only sees the traffic. CrewAI calls this an author convention. We are the only platform that drops the request."
            href="/security"
            cta="See the security page →"
            visual={<PrivacyRouterVisual />}
          />
          <FiveCard
            badge="02"
            title="Cross-model step replay"
            why="Click any node in a checkpointed run, fork the step through any provider, side-by-side diff with cost + token deltas. Same input. Fresh route."
            who="LangGraph ships same-model time-travel. Cross-provider replay on the same trace is unique to ALDO."
            href="/runs"
            cta="Open the run viewer →"
            visual={<ReplayVisual />}
          />
          <FiveCard
            badge="03"
            title="Local models, first-class"
            why="Five real probes ship in-platform — Ollama, vLLM, llama.cpp, MLX, LM Studio — with per-model context-token discovery. Eval them next to a frontier model on the same agent spec."
            who="The closest peer ships one Ollama node. We ship five runtimes, all probed at boot."
            href="/models"
            cta="Browse models →"
            visual={<LocalModelsVisual />}
          />
          <FiveCard
            badge="04"
            title="Eval-gated promotion"
            why="Every agent declares a threshold + suite. A regression on the suite blocks the version from promoting. CI for agents — built in, not advisory."
            who="Eval libs exist everywhere. A runtime that refuses to ship a version that fell below 0.85 does not."
            href="/eval"
            cta="See an eval suite →"
            visual={<EvalGateVisual />}
          />
          <FiveCard
            badge="05"
            title="Git-synced agent specs"
            why="Connect a GitHub or GitLab repo. Specs in aldo/agents/*.yaml sync into your tenant on every push. Webhook-driven, idempotent, with a sync-attempt log."
            who="Net-new wedge — nobody else ships this. Specs live with your code, not in a vendor UI."
            href="/integrations/git"
            cta="Connect a repo →"
            visual={<GitSyncVisual />}
          />
          <li className="flex flex-col justify-between rounded-xl border border-dashed border-border bg-bg-subtle/50 p-6">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-fg-faint">
                +n more in flight
              </p>
              <p className="mt-3 text-[15px] leading-snug text-fg-muted">
                We ship something net-new every wave. Read the changelog or open the roadmap to see
                what&rsquo;s coming next — SSO/SAML, OCI Helm publish, bidirectional git sync.
              </p>
            </div>
            <div className="mt-5 flex flex-wrap gap-3 text-sm">
              <Link href="/changelog" className="font-medium text-accent hover:text-accent-hover">
                Changelog →
              </Link>
              <Link href="/about" className="font-medium text-fg-muted hover:text-fg">
                About us →
              </Link>
            </div>
          </li>
        </ul>
      </div>
    </section>
  );
}

function FiveCard({
  badge,
  title,
  why,
  who,
  href,
  cta,
  visual,
}: {
  badge: string;
  title: string;
  why: string;
  who: string;
  href: string;
  cta: string;
  visual: React.ReactNode;
}) {
  return (
    <li className="group flex flex-col rounded-xl border border-border bg-bg-elevated p-6 shadow-sm transition-all hover:border-border-strong hover:shadow-md">
      <div className="flex items-start justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-fg-faint">
          {badge}
        </span>
        <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
          unique
        </span>
      </div>
      <div className="mt-4 flex h-24 items-center justify-center rounded-lg border border-border bg-bg p-3">
        {visual}
      </div>
      <h3 className="mt-5 text-[16px] font-semibold leading-snug tracking-tight text-fg">
        {title}
      </h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">{why}</p>
      <p className="mt-2 text-[12px] leading-relaxed text-fg-faint">
        <span className="font-semibold uppercase tracking-wider">vs the field:</span> {who}
      </p>
      <Link
        href={href}
        className="mt-auto inline-flex pt-4 text-[13px] font-medium text-accent hover:text-accent-hover"
      >
        {cta}
      </Link>
    </li>
  );
}

// ─── Visuals ────────────────────────────────────────────────────────────

function PrivacyRouterVisual() {
  return (
    <svg
      viewBox="0 0 200 70"
      className="h-full w-full"
      role="img"
      aria-label="Privacy router flow diagram"
    >
      <title>Sensitive agent → router → cloud blocked, local allowed</title>
      <defs>
        <marker
          id="five-arr-1"
          viewBox="0 0 6 6"
          refX="5"
          refY="3"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M 0 0 L 6 3 L 0 6 z" className="fill-fg-faint" />
        </marker>
      </defs>
      {/* Sensitive agent node */}
      <rect
        x="6"
        y="26"
        width="44"
        height="18"
        rx="3"
        className="fill-danger/15 stroke-danger/40"
        strokeWidth="1"
      />
      <text x="28" y="38" textAnchor="middle" className="fill-danger text-[8px] font-semibold">
        sensitive
      </text>
      {/* Router box */}
      <rect
        x="76"
        y="22"
        width="48"
        height="26"
        rx="3"
        className="fill-bg-subtle stroke-border-strong"
        strokeWidth="1"
      />
      <text x="100" y="33" textAnchor="middle" className="fill-fg text-[8px] font-semibold">
        router
      </text>
      <text x="100" y="42" textAnchor="middle" className="fill-fg-muted text-[7px]">
        fail-closed
      </text>
      {/* Cloud (blocked) */}
      <rect
        x="150"
        y="6"
        width="44"
        height="18"
        rx="3"
        className="fill-bg-subtle stroke-border"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <text x="172" y="18" textAnchor="middle" className="fill-fg-faint text-[8px]">
        cloud
      </text>
      {/* X over cloud line */}
      <line x1="124" y1="29" x2="150" y2="15" className="stroke-danger" strokeWidth="1.2" />
      <text x="142" y="22" textAnchor="middle" className="fill-danger text-[10px] font-bold">
        ×
      </text>
      {/* Local (allowed) */}
      <rect
        x="150"
        y="46"
        width="44"
        height="18"
        rx="3"
        className="fill-success/15 stroke-success/40"
        strokeWidth="1"
      />
      <text x="172" y="58" textAnchor="middle" className="fill-success text-[8px] font-semibold">
        local
      </text>
      <line
        x1="124"
        y1="41"
        x2="150"
        y2="55"
        className="stroke-success"
        strokeWidth="1.2"
        markerEnd="url(#five-arr-1)"
      />
      {/* Ingress */}
      <line
        x1="50"
        y1="35"
        x2="76"
        y2="35"
        className="stroke-fg-faint"
        strokeWidth="1"
        markerEnd="url(#five-arr-1)"
      />
    </svg>
  );
}

function ReplayVisual() {
  return (
    <div className="grid w-full grid-cols-2 gap-2">
      <div className="rounded border border-border bg-bg-elevated p-1.5">
        <div className="flex items-center justify-between">
          <span className="rounded bg-bg-subtle px-1 py-px font-mono text-[8px] text-fg-muted">
            A · local
          </span>
          <span className="font-mono text-[8px] tabular-nums text-fg-faint">$0.001</span>
        </div>
        <div className="mt-1 space-y-0.5">
          <div className="h-1 w-full rounded-full bg-success/30" />
          <div className="h-1 w-3/4 rounded-full bg-success/30" />
          <div className="h-1 w-5/6 rounded-full bg-success/30" />
        </div>
      </div>
      <div className="rounded border border-warning/40 bg-warning/5 p-1.5">
        <div className="flex items-center justify-between">
          <span className="rounded bg-warning/15 px-1 py-px font-mono text-[8px] text-warning">
            B · frontier
          </span>
          <span className="font-mono text-[8px] tabular-nums text-fg-faint">$0.009</span>
        </div>
        <div className="mt-1 space-y-0.5">
          <div className="h-1 w-full rounded-full bg-warning/40" />
          <div className="h-1 w-4/5 rounded-full bg-warning/40" />
          <div className="h-1 w-2/3 rounded-full bg-warning/40" />
        </div>
      </div>
    </div>
  );
}

function LocalModelsVisual() {
  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-1">
      {ENGINES.map((e) => (
        <span
          key={e.name}
          title={e.sub}
          className="rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-[9px] text-fg"
        >
          {e.name}
        </span>
      ))}
    </div>
  );
}

function EvalGateVisual() {
  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <span className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[9px] font-semibold text-danger">
        regression blocked · 0.78
      </span>
      <span className="text-[10px] text-fg-faint">↓</span>
      <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[9px] font-semibold text-success">
        promotion approved · 0.91
      </span>
    </div>
  );
}

function GitSyncVisual() {
  return (
    <svg viewBox="0 0 200 70" className="h-full w-full" role="img" aria-label="Git sync flow">
      <title>Commits in repo → /agents view in ALDO</title>
      <defs>
        <marker
          id="five-arr-2"
          viewBox="0 0 6 6"
          refX="5"
          refY="3"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M 0 0 L 6 3 L 0 6 z" className="fill-accent" />
        </marker>
      </defs>
      {/* Commit dots */}
      <line x1="14" y1="35" x2="74" y2="35" className="stroke-border-strong" strokeWidth="1" />
      {[20, 35, 50, 65].map((x) => (
        <circle
          key={x}
          cx={x}
          cy="35"
          r="3.5"
          className="fill-bg-elevated stroke-fg-muted"
          strokeWidth="1.2"
        />
      ))}
      <text x="42" y="55" textAnchor="middle" className="fill-fg-faint text-[7px] font-mono">
        aldo/agents/*.yaml
      </text>
      {/* Arrow */}
      <line
        x1="80"
        y1="35"
        x2="118"
        y2="35"
        className="stroke-accent"
        strokeWidth="1.5"
        markerEnd="url(#five-arr-2)"
      />
      <text x="99" y="28" textAnchor="middle" className="fill-accent text-[7px] font-semibold">
        webhook
      </text>
      {/* Aldo agents view */}
      <rect
        x="124"
        y="18"
        width="68"
        height="34"
        rx="3"
        className="fill-bg-subtle stroke-border-strong"
        strokeWidth="1"
      />
      <text x="158" y="30" textAnchor="middle" className="fill-fg text-[8px] font-semibold">
        /agents
      </text>
      <line x1="132" y1="36" x2="184" y2="36" className="stroke-border" strokeWidth="0.7" />
      <line x1="132" y1="42" x2="170" y2="42" className="stroke-border" strokeWidth="0.7" />
      <line x1="132" y1="48" x2="178" y2="48" className="stroke-border" strokeWidth="0.7" />
    </svg>
  );
}
