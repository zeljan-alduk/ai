/**
 * "30 seconds to first run" — CLI quickstart with a typewriter loop.
 *
 * Single dark terminal panel. CSS keyframes step through four blocks of
 * commands + output, looping every 12 s. The typewriter effect is a
 * staggered fade-in — no per-character JS.
 *
 * Always-dark exception (matches StatsStrip / DualCta / define-an-agent
 * tab body — terminals are dark in every shell on the planet).
 *
 * `prefers-reduced-motion: reduce` collapses to a fully-rendered static
 * end-state. The CSS for `aldo-cli-line` lives in `globals.css`.
 */

import Link from 'next/link';

interface CliLine {
  readonly kind: 'cmd' | 'ok' | 'log' | 'url' | 'pad';
  readonly text: string;
}

const CLI_LINES: ReadonlyArray<CliLine> = [
  { kind: 'cmd', text: 'pip install aldo-ai' },
  { kind: 'ok', text: '✓ installed aldo-ai 0.1.0' },
  { kind: 'pad', text: '' },
  { kind: 'cmd', text: 'aldo init' },
  { kind: 'ok', text: '✓ wrote aldo.yaml + agency/principal.yaml' },
  { kind: 'pad', text: '' },
  { kind: 'cmd', text: 'aldo run principal "summarize the README in 3 bullets"' },
  { kind: 'log', text: '[principal] running with capability=reasoning-strong privacy_tier=open' },
  { kind: 'log', text: '[principal] tool_call: fs.read README.md (320ms)' },
  { kind: 'log', text: '[principal] response received (1.2k tokens, $0.012)' },
  { kind: 'ok', text: '✓ run abcd1234 → https://ai.aldo.tech/runs/abcd1234' },
  { kind: 'pad', text: '' },
  { kind: 'cmd', text: 'open https://ai.aldo.tech/runs/abcd1234' },
];

// Stagger lines across the 12 s loop. Each line gets a 0.55 s reveal
// window inside its slot. Output lines snap in shorter than commands
// to mimic the cadence of a real shell.
const SLOT = 0.7; // seconds per line slot
const STAGGER_OFFSET = 0.4; // s — initial pre-roll
const TOTAL = 12; // s — keep in sync with .aldo-cli keyframe duration

const KIND_CLASS: Record<CliLine['kind'], string> = {
  cmd: 'text-slate-100',
  ok: 'text-emerald-400',
  log: 'text-slate-400',
  url: 'text-sky-400 underline',
  pad: '',
};

export function CliQuickstart() {
  return (
    <section id="cli-quickstart" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-10 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            30 seconds to first run
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            Four commands. One run, one URL.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            No console, no wizard, no &ldquo;create a project&rdquo;. Install the CLI,{' '}
            <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px] text-fg">
              aldo init
            </code>
            , give the principal a brief, open the run viewer.
          </p>
        </div>

        <div className="mx-auto max-w-4xl">
          {/* Always-dark terminal panel — chrome + body + caption. */}
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-xl">
            <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/80 px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" aria-hidden />
              <span className="ml-3 font-mono text-[11px] text-slate-500">~ /your-repo · zsh</span>
              <span className="ml-auto rounded-full border border-slate-700 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-slate-500">
                live demo
              </span>
            </div>
            <pre
              className="aldo-cli min-h-[360px] overflow-x-auto px-5 py-5 font-mono text-[12.5px] leading-[1.75] sm:px-6 sm:text-[13px]"
              role="img"
              aria-label="Terminal walkthrough — pip install aldo-ai, aldo init, aldo run principal, open run URL"
            >
              <code>
                {CLI_LINES.map((line, idx) => {
                  const delay = STAGGER_OFFSET + idx * SLOT;
                  return (
                    <div
                      key={`cli-${idx}`}
                      className={`aldo-cli-line whitespace-pre ${KIND_CLASS[line.kind]}`}
                      style={{ animationDelay: `${delay}s`, animationDuration: `${TOTAL}s` }}
                    >
                      {line.kind === 'cmd' ? (
                        <>
                          <span className="text-emerald-400">$</span> <span>{line.text}</span>
                          <span className="aldo-cli-caret" aria-hidden>
                            ▍
                          </span>
                        </>
                      ) : line.kind === 'pad' ? (
                        <span>&nbsp;</span>
                      ) : (
                        <span>{line.text}</span>
                      )}
                    </div>
                  );
                })}
              </code>
            </pre>
          </div>

          <p className="mt-3 text-center text-[12px] text-fg-muted">
            All commands real. The CLI ships in{' '}
            <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12px] text-fg">
              pip install aldo-ai
            </code>
            .
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm">
            <Link
              href="/docs"
              className="rounded border border-border bg-bg-elevated px-3 py-1.5 font-medium text-fg transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Quickstart guide →
            </Link>
            <Link
              href="/docs/sdks/python"
              className="rounded border border-border bg-bg-elevated px-3 py-1.5 font-medium text-fg transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Python SDK docs →
            </Link>
            <Link
              href="/docs/guides/mcp-server"
              className="rounded border border-border bg-bg-elevated px-3 py-1.5 font-medium text-fg transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              MCP integration →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
