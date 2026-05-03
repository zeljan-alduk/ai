/**
 * "What people build with ALDO" — four concrete scenarios with
 * runnable agent specs.
 *
 * Each card pairs a real-world intent with a YAML or code excerpt that
 * leans on a different ALDO platform invariant — eval-gate + git sync,
 * privacy-tier router, cross-model replay, or eval-playground sweeps.
 *
 * LLM-agnostic: every model reference is a capability string, never a
 * vendor product name. Local-runtime probes (Ollama, vLLM, llama.cpp,
 * MLX, LM Studio) are runtime identifiers and explicitly allowed in
 * the in-house style guide.
 *
 * Each card is colour-coded by category (engineering / privacy / sales
 * / data) so they distinguish at a glance without breaking semantic
 * tokens — the accent rail is opacity-tinted from the existing palette.
 */

import Link from 'next/link';

type Category = 'engineering' | 'privacy' | 'sales' | 'data';

interface UseCase {
  readonly id: string;
  readonly category: Category;
  readonly title: string;
  readonly intent: string;
  readonly platformLean: string;
  readonly snippet: ReadonlyArray<
    readonly [
      tone: 'cmt' | 'key' | 'val' | 'op' | 'num' | 'str' | 'plain' | 'kw' | 'fn',
      text: string,
    ]
  >;
  readonly cta: { readonly label: string; readonly href: string };
}

const CATEGORY_LABEL: Record<Category, string> = {
  engineering: 'Engineering',
  privacy: 'Privacy',
  sales: 'Sales',
  data: 'Data',
};

// Subtle accent rails — opacity-tinted from the existing semantic palette
// so they match in light + dark without inventing new tokens.
const CATEGORY_RAIL: Record<Category, string> = {
  engineering: 'before:bg-accent',
  privacy: 'before:bg-success',
  sales: 'before:bg-warning',
  data: 'before:bg-fg-muted',
};

const CATEGORY_PILL: Record<Category, string> = {
  engineering: 'border-accent/30 bg-accent/10 text-accent',
  privacy: 'border-success/30 bg-success/10 text-success',
  sales: 'border-warning/30 bg-warning/10 text-warning',
  data: 'border-border bg-bg-subtle text-fg-muted',
};

const TOK_CLASS: Record<
  'cmt' | 'key' | 'val' | 'op' | 'num' | 'str' | 'plain' | 'kw' | 'fn',
  string
> = {
  cmt: 'text-slate-500 italic',
  key: 'text-[#7dd3fc]',
  val: 'text-[#86efac]',
  op: 'text-slate-400',
  num: 'text-[#f0abfc]',
  str: 'text-[#fca5a5]',
  plain: 'text-slate-200',
  kw: 'text-[#c084fc]',
  fn: 'text-[#7dd3fc]',
};

