/**
 * Hero secondary visual — auto-cycling 3-frame dashboard mockup.
 *
 * Wave-iter-3 — augments the existing HeroCodeSnippet (don't replace).
 * Sits below the snippet on lg+, hidden on mobile to keep the hero
 * fold compact on small viewports (the existing HeroCodeSnippet is
 * already the LCP and needs to stay that way).
 *
 * Three frames, ~6s each, looped via pure-CSS keyframes (no JS, no
 * intersection observer, no animation lib). All three frames are
 * stacked absolutely; opacity transitions trade them in / out.
 *
 *   Frame 1 (0–6s): tiny `/runs` list with 5 rows (status pills, costs)
 *   Frame 2 (6–12s): tiny flame graph (3 horizontal bars; pulse on active)
 *   Frame 3 (12–18s): "Replay this step with capability=fast-local"
 *                     button glowing → split-pane preview
 *
 * `prefers-reduced-motion: reduce` collapses the cycle to a static
 * end-state (frame 3 visible, no opacity transitions, no pulse).
 */

export function HeroDashboardCycle() {
  return (
    <div
      className="aldo-hero-cycle relative hidden h-[210px] w-full overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-lg lg:block"
      aria-label="Animated platform dashboard preview"
    >
      {/* Faux window chrome — matches the snippet aesthetic. */}
      <div className="flex items-center gap-2 border-b border-border bg-bg-subtle px-3 py-1.5">
        <span aria-hidden className="h-2 w-2 rounded-full bg-rose-500/50" />
        <span aria-hidden className="h-2 w-2 rounded-full bg-amber-500/50" />
        <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500/50" />
        <span className="ml-2 truncate font-mono text-[10px] text-fg-muted">ai.aldo.tech</span>
        {/* Frame indicator dots — sync to the same 18s loop. */}
        <span className="ml-auto flex items-center gap-1" aria-hidden>
          <span className="aldo-hero-cycle-dot aldo-hero-cycle-dot-1 h-1.5 w-1.5 rounded-full bg-fg-faint" />
          <span className="aldo-hero-cycle-dot aldo-hero-cycle-dot-2 h-1.5 w-1.5 rounded-full bg-fg-faint" />
          <span className="aldo-hero-cycle-dot aldo-hero-cycle-dot-3 h-1.5 w-1.5 rounded-full bg-fg-faint" />
        </span>
      </div>
      <div className="relative h-[170px] w-full">
        <Frame1RunsList />
        <Frame2FlameGraph />
        <Frame3ReplayButton />
      </div>
    </div>
  );
}

// ─── Frame 1 — /runs list ─────────────────────────────────────────────────

