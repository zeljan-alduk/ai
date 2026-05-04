/**
 * Wave-Iter — IterativeAgentRun + `aldo code` story.
 *
 * Sits between CliQuickstart and BuiltForTheWayYouWork on the landing
 * page. Three tiles, side-by-side on lg, stacked on mobile:
 *
 *   1. The primitive — what IterativeAgentRun is and why it matters.
 *   2. The chat surface — the floating panel + tool tiles.
 *   3. The terminal surface — `aldo code --tui` + approval gates.
 *
 * Static-rendered, no client islands. Same semantic-token theme as
 * the rest of the marketing surface so dark mode flips cleanly.
 */

import Link from 'next/link';

interface Tile {
  readonly tag: string;
  readonly title: string;
  readonly body: string;
  readonly bullets: readonly string[];
  readonly link: { readonly href: string; readonly label: string };
}

const TILES: ReadonlyArray<Tile> = [
  {
    tag: 'engine primitive',
    title: 'IterativeAgentRun',
    body: 'A leaf-loop primitive every agent inherits when its YAML declares an iteration block. Cycle limits, history compression, declarative termination — all enforced by the platform, not the agent author.',
    bullets: [
      'maxCycles ceiling + budget cap, both honored fail-closed',
      'Termination matchers: text-includes · tool-result · budget-exhausted',
      'Rolling-window or periodic-summary compression at 80% utilisation',
      'Per-cycle replay tree on /runs/<id> — exactly what the agent did, step by step',
    ],
    link: {
      href: 'https://github.com/zeljan-alduk/ai/blob/main/MISSING_PIECES.md#9-execution-plan-for-1--iterativeagentrun-next-up-drafted-2026-05-04',
      label: 'execution plan',
    },
  },
  {
    tag: 'chat surface',
    title: 'Assistant panel',
    body: 'The platform\'s floating assistant runs on the same iterative loop. Tool calls render inline as collapsible tiles — the user sees the agent\'s reasoning trail, not just the final answer.',
    bullets: [
      'Read-only fs tools wired by default; opt into write/exec via env',
      'Backward-compat SSE wire — older clients ignore the new tool frame',
      'Each chat turn is a real Run row, replayable via /runs/<id>',
      'Approval-gated tools surface a banner with one-click resolve',
    ],
    link: {
      href: 'https://github.com/zeljan-alduk/ai/blob/main/apps/api/src/routes/assistant.ts',
      label: 'assistant route',
    },
  },
  {
    tag: 'terminal surface',
    title: '`aldo code` TUI',
    body: 'A Claude-Code-style terminal coding companion. Streamed conversation, inline tool tiles, modal approval prompts at destructive boundaries, slash commands, cross-session resume.',
    bullets: [
      '`aldo code --tui [brief]` — interactive shell with multi-line input',
      'Approval prompts with [a]pprove · [r]eject · [v]iew-full-args keybinds',
      'Slash commands: /help · /clear · /save <path> · /model · /tools · /exit',
      '`--resume <thread-id>` rehydrates from local sidecar; multi-day workflows survive',
    ],
    link: {
      href: 'https://github.com/zeljan-alduk/ai/blob/main/docs/guides/aldo-code.md',
      label: 'aldo code guide',
    },
  },
];

export function IterativeLoop() {
  return (
    <section id="iterative-loop" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-10 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Wave-Iter · 2026-05-04
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
            One iterative loop. Three surfaces.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-fg-muted">
            Tool-using agents that loop until done — addressable from the API,
            the chat panel, and a terminal coding TUI. Same engine
            primitive; same replay; same approval gates at destructive
            boundaries. Local-first: works on Qwen-Coder via Ollama, scales
            up to Claude Sonnet 4.6 + GPT-5 when the tenant has provider
            keys (and refuses to silently downgrade).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
          {TILES.map((tile) => (
            <article
              key={tile.title}
              className="flex flex-col rounded-lg border border-border bg-bg-elevated p-5 shadow-sm"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">
                {tile.tag}
              </p>
              <h3
                className="mt-1 font-mono text-lg font-bold text-fg"
                dangerouslySetInnerHTML={{
                  __html: tile.title.replace(
                    /`([^`]+)`/g,
                    '<code class="rounded bg-bg-subtle px-1 py-0.5 text-base">$1</code>',
                  ),
                }}
              />
              <p className="mt-3 text-sm leading-relaxed text-fg-muted">{tile.body}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-[13px] text-fg-muted">
                {tile.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <span aria-hidden className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-accent" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={tile.link.href}
                className="mt-5 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline"
              >
                {tile.link.label} →
              </Link>
            </article>
          ))}
        </div>

        <div className="mt-10 rounded-lg border border-border bg-bg-elevated p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-faint">
            What this unlocks
          </p>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">
            The platform's headline ambition — <em>build the next picenhancer
            end-to-end inside ALDO</em> — is now technically feasible. A user
            runs <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono">aldo code --tui</code>,
            hands the agent a brief, the loop iterates against a real model
            with fs/shell tools, destructive boundaries pause for human
            approval, and the session resumes across days. Quality is
            bounded by the chosen model — Qwen-Coder 32B is competitive on
            small files; Claude Sonnet 4.6 on 200k-context refactors.
          </p>
        </div>
      </div>
    </section>
  );
}