const USE_CASES: ReadonlyArray<UseCase> = [
  {
    id: 'pr-gate',
    category: 'engineering',
    title: 'Code reviewer that gates PRs',
    intent:
      'Composite agent (architect → security-auditor → code-reviewer) that blocks the merge when any reviewer fails its eval suite.',
    platformLean:
      'Eval-gated promotion + git-synced specs. The agent itself is in `aldo/agents/pr-gate.yaml`; CI fails the PR when the suite drops below threshold.',
    snippet: [
      ['cmt', '# aldo/agents/pr-gate.yaml — git-synced'],
      ['key', 'name'],
      ['op', ': '],
      ['val', 'pr-gate'],
      ['op', '\n'],
      ['key', 'kind'],
      ['op', ': '],
      ['val', 'composite'],
      ['op', '\n'],
      ['key', 'sequence'],
      ['op', ':\n'],
      ['op', '  - '],
      ['val', 'architect'],
      ['op', '\n'],
      ['op', '  - '],
      ['val', 'security-auditor'],
      ['op', '\n'],
      ['op', '  - '],
      ['val', 'code-reviewer'],
      ['op', '\n'],
      ['key', 'eval'],
      ['op', ': { '],
      ['key', 'threshold'],
      ['op', ': '],
      ['num', '0.85'],
      ['op', ', '],
      ['key', 'must_pass'],
      ['op', ': '],
      ['val', 'true'],
      ['op', ' }'],
    ],
    cta: { label: 'Open the gallery template →', href: '/gallery' },
  },
  {
    id: 'support-triage',
    category: 'privacy',
    title: 'Customer-support triage with privacy',
    intent:
      'Leaf agent that reads inbound tickets, classifies, and drafts a reply — never lets the message leave your tenant.',
    platformLean:
      'privacy_tier: sensitive forces the router to a local runtime. Even if a frontier provider is configured tenant-wide, this agent physically cannot reach it.',
    snippet: [
      ['cmt', '# agency/support/triage.yaml'],
      ['key', 'name'],
      ['op', ': '],
      ['val', 'support-triage'],
      ['op', '\n'],
      ['key', 'privacy_tier'],
      ['op', ': '],
      ['val', 'sensitive'],
      ['cmt', '   # router fails closed'],
      ['op', '\n'],
      ['key', 'capabilities'],
      ['op', ':\n'],
      ['op', '  - '],
      ['val', 'reasoning-medium'],
      ['op', '\n'],
      ['op', '  - '],
      ['val', 'classification'],
      ['op', '\n'],
      ['key', 'runtime_hint'],
      ['op', ': '],
      ['val', 'ollama'],
      ['cmt', '  # llama-3.1-70b probed at boot'],
    ],
    cta: { label: 'Read the privacy guide →', href: '/security' },
  },
  {
    id: 'sales-research',
    category: 'sales',
    title: 'Sales research with cross-model A/B',
    intent:
      'Two leaf agents pitched at the same brief — one frontier, one local — judged on the same evaluator. Pick the winner per account.',
    platformLean:
      'Cross-model replay on a single checkpointed run. Same input, two routes, side-by-side cost + score diff in /runs/compare.',
    snippet: [
      ['cmt', '# Two specs, same brief, fork a step in /runs/[id]'],
      ['key', 'agents'],
      ['op', ':\n'],
      ['op', '  - '],
      ['key', 'name'],
      ['op', ': '],
      ['val', 'researcher-frontier'],
      ['op', '\n'],
      ['op', '    '],
      ['key', 'capabilities'],
      ['op', ': ['],
      ['val', 'reasoning-strong'],
      ['op', ']\n'],
      ['op', '  - '],
      ['key', 'name'],
      ['op', ': '],
      ['val', 'researcher-local'],
      ['op', '\n'],
      ['op', '    '],
      ['key', 'capabilities'],
      ['op', ': ['],
      ['val', 'reasoning-medium'],
      ['op', ']\n'],
      ['op', '    '],
      ['key', 'runtime_hint'],
      ['op', ': '],
      ['val', 'vllm'],
    ],
    cta: { label: 'Open /runs/compare →', href: '/runs' },
  },
  {
    id: 'eval-suite',
    category: 'data',
    title: 'Eval suite for an existing prompt',
    intent:
      'Load a dataset of 200 examples, define an LLM-judge evaluator, and sweep across three capability classes to pick the right one.',
    platformLean:
      '/eval/playground + spend dashboard. Per-row score streams alongside aggregate stats; the spend card tells you what the sweep cost.',
    snippet: [
      ['cmt', '# python — pip install aldo-ai'],
      ['kw', 'from'],
      ['plain', ' aldo '],
      ['kw', 'import'],
      ['plain', ' Sweep, Dataset, Evaluator'],
      ['op', '\n'],
      ['op', '\n'],
      ['plain', 'sweep '],
      ['op', '= '],
      ['fn', 'Sweep'],
      ['op', '(\n'],
      ['op', '    '],
      ['plain', 'dataset'],
      ['op', '='],
      ['fn', 'Dataset'],
      ['op', '.'],
      ['fn', 'load'],
      ['op', '('],
      ['str', '"qa-200"'],
      ['op', '),\n'],
      ['op', '    '],
      ['plain', 'evaluator'],
      ['op', '='],
      ['fn', 'Evaluator'],
      ['op', '('],
      ['str', '"answer-correctness"'],
      ['op', '),\n'],
      ['op', '    '],
      ['plain', 'capabilities'],
      ['op', '=[\n'],
      ['op', '        '],
      ['str', '"reasoning-strong"'],
      ['op', ', '],
      ['str', '"reasoning-medium"'],
      ['op', ', '],
      ['str', '"fast-local"'],
      ['op', '\n'],
      ['op', '    ],\n'],
      ['op', ').'],
      ['fn', 'run'],
      ['op', '()'],
    ],
    cta: { label: 'Open eval playground →', href: '/eval/playground' },
  },
];

export function UseCases() {
  return (
    <section id="use-cases" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-12 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            What people build with ALDO
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            Four scenarios. Four runnable specs. No hand-waving.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            Every card below is a real agent shape — copy the spec, adjust the names, and ship. Each
            one leans on a different platform invariant so you can see what makes ALDO different in
            the place it matters: the configuration file.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {USE_CASES.map((u) => (
            <li
              key={u.id}
              className={`group relative flex flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated pl-5 shadow-sm transition-shadow hover:shadow-md before:absolute before:inset-y-0 before:left-0 before:w-1 ${CATEGORY_RAIL[u.category]}`}
            >
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${CATEGORY_PILL[u.category]}`}
                  >
                    {CATEGORY_LABEL[u.category]}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                    spec · runnable
                  </span>
                </div>

                <h3 className="mt-4 text-[17px] font-semibold leading-snug tracking-tight text-fg">
                  {u.title}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{u.intent}</p>

                {/* Snippet — same dark-on-dark idiom as define-an-agent. */}
                <pre className="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-[12px] leading-[1.7] shadow-inner">
                  <code>
                    {u.snippet.map(([tok, text], idx) => (
                      <span key={`${u.id}-${idx}`} className={TOK_CLASS[tok]}>
                        {text}
                      </span>
                    ))}
                  </code>
                </pre>

                <p className="mt-4 text-[12.5px] leading-relaxed text-fg-faint">
                  <span className="font-semibold uppercase tracking-wider text-fg-muted">
                    Leans on:
                  </span>{' '}
                  {u.platformLean}
                </p>

                <Link
                  href={u.cta.href}
                  className="mt-auto inline-flex pt-5 text-[13px] font-medium text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {u.cta.label}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
