'use client';

/**
 * "Define an agent in 8 lines" — three tabs, one agent (code reviewer).
 *
 * Tabs: Python SDK · TypeScript SDK · YAML.  All three demonstrate
 * the same three platform invariants:
 *
 *   - LLM-agnostic: capability strings, never provider names
 *   - capability-based routing
 *   - privacy_tier as a first-class field
 *
 * Real, runnable code — `pip install aldo-ai` / `npm i @aldo-ai/sdk`.
 *
 * Pure CSS tabbing with `useState`. No code-highlighter dep — the
 * coloring is static spans, same approach as `hero-code-snippet.tsx`.
 */

import { useState } from 'react';

type Tok = 'kw' | 'str' | 'num' | 'cmt' | 'fn' | 'op' | 'plain' | 'key' | 'val' | 'bool';
type Line = ReadonlyArray<{ tok: Tok; text: string }>;

const TOK_CLASS: Record<Tok, string> = {
  kw: 'text-[#c084fc]',
  str: 'text-[#fca5a5]',
  num: 'text-[#f0abfc]',
  cmt: 'text-slate-500 italic',
  fn: 'text-[#7dd3fc]',
  op: 'text-slate-400',
  plain: 'text-slate-200',
  key: 'text-[#7dd3fc]',
  val: 'text-[#86efac]',
  bool: 'text-[#fbbf24]',
};

const PYTHON: ReadonlyArray<Line> = [
  [{ tok: 'cmt', text: '# pip install aldo-ai' }],
  [
    { tok: 'kw', text: 'from' },
    { tok: 'plain', text: ' aldo ' },
    { tok: 'kw', text: 'import' },
    { tok: 'plain', text: ' Agent' },
  ],
  [],
  [
    { tok: 'plain', text: 'reviewer ' },
    { tok: 'op', text: '= ' },
    { tok: 'fn', text: 'Agent' },
    { tok: 'op', text: '(' },
  ],
  [
    { tok: 'plain', text: '    name' },
    { tok: 'op', text: '=' },
    { tok: 'str', text: '"code-reviewer"' },
    { tok: 'op', text: ',' },
  ],
  [
    { tok: 'plain', text: '    privacy_tier' },
    { tok: 'op', text: '=' },
    { tok: 'str', text: '"sensitive"' },
    { tok: 'op', text: ',  ' },
    { tok: 'cmt', text: '# router fails closed' },
  ],
  [
    { tok: 'plain', text: '    capabilities' },
    { tok: 'op', text: '=[' },
    { tok: 'str', text: '"reasoning-strong"' },
    { tok: 'op', text: ', ' },
    { tok: 'str', text: '"code-fim"' },
    { tok: 'op', text: '],' },
  ],
  [
    { tok: 'plain', text: '    eval_threshold' },
    { tok: 'op', text: '=' },
    { tok: 'num', text: '0.85' },
    { tok: 'op', text: ',' },
  ],
  [{ tok: 'op', text: ')' }],
  [],
  [
    { tok: 'plain', text: 'run ' },
    { tok: 'op', text: '= ' },
    { tok: 'plain', text: 'reviewer.' },
    { tok: 'fn', text: 'invoke' },
    { tok: 'op', text: '(' },
    { tok: 'str', text: '"Review apps/api/src/auth.ts"' },
    { tok: 'op', text: ')' },
  ],
];

const TYPESCRIPT: ReadonlyArray<Line> = [
  [{ tok: 'cmt', text: '// npm i @aldo-ai/sdk' }],
  [
    { tok: 'kw', text: 'import' },
    { tok: 'plain', text: ' { Agent } ' },
    { tok: 'kw', text: 'from' },
    { tok: 'plain', text: ' ' },
    { tok: 'str', text: '"@aldo-ai/sdk"' },
  ],
  [],
  [
    { tok: 'kw', text: 'const' },
    { tok: 'plain', text: ' reviewer ' },
    { tok: 'op', text: '= ' },
    { tok: 'kw', text: 'new' },
    { tok: 'plain', text: ' ' },
    { tok: 'fn', text: 'Agent' },
    { tok: 'op', text: '({' },
  ],
  [
    { tok: 'plain', text: '  name' },
    { tok: 'op', text: ': ' },
    { tok: 'str', text: '"code-reviewer"' },
    { tok: 'op', text: ',' },
  ],
  [
    { tok: 'plain', text: '  privacyTier' },
    { tok: 'op', text: ': ' },
    { tok: 'str', text: '"sensitive"' },
    { tok: 'op', text: ',  ' },
    { tok: 'cmt', text: '// router fails closed' },
  ],
  [
    { tok: 'plain', text: '  capabilities' },
    { tok: 'op', text: ': [' },
    { tok: 'str', text: '"reasoning-strong"' },
    { tok: 'op', text: ', ' },
    { tok: 'str', text: '"code-fim"' },
    { tok: 'op', text: '],' },
  ],
  [
    { tok: 'plain', text: '  evalThreshold' },
    { tok: 'op', text: ': ' },
    { tok: 'num', text: '0.85' },
    { tok: 'op', text: ',' },
  ],
  [{ tok: 'op', text: '});' }],
  [],
  [
    { tok: 'kw', text: 'const' },
    { tok: 'plain', text: ' run ' },
    { tok: 'op', text: '= ' },
    { tok: 'kw', text: 'await' },
    { tok: 'plain', text: ' reviewer.' },
    { tok: 'fn', text: 'invoke' },
    { tok: 'op', text: '(' },
    { tok: 'str', text: '"Review apps/api/src/auth.ts"' },
    { tok: 'op', text: ');' },
  ],
];

