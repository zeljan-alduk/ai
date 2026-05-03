/**
 * FAQ — six hard questions, real <details> elements (keyboard +
 * screen-reader accessible by default; no div-with-onclick).
 *
 * Don't over-design. Open one to read it; close to move on.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

interface QA {
  readonly q: string;
  readonly a: ReactNode;
  readonly defaultOpen?: boolean;
}

const QAS: ReadonlyArray<QA> = [
  {
    q: 'How is this different from LangSmith or Braintrust?',
    a: (
      <>
        <p>
          LangSmith is observability + evals around whatever agent stack you have. Braintrust is the
          sharpest dedicated eval platform on the market. Neither is an agent runtime — they sit{' '}
          <em>next to</em> one.
        </p>
        <p className="mt-2">
          ALDO is the runtime itself, with eval + observability + privacy + replay built in. The
          honest question is whether you want to glue three vendors together or run one platform
          end-to-end. Read the deep dives:{' '}
          <Link className="text-accent hover:underline" href="/vs/langsmith">
            vs LangSmith
          </Link>
          ,{' '}
          <Link className="text-accent hover:underline" href="/vs/braintrust">
            vs Braintrust
          </Link>
          .
        </p>
      </>
    ),
    defaultOpen: true,
  },
  {
    q: 'Can I use my own model?',
    a: (
      <>
        <p>
          Yes. Routing is <strong>capability-based</strong> — your agent declares it needs{' '}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px]">
            reasoning-strong
          </code>{' '}
          or{' '}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px]">
            fast-local
          </code>
          , and the gateway picks a model that satisfies it. Add a new provider via config; no code
          change.
        </p>
        <p className="mt-2">
          Out of the box: 5 local runtimes (Ollama, vLLM, llama.cpp, MLX, LM Studio)
          auto-discovered, plus 4 frontier providers behind your own API keys.{' '}
          <Link className="text-accent hover:underline" href="/models">
            See the registry
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    q: 'Can I self-host?',
    a: (
      <>
        <p>
          Yes — the same product the cloud tenants use, packaged as a Helm chart at{' '}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px]">
            charts/aldo-ai/
          </code>{' '}
          plus Terraform modules for AWS-EKS, GCP-GKE, and Azure-AKS. Helm lint + kubeconform clean
          against k8s 1.31.
        </p>
        <p className="mt-2">
          OCI publish to{' '}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px]">ghcr.io</code>{' '}
          is in flight (one-shot{' '}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px]">
            helm push
          </code>
          ); today you clone the repo and{' '}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px]">
            helm install
          </code>{' '}
          locally.{' '}
          <Link className="text-accent hover:underline" href="/docs/guides/self-hosting">
            Self-hosting guide →
          </Link>
        </p>
      </>
    ),
  },
  {
    q: 'Is my data leaving my infrastructure?',
    a: (
      <>
        <p>
          For agents you mark{' '}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px]">
            privacy_tier: sensitive
          </code>
          : no. The router is the platform invariant — sensitive agents are physically incapable of
          reaching a cloud provider. The router fails closed before a token leaves your tenant
          boundary.
        </p>
        <p className="mt-2">
          For agents you mark{' '}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px]">internal</code>{' '}
          or{' '}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px]">public</code>:
          you choose, and the choice is in the spec, not the prompt.{' '}
          <Link className="text-accent hover:underline" href="/security">
            Read the security page
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    q: 'Do you have SOC 2?',
    a: (
      <>
        <p>
          Honest answer: not yet. <strong>SOC 2 Type 1 is in flight</strong>; Type 2 is the
          follow-up. We won&rsquo;t pretend otherwise on the marketing site.
        </p>
        <p className="mt-2">
          We <em>do</em> ship the platform invariants you&rsquo;d audit for: privacy-tier
          enforcement, audit log on every privileged action, configurable retention windows,
          process-isolated tool execution, secrets at rest in a SecretStore.{' '}
          <Link className="text-accent hover:underline" href="/security">
            Compliance posture →
          </Link>
        </p>
      </>
    ),
  },
  {
    q: "What's the pricing?",
    a: (
      <>
        <p>Public, three tiers, no contact-sales-required for SMB:</p>
        <ul className="mt-2 space-y-1 text-fg">
          <li>
            <strong>Solo</strong> — $29/mo. Single seat, cloud tenant, all features.
          </li>
          <li>
            <strong>Team</strong> — $99/mo. Up to 10 seats, projects, SSO follow-up.
          </li>
          <li>
            <strong>Enterprise</strong> — contact us. Self-host, packaged build, MSA, SLA.
          </li>
        </ul>
        <p className="mt-2">
          14-day trial on Solo + Team, no card required.{' '}
          <Link className="text-accent hover:underline" href="/pricing">
            Pricing page →
          </Link>
        </p>
      </>
    ),
  },
];

export function Faq() {
  return (
    <section className="border-t border-border bg-bg-elevated">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-10 max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Frequently asked
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            Six questions we get every week.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            If yours isn&rsquo;t here, the cheapest answer is to email us — we read every one.
          </p>
        </div>

        <ul className="space-y-3">
          {QAS.map((qa) => (
            <li key={qa.q}>
              <details
                className="group rounded-lg border border-border bg-bg p-5 transition-colors open:border-border-strong open:bg-bg-elevated"
                open={qa.defaultOpen}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-fg [&::-webkit-details-marker]:hidden">
                  <span>{qa.q}</span>
                  <span
                    aria-hidden
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-border text-fg-muted transition-transform group-open:rotate-45"
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    >
                      <title>toggle</title>
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                </summary>
                <div className="mt-3 text-[14px] leading-relaxed text-fg-muted">{qa.a}</div>
              </details>
            </li>
          ))}
        </ul>

        <div className="mt-8 rounded-lg border border-border bg-bg p-5 text-center text-sm text-fg-muted sm:flex sm:items-center sm:justify-between sm:text-left">
          <span>
            Different question? We answer email like it&rsquo;s a support ticket — usually same day.
          </span>
          <a
            href="mailto:info@aldo.tech?subject=ALDO%20AI%20%E2%80%94%20a%20question"
            className="mt-3 inline-flex rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover sm:mt-0"
          >
            info@aldo.tech →
          </a>
        </div>
      </div>
    </section>
  );
}
