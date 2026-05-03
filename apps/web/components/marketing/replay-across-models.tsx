/**
 * "Replay across models" — animated mockup of the cross-model replay
 * flow. Pure CSS keyframes — no JS, no animation lib.
 *
 * Sequence (8s loop):
 *   t=0   run streams left-to-right, 5 events appear
 *   t=3   the 4th event glows (the fork point)
 *   t=4   a second lane forks below, streams its own events
 *   t=6   side-by-side diff card fades in
 *   t=8   loops
 *
 * `prefers-reduced-motion: reduce` collapses the animation to its
 * end-state (everything visible, no motion).
 */

import Link from 'next/link';

export function ReplayAcrossModels() {
  return (
    <section id="replay" className="border-t border-border bg-bg-elevated">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-10 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Replay across models
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            Click a step. Fork it through any provider. See the diff.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            Every run is a sequence of checkpoints. Click any step in{' '}
            <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px] text-fg">
              /runs/[id]
            </code>
            , pick a different provider, and the platform reroutes from that point with the same
            input. Side-by-side diff appears below the run tree. LangGraph ships same-model
            time-travel — we go cross-model.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-bg p-4 shadow-sm sm:p-6 aldo-replay-stage">
          {/* Lane A — original run */}
          <div className="relative">
            <div className="flex items-baseline justify-between text-[11px] uppercase tracking-wider text-fg-muted">
              <span className="flex items-center gap-2">
                <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 normal-case tracking-normal text-success">
                  ollama / llama-3.1-70b
                </span>
                <span className="font-mono text-fg-faint">run_abc · lane A</span>
              </span>
              <span className="font-mono text-[10px] tabular-nums text-fg-faint">
                $0.0011 · 1,820 tok
              </span>
            </div>
            <ol className="mt-3 grid grid-cols-5 gap-2">
              <ReplayNode label="run.start" tone="accent" delay={0} />
              <ReplayNode label="tool_call" tone="accent" delay={1} />
              <ReplayNode label="message" tone="accent" delay={2} />
              <ReplayNode label="checkpoint" tone="warning" delay={3} highlight />
              <ReplayNode label="run.done" tone="success" delay={4} />
            </ol>
          </div>

          {/* Fork connector */}
          <div className="relative my-3 ml-[60%] h-8 w-[20%]">
            <div className="aldo-replay-fork absolute left-0 top-0 h-full w-full opacity-0">
              <svg viewBox="0 0 100 40" className="h-full w-full" aria-hidden>
                <path
                  d="M 50 0 L 50 20 L 90 40"
                  className="fill-none stroke-warning"
                  strokeWidth="1.5"
                  strokeDasharray="3 2"
                />
                <circle cx="50" cy="0" r="2" className="fill-warning" />
                <circle cx="90" cy="40" r="2" className="fill-warning" />
              </svg>
              <div className="absolute -right-2 top-3 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-warning">
                fork ↳
              </div>
            </div>
          </div>

          {/* Lane B — replay */}
          <div className="aldo-replay-laneB relative opacity-0">
            <div className="flex items-baseline justify-between text-[11px] uppercase tracking-wider text-fg-muted">
              <span className="flex items-center gap-2">
                <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 normal-case tracking-normal text-warning">
                  capability:reasoning-large · alt-provider
                </span>
                <span className="font-mono text-fg-faint">run_abc#fork · lane B</span>
              </span>
              <span className="font-mono text-[10px] tabular-nums text-fg-faint">
                $0.0094 · 1,640 tok
              </span>
            </div>
            <ol className="mt-3 grid grid-cols-5 gap-2">
              <ReplayNode label="(replayed)" tone="ghost" delay={0} />
              <ReplayNode label="(replayed)" tone="ghost" delay={0} />
              <ReplayNode label="(replayed)" tone="ghost" delay={0} />
              <ReplayNode label="checkpoint" tone="warning" delay={5} highlight />
              <ReplayNode label="run.done" tone="success" delay={6} />
            </ol>
          </div>

          {/* Diff strip */}
          <div className="aldo-replay-diff mt-5 grid grid-cols-1 gap-3 opacity-0 sm:grid-cols-3">
            <DiffCard
              tag="cost Δ"
              value="+$0.0083"
              tone="warning"
              caption="frontier 8.5× the local"
            />
            <DiffCard tag="tokens Δ" value="−180" tone="neutral" caption="terser, same content" />
            <DiffCard
              tag="agent code Δ"
              value="0 lines"
              tone="success"
              caption="config-only swap"
            />
          </div>
        </div>

        <p className="mt-3 text-center text-[12px] text-fg-muted">
          Click any step in{' '}
          <Link href="/runs" className="text-accent hover:underline">
            /runs/[id]
          </Link>{' '}
          to fork to a different provider — same input, fresh route. No agent code changes.
        </p>
      </div>
    </section>
  );
}

function ReplayNode({
  label,
  tone,
  delay,
  highlight,
}: {
  label: string;
  tone: 'accent' | 'success' | 'warning' | 'ghost';
  delay: number;
  highlight?: boolean;
}) {
  const ring =
    tone === 'success'
      ? 'border-success/40 bg-success/10 text-success'
      : tone === 'warning'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : tone === 'ghost'
          ? 'border-dashed border-border bg-bg-subtle text-fg-faint'
          : 'border-accent/40 bg-accent/10 text-accent';
  return (
    <li
      className={`aldo-replay-node rounded-md border px-2 py-2 text-center font-mono text-[10.5px] opacity-0 ${ring} ${highlight ? 'aldo-replay-pulse' : ''}`}
      style={{ animationDelay: `${delay * 0.7}s` }}
    >
      {label}
    </li>
  );
}

function DiffCard({
  tag,
  value,
  tone,
  caption,
}: {
  tag: string;
  value: string;
  tone: 'warning' | 'neutral' | 'success';
  caption: string;
}) {
  const ring =
    tone === 'warning'
      ? 'border-warning/40 bg-warning/5'
      : tone === 'success'
        ? 'border-success/40 bg-success/5'
        : 'border-border bg-bg-elevated';
  return (
    <div className={`rounded-md border px-3 py-2 ${ring}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{tag}</div>
      <div className="mt-1 font-mono text-[16px] font-semibold tabular-nums text-fg">{value}</div>
      <div className="mt-0.5 text-[11px] text-fg-faint">{caption}</div>
    </div>
  );
}