const YAML: ReadonlyArray<Line> = [
  [{ tok: 'cmt', text: '# agency/delivery/code-reviewer.yaml' }],
  [{ tok: 'cmt', text: '# git-synced from your repo on every push' }],
  [],
  [
    { tok: 'key', text: 'name' },
    { tok: 'op', text: ': ' },
    { tok: 'val', text: 'code-reviewer' },
  ],
  [
    { tok: 'key', text: 'privacy_tier' },
    { tok: 'op', text: ': ' },
    { tok: 'val', text: 'sensitive' },
    { tok: 'cmt', text: '   # router fails closed' },
  ],
  [
    { tok: 'key', text: 'capabilities' },
    { tok: 'op', text: ':' },
  ],
  [
    { tok: 'op', text: '  - ' },
    { tok: 'val', text: 'reasoning-strong' },
  ],
  [
    { tok: 'op', text: '  - ' },
    { tok: 'val', text: 'code-fim' },
  ],
  [
    { tok: 'key', text: 'eval' },
    { tok: 'op', text: ':' },
  ],
  [
    { tok: 'op', text: '  ' },
    { tok: 'key', text: 'threshold' },
    { tok: 'op', text: ': ' },
    { tok: 'num', text: '0.85' },
  ],
  [
    { tok: 'op', text: '  ' },
    { tok: 'key', text: 'must_pass' },
    { tok: 'op', text: ': ' },
    { tok: 'bool', text: 'true' },
  ],
];

const TABS = [
  { id: 'python', label: 'Python', sub: 'pip install aldo-ai', lines: PYTHON },
  { id: 'ts', label: 'TypeScript', sub: 'npm i @aldo-ai/sdk', lines: TYPESCRIPT },
  { id: 'yaml', label: 'YAML', sub: 'git-synced spec', lines: YAML },
] as const;

export function DefineAnAgent() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('python');
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <section id="define-an-agent" className="border-t border-border bg-bg-elevated">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              Define an agent
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
              Eight lines. Three SDKs. Same agent.
            </h2>
            <p className="mt-3 text-base leading-relaxed text-fg-muted">
              A code reviewer that wants <strong className="text-fg">reasoning-strong</strong> and{' '}
              <strong className="text-fg">code-fim</strong>, marked{' '}
              <strong className="text-fg">sensitive</strong> so the router never lets it touch a
              cloud model. Eval threshold 0.85 — anything below that blocks the next promote.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-fg-muted">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full bg-success/15 text-[9px] font-bold text-success">
                  ✓
                </span>
                <span>
                  <strong className="text-fg">Capability strings, not provider names.</strong>{' '}
                  Switch from a frontier model to a local one in one config edit — the agent code
                  doesn&rsquo;t change.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full bg-success/15 text-[9px] font-bold text-success">
                  ✓
                </span>
                <span>
                  <strong className="text-fg">privacy_tier is a field, not a sticker.</strong> The
                  router enforces it. There is no escape hatch.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full bg-success/15 text-[9px] font-bold text-success">
                  ✓
                </span>
                <span>
                  <strong className="text-fg">eval_threshold gates the next promote.</strong> Falls
                  below it and the new version stays in draft.
                </span>
              </li>
            </ul>
            <div className="mt-8 flex flex-wrap gap-3 text-sm">
              <a
                href="/docs/sdks/python"
                className="rounded border border-border bg-bg px-3 py-1.5 font-medium text-fg transition-colors hover:bg-bg-subtle"
              >
                Python docs →
              </a>
              <a
                href="/docs/sdks/typescript"
                className="rounded border border-border bg-bg px-3 py-1.5 font-medium text-fg transition-colors hover:bg-bg-subtle"
              >
                TypeScript docs →
              </a>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-xl">
              {/* Tabs strip */}
              <div
                className="flex items-center gap-1 border-b border-slate-800 bg-slate-900/80 px-2 py-1.5"
                role="tablist"
                aria-label="SDK code samples"
              >
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    aria-controls={`define-panel-${t.id}`}
                    id={`define-tab-${t.id}`}
                    onClick={() => setTab(t.id)}
                    className={`rounded px-3 py-1.5 font-mono text-[11.5px] transition-colors ${
                      tab === t.id
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
                <span className="ml-auto truncate font-mono text-[11px] text-slate-500">
                  {current.sub}
                </span>
              </div>
              <pre
                id={`define-panel-${current.id}`}
                role="tabpanel"
                aria-labelledby={`define-tab-${current.id}`}
                className="overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-[1.7] sm:text-[13px]"
              >
                <code>
                  {current.lines.map((line, idx) => (
                    <div key={`${current.id}-line-${idx}`} className="whitespace-pre">
                      {line.length === 0 ? (
                        <span>&nbsp;</span>
                      ) : (
                        line.map((part, j) => (
                          <span key={`${current.id}-${idx}-${j}`} className={TOK_CLASS[part.tok]}>
                            {part.text}
                          </span>
                        ))
                      )}
                    </div>
                  ))}
                </code>
              </pre>
              <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/60 px-4 py-2 text-[11px] text-slate-500">
                <span>
                  Same agent in all three. Pick the one that fits your codebase — or git-sync the
                  YAML and skip the SDK entirely.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
