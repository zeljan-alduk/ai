/**
 * MISSING_PIECES §11 / Phase F — reference `aldo code` configuration.
 *
 * This file is documentation, not runtime code. It illustrates the
 * recommended cycle budgets, tool ACLs, and capability classes for
 * the three common deployment shapes:
 *
 *   1. Local-only (no provider keys, Ollama / vLLM / MLX). Read +
 *      write fs + shell.exec; rolling-window compression; modest
 *      cycle budget.
 *   2. Frontier-coding (tenant has Anthropic / OpenAI keys). Same
 *      tool surface but `coding-frontier` capability class with
 *      `--no-local-fallback` so the loop fails fast on a local-only
 *      tenant rather than silently downgrading.
 *   3. Read-only audit (review-style sessions, e.g. eval triage).
 *      Strip write tools; `coding-frontier` not required.
 *
 * Operators who want session presets should commit a small wrapper
 * script in their repo that exec's `aldo code` with the right flags;
 * the CLI itself doesn't ship a preset loader in v0 (the synthetic
 * spec is built from the flags directly).
 */

export interface AldoCodePreset {
  /** Pretty name for human readers. */
  readonly name: string;
  /** One-line description. */
  readonly description: string;
  /** Flags as you'd pass to `aldo code`. */
  readonly flags: readonly string[];
  /**
   * Reasoning for the flag choices, kept inline so a future
   * operator reading the file knows WHY each value was picked.
   */
  readonly reasoning: string;
}

export const PRESETS: readonly AldoCodePreset[] = [
  {
    name: 'local-only',
    description: 'Full coding kit on a local Ollama / vLLM / MLX backend.',
    flags: [
      '--tui',
      '--workspace .',
      '--tools aldo-fs.fs.read,aldo-fs.fs.write,aldo-fs.fs.list,aldo-fs.fs.mkdir,aldo-shell.shell.exec',
      '--capability-class reasoning-medium',
      '--max-cycles 50',
      '--context-window 128000',
    ],
    reasoning: [
      'reasoning-medium routes to qwen2.5-coder:32b on Ollama by default;',
      'fall through to local-reasoning is acceptable since we are local-only.',
      '50 cycles handles a multi-file refactor (~15 read/write + 5 typecheck/test cycles + slack).',
      '128k context matches qwen2.5-coder:32b and Llama 3.3 70B effective windows.',
    ].join(' '),
  },
  {
    name: 'frontier-coding',
    description: 'Cloud-frontier (Claude Sonnet 4.6 / GPT-5) with no fallback to local.',
    flags: [
      '--tui',
      '--workspace .',
      '--tools aldo-fs.fs.read,aldo-fs.fs.write,aldo-fs.fs.list,aldo-fs.fs.mkdir,aldo-shell.shell.exec',
      '--capability-class coding-frontier',
      '--no-local-fallback',
      '--max-cycles 60',
      '--context-window 200000',
    ],
    reasoning: [
      'coding-frontier requires an Anthropic / OpenAI / Gemini key on the tenant;',
      '--no-local-fallback fails fast if the tenant is local-only.',
      '60 cycles lets a frontier model attempt a deeper refactor than local can sustain;',
      '200k context matches Claude Sonnet 4.6 / Opus 4.7.',
    ].join(' '),
  },
  {
    name: 'read-only-audit',
    description: 'Reviewer / triage session — read fs + shell only, no writes.',
    flags: [
      '--tui',
      '--workspace .',
      '--tools aldo-fs.fs.read,aldo-fs.fs.list,aldo-fs.fs.search,aldo-fs.fs.stat,aldo-shell.shell.exec',
      '--capability-class reasoning-medium',
      '--max-cycles 25',
    ],
    reasoning: [
      'No fs.write or fs.mkdir → the synthetic spec resolves filesystem permission to repo-readonly.',
      'shell.exec stays so the reviewer can run pnpm test / git log / similar read-side commands.',
      '25 cycles is plenty for "read these N files and summarise the issue".',
    ].join(' '),
  },
];

/**
 * Convert a preset to the argv array a wrapper script would pass.
 * Pure helper so an operator can `aldo code "$@" $(node -p "require(...).argvFor('local-only').join(' ')")`
 * style boot. v0 sticks to the flags-only shape because that's
 * what the §11 plan calls out as out-of-scope for a config loader.
 */
export function argvFor(name: string): readonly string[] {
  const preset = PRESETS.find((p) => p.name === name);
  if (preset === undefined) throw new Error(`unknown preset: ${name}`);
  return preset.flags;
}