function Frame1RunsList() {
  const rows = [
    { agent: 'security-auditor', status: 'ok' as const, cost: '$0.024', when: '12s' },
    { agent: 'code-reviewer', status: 'ok' as const, cost: '$0.011', when: '38s' },
    { agent: 'planner', status: 'pending' as const, cost: '—', when: '1m' },
    { agent: 'doc-writer', status: 'ok' as const, cost: '$0.004', when: '2m' },
    { agent: 'security-auditor', status: 'failed' as const, cost: '$0.018', when: '4m' },
  ];
  const PILL: Record<(typeof rows)[number]['status'], string> = {
    ok: 'border-success/40 bg-success/10 text-success',
    pending: 'border-warning/40 bg-warning/10 text-warning',
    failed: 'border-danger/40 bg-danger/10 text-danger',
  };
  return (
    <div className="aldo-hero-frame aldo-hero-frame-1 absolute inset-0 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-fg">
          /runs
        </span>
        <span className="font-mono text-[9px] text-fg-faint">5 most recent</span>
      </div>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li
            key={`${r.agent}-${i}`}
            className="flex items-center justify-between gap-2 rounded border border-border bg-bg px-2 py-1"
          >
            <span className="truncate font-mono text-[10px] text-fg">{r.agent}</span>
            <span className="flex items-center gap-2">
              <span
                className={`rounded-full border px-1.5 py-px text-[8.5px] font-semibold uppercase tracking-wider ${PILL[r.status]}`}
              >
                {r.status}
              </span>
              <span className="w-12 text-right font-mono text-[9px] tabular-nums text-fg-muted">
                {r.cost}
              </span>
              <span className="w-7 text-right font-mono text-[9px] text-fg-faint">{r.when}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Frame 2 — flame graph ────────────────────────────────────────────────

function Frame2FlameGraph() {
  return (
    <div className="aldo-hero-frame aldo-hero-frame-2 absolute inset-0 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-fg">
          /runs/abc — flame graph
        </span>
        <span className="font-mono text-[9px] text-fg-faint">14.2s · $0.024</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-20 text-right font-mono text-[8.5px] text-fg-muted">orchestrator</span>
          <div className="relative h-3 flex-1 rounded-sm bg-bg-subtle/60">
            <div className="absolute inset-y-0 left-0 right-0 rounded-sm bg-accent/55" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-right font-mono text-[8.5px] text-fg-muted">planner</span>
          <div className="relative h-3 flex-1 rounded-sm bg-bg-subtle/60">
            <div
              className="absolute inset-y-0 left-[6%] rounded-sm bg-warning/65"
              style={{ width: '34%' }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-right font-mono text-[8.5px] text-fg-muted">reviewer</span>
          <div className="relative h-3 flex-1 rounded-sm bg-bg-subtle/60">
            <div
              className="aldo-hero-active-span absolute inset-y-0 left-[44%] rounded-sm bg-success/55"
              style={{ width: '40%' }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-right font-mono text-[8.5px] text-fg-muted">tool: fs</span>
          <div className="relative h-3 flex-1 rounded-sm bg-bg-subtle/60">
            <div
              className="absolute inset-y-0 left-[12%] rounded-sm bg-fg-muted/40"
              style={{ width: '8%' }}
            />
            <div
              className="absolute inset-y-0 left-[48%] rounded-sm bg-fg-muted/40"
              style={{ width: '6%' }}
            />
            <div
              className="absolute inset-y-0 left-[72%] rounded-sm bg-fg-muted/40"
              style={{ width: '11%' }}
            />
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[8px] text-fg-faint">
        <span>0s</span>
        <span>7s</span>
        <span>14s</span>
      </div>
    </div>
  );
}

// ─── Frame 3 — Replay button → split-pane preview ─────────────────────────

function Frame3ReplayButton() {
  return (
    <div className="aldo-hero-frame aldo-hero-frame-3 absolute inset-0 flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-fg">
          step #4 · checkpoint
        </span>
        <span className="font-mono text-[9px] text-fg-faint">capability swap</span>
      </div>
      <div className="aldo-hero-replay-btn rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-center font-mono text-[11px] font-semibold text-accent">
        ↻ Replay with capability=fast-local
      </div>
      <div className="grid flex-1 grid-cols-2 gap-2 pt-1">
        <div className="rounded-md border border-border bg-bg p-2">
          <div className="flex items-center justify-between">
            <span className="rounded border border-warning/40 bg-warning/10 px-1 py-px font-mono text-[8px] text-warning">
              before · frontier
            </span>
            <span className="font-mono text-[8.5px] tabular-nums text-fg-muted">$0.0094</span>
          </div>
          <div className="mt-1.5 space-y-1">
            <div className="h-1 w-full rounded-full bg-warning/30" />
            <div className="h-1 w-4/5 rounded-full bg-warning/30" />
            <div className="h-1 w-3/4 rounded-full bg-warning/30" />
          </div>
        </div>
        <div className="rounded-md border border-success/30 bg-success/5 p-2">
          <div className="flex items-center justify-between">
            <span className="rounded border border-success/40 bg-success/10 px-1 py-px font-mono text-[8px] text-success">
              after · local
            </span>
            <span className="font-mono text-[8.5px] tabular-nums text-success">$0.0011</span>
          </div>
          <div className="mt-1.5 space-y-1">
            <div className="h-1 w-full rounded-full bg-success/40" />
            <div className="h-1 w-5/6 rounded-full bg-success/40" />
            <div className="h-1 w-4/5 rounded-full bg-success/40" />
          </div>
        </div>
      </div>
    </div>
  );
}
