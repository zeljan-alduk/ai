/**
 * Dual final CTA — two side-by-side panels:
 *
 *   1. "Try the cloud"      → /signup
 *   2. "Self-host today"    → /docs/guides/self-hosting
 *
 * Always-dark aesthetic — matches the existing BottomCta. The slate-*
 * colors are the documented exception to the semantic-token rule (the
 * original BottomCta has the same carve-out documented).
 */

import Link from 'next/link';

export function DualCta() {
  return (
    <section className="border-t border-slate-800 bg-slate-950">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-10 max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-400">
            Two ways in
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-[2.1rem]">
            Try it managed. Or run it yourself.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-slate-400">
            Same product either way — same agents, same gateway, same eval gates.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CtaPanel
            tag="Cloud"
            title="Try the cloud"
            description="Sign up, land on /welcome, and a working agent organization is seeded into your tenant. 14-day trial, no card."
            stats={[
              { k: '14-day', v: 'free trial' },
              { k: 'no card', v: 'required' },
              { k: '< 5 min', v: 'to first run' },
            ]}
            primary={{ label: 'Sign up free', href: '/signup' }}
            secondary={{ label: 'See pricing', href: '/pricing' }}
            tone="accent"
          />
          <CtaPanel
            tag="Self-host"
            title="Run it yourself"
            description="Helm chart in-repo today. AWS-EKS / GCP-GKE / Azure-AKS Terraform modules included. Same product the cloud tenants run."
            stats={[
              { k: 'helm', v: 'lint clean' },
              { k: '37/37', v: 'kubeconform' },
              { k: '3 clouds', v: 'terraform modules' },
            ]}
            primary={{ label: 'Self-hosting guide', href: '/docs/guides/self-hosting' }}
            secondary={{
              label: 'View charts/aldo-ai',
              href: 'https://github.com/aldo-tech-labs/aldo-ai/tree/main/charts/aldo-ai',
              external: true,
            }}
            tone="emerald"
          />
        </div>

        <p className="mt-6 text-center text-[12px] text-slate-500">
          Source-available under{' '}
          <a
            href="https://fsl.software"
            className="underline hover:text-slate-300"
            target="_blank"
            rel="noreferrer"
          >
            FSL-1.1-ALv2
          </a>{' '}
          — read the source, run it on your own infra. Two-year MIT conversion built in.
        </p>
      </div>
    </section>
  );
}

function CtaPanel({
  tag,
  title,
  description,
  stats,
  primary,
  secondary,
  tone,
}: {
  tag: string;
  title: string;
  description: string;
  stats: ReadonlyArray<{ k: string; v: string }>;
  primary: { label: string; href: string };
  secondary: { label: string; href: string; external?: boolean };
  tone: 'accent' | 'emerald';
}) {
  const tagCls =
    tone === 'accent'
      ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  const primaryCls =
    tone === 'accent'
      ? 'bg-blue-600 text-white hover:bg-blue-500'
      : 'bg-emerald-600 text-white hover:bg-emerald-500';
  const ringCls =
    tone === 'accent'
      ? 'ring-1 ring-blue-500/20 hover:ring-blue-500/40'
      : 'ring-1 ring-emerald-500/20 hover:ring-emerald-500/40';
  return (
    <article
      className={`flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition-shadow ${ringCls}`}
    >
      <span
        className={`self-start rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tagCls}`}
      >
        {tag}
      </span>
      <h3 className="mt-3 text-[20px] font-semibold tracking-tight text-white">{title}</h3>
      <p className="mt-2 text-[14px] leading-relaxed text-slate-300">{description}</p>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-800 pt-4 text-center">
        {stats.map((s) => (
          <div key={s.k}>
            <dt className="font-mono text-[11px] uppercase tracking-wider text-slate-500">{s.v}</dt>
            <dd className="mt-0.5 font-mono text-[14px] font-semibold text-white">{s.k}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href={primary.href}
          className={`rounded px-4 py-2.5 text-sm font-medium transition-colors ${primaryCls}`}
        >
          {primary.label} →
        </Link>
        {secondary.external ? (
          <a
            href={secondary.href}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-slate-700 bg-transparent px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800"
          >
            {secondary.label} ↗
          </a>
        ) : (
          <Link
            href={secondary.href}
            className="rounded border border-slate-700 bg-transparent px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800"
          >
            {secondary.label} →
          </Link>
        )}
      </div>
    </article>
  );
}
