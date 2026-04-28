/**
 * /changelog — public, curated changelog.
 *
 * Hand-curated. Update when something user-facing ships. The bar is
 * "would a customer or prospect care?" — internal refactors don't go
 * here. Date format is ISO; newest at the top.
 *
 * Why curated, not auto-generated: most commits are internal noise. A
 * good changelog is a product surface, not a git log dump.
 */

import Link from 'next/link';

export const metadata = {
  title: 'Changelog — ALDO AI',
  description:
    'What we ship, week by week. Public. Updated on every meaningful release.',
};

interface Entry {
  readonly date: string;
  readonly title: string;
  /** A short paragraph in a customer-readable tone. */
  readonly body: string;
  readonly tag: 'platform' | 'web' | 'sdk' | 'security' | 'docs' | 'ops';
}

const TAG_BADGE: Record<Entry['tag'], string> = {
  platform: 'bg-blue-50 text-blue-700 ring-blue-200',
  web:      'bg-violet-50 text-violet-700 ring-violet-200',
  sdk:      'bg-emerald-50 text-emerald-700 ring-emerald-200',
  security: 'bg-rose-50 text-rose-700 ring-rose-200',
  docs:     'bg-amber-50 text-amber-800 ring-amber-200',
  ops:      'bg-slate-100 text-slate-700 ring-slate-200',
};

const ENTRIES: ReadonlyArray<Entry> = [
  {
    date: '2026-04-27',
    tag: 'web',
    title: 'New landing page, sales kit, and pitch deck',
    body:
      'Marketing surface gets a code-first hero, an inline architecture diagram, and a trust strip with verticals (no fake logos). Three /vs/* comparison pages (CrewAI, LangSmith, Braintrust) ship side-by-side. Customer-facing /sales/one-pager, /sales/overview, and /deck routes added — same talking points, three formats. ⌘P-friendly print stylesheets on each.',
  },
  {
    date: '2026-04-27',
    tag: 'ops',
    title: 'Self-hosted at ai.aldo.tech with auto-deploy on every push',
    body:
      'Production now runs on our own VPS instead of Fly + Vercel — coexisting with the existing slovenia-transit edge proxy on the same host (it stays untouched). Every push to main or our active dev branch fires a GitHub Actions workflow that calls a token-gated webhook on the VPS to git fetch + rebuild + redeploy in under five minutes. The operator is no longer in the deploy loop.',
  },
  {
    date: '2026-04-26',
    tag: 'security',
    title: 'CodeQL pass: XSS, ReDoS, TOCTOU, and modulo-bias fixes',
    body:
      'Eleven CodeQL findings triaged across the docs renderer (sanitize-html with explicit allowlists), the share-slug generator (rejection sampling instead of mod), the markdown URL regex (length-bounded), and the file readers in the FS MCP server (open + handle.stat instead of stat + read).',
  },
  {
    date: '2026-04-25',
    tag: 'platform',
    title: 'Custom domains, per-tenant quotas, and distributed rate-limiting (wave 16)',
    body:
      'Bring-your-own domain support for hosted tenants. Per-tenant quotas (runs/month, dataset rows, secrets) configurable per plan. Postgres-advisory-lock token-bucket rate limiter applied to the runs API and playground for fair-share between tenants on shared deployments.',
  },
  {
    date: '2026-04-22',
    tag: 'platform',
    title: 'Replayable run tree + per-node model swap',
    body:
      'Every run, every supervisor node, every tool call is now checkpointed. Re-execute any step against a different model — the run-compare view shows token-by-token diffs and the cost rollup at every node.',
  },
  {
    date: '2026-04-20',
    tag: 'platform',
    title: 'Privacy-tier router fails closed',
    body:
      'Agents tagged privacy_tier: sensitive can no longer dispatch to a cloud-class model — the router refuses before the gateway ever calls a provider. Every blocked attempt is a row in the audit log with the reason. This is the architectural commitment most competitors cannot match without a rewrite.',
  },
  {
    date: '2026-04-18',
    tag: 'platform',
    title: 'Local-model auto-discovery — Ollama, vLLM, llama.cpp, LM Studio, MLX',
    body:
      'On boot the gateway probes the well-known local ports for each runtime and merges what it finds into the model registry. The eval harness then compares local vs frontier on the same agent spec — model choice becomes data-driven instead of vibes-driven.',
  },
  {
    date: '2026-04-15',
    tag: 'sdk',
    title: 'Python and TypeScript SDKs + CLI',
    body:
      'aldo-ai (Python) and @aldo-ai/sdk (TypeScript) ship the same shape: typed clients for runs, agents, evals, datasets, secrets. The aldo CLI bundles run / eval / dataset commands plus a one-shot tenant-bootstrap. VS Code extension wires the CLI into the editor.',
  },
  {
    date: '2026-04-12',
    tag: 'platform',
    title: 'Multi-agent supervisors: sequential, parallel, debate, iterative',
    body:
      'Four supervisor strategies built into the orchestrator. Each composes deterministically — the cost rollup at the root of the run tree always sums what every leaf actually consumed.',
  },
  {
    date: '2026-04-08',
    tag: 'platform',
    title: 'Eval-gated promotion',
    body:
      'Agent specs declare a threshold + rubric. Re-promotion to the active version is blocked if the eval score regresses. The same rubric runs in CI and in production — one source of truth, no review-as-vibes.',
  },
  {
    date: '2026-04-04',
    tag: 'security',
    title: 'Sandboxed tool execution + prompt-injection scanner',
    body:
      'Every MCP tool call runs through process isolation, a prompt-injection spotlighter (suspicious instructions in tool output get quarantined), and an output scanner before the result reaches the agent.',
  },
  {
    date: '2026-04-01',
    tag: 'docs',
    title: 'Public docs site at /docs with searchable index',
    body:
      'Markdown-rendered docs, in-page TOC, full-text search index built at compile time. Concepts (agency, agents, supervisors, evals, privacy tiers) plus reference for the SDKs and the API.',
  },
];

export default function ChangelogPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <header className="border-b border-slate-200 pb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">
          Changelog
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
          What we ship.
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
          Public, curated. Updated on every meaningful release. Ships fast — we&rsquo;re a small
          team that does big-team things by doing them often.
        </p>
      </header>

      <ol className="mt-10 space-y-10">
        {ENTRIES.map((e) => (
          <li
            key={`${e.date}-${e.title}`}
            className="grid grid-cols-1 gap-3 sm:grid-cols-[7rem,1fr] sm:gap-6"
          >
            <div className="text-[12px] font-mono text-slate-500 sm:pt-1.5">{e.date}</div>
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[16px] font-semibold tracking-tight text-slate-900">
                  {e.title}
                </h2>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${TAG_BADGE[e.tag]}`}
                >
                  {e.tag}
                </span>
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-700">{e.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <footer className="mt-16 rounded-xl border border-slate-200 bg-slate-50/60 p-6">
        <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
          Want to be notified?
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-700">
          We don&rsquo;t have a newsletter yet — pricing for spam-free engineering tooling. For
          now: bookmark this page, or email{' '}
          <a className="underline" href="mailto:info@aldo.tech">
            info@aldo.tech
          </a>{' '}
          and ask to be on the (real) launch list.
        </p>
        <Link
          href="/signup"
          className="mt-4 inline-flex rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Try the trial →
        </Link>
      </footer>
    </article>
  );
}
