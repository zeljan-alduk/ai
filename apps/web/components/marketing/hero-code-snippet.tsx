/**
 * Hero code snippet — the right-hand panel of the new landing hero.
 *
 * Renders an agent YAML spec in a faux-window code block. The spec is
 * deliberately representative: privacy_tier (router fail-closed),
 * capabilities (LLM-agnostic routing), MCP tools, eval threshold.
 * Four of our six pillars on one screen.
 *
 * Server-rendered. No JS — the syntax colouring is static spans.
 */

const LINES: ReadonlyArray<readonly { tok: 'cmt' | 'key' | 'val' | 'str' | 'num' | 'punct' | 'plain'; text: string }[]> = [
  [{ tok: 'cmt', text: '# agency/engineers/security-auditor.yaml' }],
  [{ tok: 'key', text: 'name' }, { tok: 'punct', text: ': ' }, { tok: 'val', text: 'security-auditor' }],
  [
    { tok: 'key', text: 'privacy_tier' },
    { tok: 'punct', text: ': ' },
    { tok: 'val', text: 'sensitive' },
    { tok: 'cmt', text: '   # router drops requests that try to reach a cloud model' },
  ],
  [{ tok: 'key', text: 'capabilities' }, { tok: 'punct', text: ':' }],
  [{ tok: 'punct', text: '  - ' }, { tok: 'val', text: 'code-review' }],
  [{ tok: 'punct', text: '  - ' }, { tok: 'val', text: 'reasoning-strong' }],
  [{ tok: 'key', text: 'tools' }, { tok: 'punct', text: ':' }],
  [{ tok: 'punct', text: '  - ' }, { tok: 'key', text: 'mcp' }, { tok: 'punct', text: ': ' }, { tok: 'val', text: 'aldo-fs' }],
  [{ tok: 'punct', text: '  - ' }, { tok: 'key', text: 'mcp' }, { tok: 'punct', text: ': ' }, { tok: 'val', text: 'aldo-cve-db' }],
  [{ tok: 'key', text: 'prompt' }, { tok: 'punct', text: ': |' }],
  [{ tok: 'str', text: '  You audit code for security issues.' }],
  [{ tok: 'str', text: '  Quote files; never invent. If evidence is' }],
  [{ tok: 'str', text: '  missing, say so.' }],
  [{ tok: 'key', text: 'eval' }, { tok: 'punct', text: ':' }],
  [
    { tok: 'punct', text: '  ' },
    { tok: 'key', text: 'threshold' },
    { tok: 'punct', text: ': ' },
    { tok: 'num', text: '0.85' },
    { tok: 'cmt', text: '             # eval-gated before promotion' },
  ],
  [
    { tok: 'punct', text: '  ' },
    { tok: 'key', text: 'rubric' },
    { tok: 'punct', text: ': ' },
    { tok: 'val', text: 'agency/eval/audit-rubric.yaml' },
  ],
];

const TOK_CLASS: Record<'cmt' | 'key' | 'val' | 'str' | 'num' | 'punct' | 'plain', string> = {
  cmt: 'text-slate-500',
  key: 'text-sky-400',
  val: 'text-emerald-300',
  str: 'text-amber-200',
  num: 'text-fuchsia-300',
  punct: 'text-slate-400',
  plain: 'text-slate-200',
};

export function HeroCodeSnippet() {
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-2xl">
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/80 px-4 py-2.5">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
        <span className="ml-3 truncate font-mono text-[11px] text-slate-400">
          security-auditor.yaml
        </span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.7] sm:text-[13px]">
        <code>
          {LINES.map((line, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static config-driven render
            <div key={idx} className="whitespace-pre">
              {line.length === 0 ? (
                <span>&nbsp;</span>
              ) : (
                line.map((part, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: same-row spans, stable order
                  <span key={j} className={TOK_CLASS[part.tok]}>
                    {part.text}
                  </span>
                ))
              )}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
