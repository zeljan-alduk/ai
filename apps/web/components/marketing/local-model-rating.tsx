/**
 * "Local model rating" — animated mockup of the /local-models flow.
 * Pure CSS keyframes — no JS, no animation lib.
 *
 * Sequence (16s loop):
 *   t=0    discovery panel header settles
 *   t=0..2 four named-probe cards animate in, staggered
 *   t=2..3 the "scan common ports" pill highlights briefly
 *   t=3..4 a fifth port-scan card slides in (source: openai-compat)
 *   t=4..5 a card pops with a ring (the user picked it)
 *   t=5..6 rating panel header glows; progress bar starts
 *   t=6..13 eight bench rows fill in, one every ~0.9s
 *   t=13..15 summary footer pops in with pass-rate stat
 *   t=15..16 hold
 *   t=16    loops
 *
 * `prefers-reduced-motion: reduce` collapses to the end-state
 * (everything visible, no motion).
 *
 * Test-contract: the heading string is matched by
 * `tests/marketing-local-models.spec.ts`. Don't change it without
 * updating the test.
 */

import Link from 'next/link';

export function LocalModelRating() {
  return (
    <section id="local-models" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-10 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Local model rating
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            Discover every local LLM. Rate quality and speed in one click.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            Open{' '}
            <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px] text-fg">
              /local-models
            </code>{' '}
            and the platform probes <span className="font-mono text-fg">127.0.0.1</span>: Ollama, LM
            Studio, vLLM, llama.cpp on their default ports, then optionally sweeps a curated
            common-port list or every localhost port. Pick a model, pick an eval suite, watch each
            case stream in with TTFT, tokens, reasoning split, and tok/s. Pass/fail is the
            evaluator's call — the bench just times it.
          </p>
        </div>

        <div className="aldo-lmr-stage grid gap-4 overflow-hidden rounded-xl border border-border bg-bg-elevated p-4 shadow-sm sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {/* ── Discovery panel ─────────────────────────────────── */}
          <div className="rounded-lg border border-border bg-bg p-3">
            <header className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-fg">
                  Discovered models
                </p>
                <p className="text-[10px] text-fg-muted">scan: 127.0.0.1</p>
              </div>
              <div className="flex flex-wrap gap-1 text-[10px]">
                <span className="rounded border border-accent bg-accent/10 px-1.5 py-0.5 font-medium text-accent">
                  default
                </span>
                <span className="aldo-lmr-pill-common rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-medium text-fg-muted">
                  common
                </span>
                <span className="rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-medium text-fg-muted">
                  exhaustive
                </span>
              </div>
            </header>

            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              <ModelCard
                id="qwen3.6-35b-a3b"
                source="lmstudio"
                baseUrl="127.0.0.1:1234"
                cap="local-reasoning"
                ctx="32k"
                stage="a"
                selected
              />
              <ModelCard
                id="llama-3.1-70b"
                source="ollama"
                baseUrl="127.0.0.1:11434"
                cap="local-reasoning"
                ctx="131k"
                stage="b"
              />
              <ModelCard
                id="phi-4-mini"
                source="llamacpp"
                baseUrl="127.0.0.1:8080"
                cap="local-reasoning"
                ctx="16k"
                stage="c"
              />
              <ModelCard
                id="mistral-nemo"
                source="vllm"
                baseUrl="127.0.0.1:8000"
                cap="local-reasoning"
                ctx="64k"
                stage="d"
              />
              <ModelCard
                id="local-deepseek-r1"
                source="openai-compat"
                baseUrl="127.0.0.1:5050"
                cap="local-reasoning"
                ctx="32k"
                stage="scan"
              />
            </ul>
          </div>

          {/* ── Rating panel ───────────────────────────────────── */}
          <div className="aldo-lmr-rating rounded-lg border border-border bg-bg p-3">
            <header className="border-b border-border pb-2">
              <div className="flex items-baseline justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-fg">
                  Quality × speed rating
                </p>
                <span className="aldo-lmr-status rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent opacity-0">
                  streaming
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-[10px] text-fg-muted">
                local-model-rating @ 0.1.0 · 8 cases · qwen3.6-35b-a3b
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-subtle">
                <div className="aldo-lmr-progress h-full w-0 bg-accent" />
              </div>
            </header>

            <table className="mt-2 w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-[9px] uppercase tracking-wide text-fg-muted">
                  <th className="py-1 text-left font-medium">Case</th>
                  <th className="py-1 text-center font-medium">✓</th>
                  <th className="py-1 text-right font-medium">Total</th>
                  <th className="py-1 text-right font-medium">Tok</th>
                  <th className="py-1 text-right font-medium">Reason</th>
                  <th className="py-1 text-right font-medium">Tok/s</th>
                </tr>
              </thead>
              <tbody>
                <CaseRow
                  id="echo-instruction"
                  pass
                  total="1.3 s"
                  tok="11"
                  reason="87%"
                  tps="8.2"
                  delay={1}
                />
                <CaseRow
                  id="json-shape"
                  pass
                  total="3.1 s"
                  tok="42"
                  reason="71%"
                  tps="13.5"
                  delay={2}
                />
                <CaseRow
                  id="code-refactor"
                  total="18.4 s"
                  tok="1120"
                  reason="62%"
                  tps="60.8"
                  delay={3}
                />
                <CaseRow
                  id="needle-haystack"
                  pass
                  total="44.2 s"
                  tok="320"
                  reason="55%"
                  tps="7.2"
                  delay={4}
                />
                <CaseRow
                  id="reasoning-multi"
                  pass
                  total="7.8 s"
                  tok="412"
                  reason="78%"
                  tps="52.1"
                  delay={5}
                />
                <CaseRow
                  id="refusal-when-asked"
                  pass
                  total="1.8 s"
                  tok="18"
                  reason="50%"
                  tps="9.9"
                  delay={6}
                />
                <CaseRow
                  id="not-contains-leak"
                  pass
                  total="2.2 s"
                  tok="36"
                  reason="45%"
                  tps="16.5"
                  delay={7}
                />
                <CaseRow
                  id="long-context-recall"
                  pass
                  total="62.1 s"
                  tok="220"
                  reason="40%"
                  tps="3.5"
                  delay={8}
                />
              </tbody>
            </table>

            <footer className="aldo-lmr-summary mt-3 grid grid-cols-4 gap-3 border-t border-border pt-2 text-[10px] opacity-0">
              <Stat label="Pass" value="7/8" tone="success" />
              <Stat label="Avg tok/s" value="22.1" />
              <Stat label="Reasoning" value="61%" />
              <Stat label="P95" value="62.1 s" />
            </footer>
          </div>
        </div>

        <p className="mt-3 text-center text-[12px] text-fg-muted">
          Scan more aggressively with{' '}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[11px] text-fg">
            aldo models discover --exhaustive
          </code>
          ; rate from the CLI with{' '}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[11px] text-fg">
            aldo bench --suite local-model-rating --model &lt;id&gt;
          </code>
          .
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/local-models"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg shadow-sm transition-shadow hover:shadow-md"
          >
            Try it on your laptop →
          </Link>
          <Link
            href="/docs/guides/local-models"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg px-4 py-2 text-sm font-medium text-fg hover:bg-bg-subtle"
          >
            Read the guide
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── parts ─────────────────────────────────────────────────────────────

interface ModelCardProps {
  readonly id: string;
  readonly source: string;
  readonly baseUrl: string;
  readonly cap: string;
  readonly ctx: string;
  readonly stage: 'a' | 'b' | 'c' | 'd' | 'scan';
  readonly selected?: boolean;
}

function ModelCard({ id, source, baseUrl, cap, ctx, stage, selected }: ModelCardProps) {
  const isPortScan = source === 'openai-compat';
  return (
    <li
      className={[
        'aldo-lmr-card',
        `aldo-lmr-card-${stage}`,
        'flex flex-col gap-1.5 rounded-md border bg-bg-elevated p-2 opacity-0',
        selected ? 'aldo-lmr-card-selected border-accent' : 'border-border',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[10px] font-medium text-fg" title={id}>
            {id}
          </p>
          <p className="mt-0.5 truncate font-mono text-[9px] text-fg-muted">{baseUrl}</p>
        </div>
        <span
          className={[
            'shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-medium',
            isPortScan
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
              : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
          ].join(' ')}
        >
          {source}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 text-[9px] text-fg-muted">
        <span className="rounded bg-bg-subtle px-1 py-0.5">{cap}</span>
        <span className="rounded bg-bg-subtle px-1 py-0.5">{ctx} ctx</span>
      </div>
    </li>
  );
}

interface CaseRowProps {
  readonly id: string;
  readonly pass?: boolean;
  readonly total: string;
  readonly tok: string;
  readonly reason: string;
  readonly tps: string;
  readonly delay: number;
}

function CaseRow({ id, pass = false, total, tok, reason, tps, delay }: CaseRowProps) {
  return (
    <tr
      className={`aldo-lmr-row aldo-lmr-row-${delay} border-b border-border/60 opacity-0 last:border-0`}
    >
      <td className="py-1 font-mono text-fg">{id}</td>
      <td className="py-1 text-center">
        <span
          className={
            pass
              ? 'inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[10px] text-emerald-600 dark:text-emerald-400'
              : 'inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[10px] text-red-600 dark:text-red-400'
          }
          aria-label={pass ? 'pass' : 'fail'}
        >
          {pass ? '✓' : '✗'}
        </span>
      </td>
      <td className="py-1 text-right font-mono tabular-nums text-fg-muted">{total}</td>
      <td className="py-1 text-right font-mono tabular-nums text-fg-muted">{tok}</td>
      <td className="py-1 text-right">
        <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9px] text-violet-700 dark:text-violet-400">
          {reason}
        </span>
      </td>
      <td className="py-1 text-right font-mono tabular-nums text-fg">{tps}</td>
    </tr>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div>
      <p className="uppercase tracking-wide text-fg-muted">{label}</p>
      <p
        className={[
          'mt-0.5 font-mono text-sm font-semibold tabular-nums',
          tone === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  );
}
