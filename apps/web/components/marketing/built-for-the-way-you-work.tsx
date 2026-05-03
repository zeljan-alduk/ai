/**
 * "Built for the way you work" — three personas, three columns.
 *
 * Engineer · PM/Founder · SRE/Ops. Each column is four sub-points,
 * each with a tiny inline icon (pure SVG, currentColor) and a
 * deep-link to the surface that proves the claim.
 *
 * NO generic three-feature cards. The columns are intentionally
 * different — engineer gets infra deep-links, PM gets dashboards,
 * SRE gets compliance + self-host.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

interface Persona {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly tone: 'accent' | 'success' | 'warning';
  readonly points: ReadonlyArray<{
    readonly icon: ReactNode;
    readonly title: string;
    readonly body: string;
  }>;
  readonly cta: { readonly label: string; readonly href: string };
}

const PERSONAS: ReadonlyArray<Persona> = [
  {
    id: 'engineer',
    title: 'Engineer',
    subtitle: 'YAML in, runs out. No mystery.',
    tone: 'accent',
    points: [
      {
        icon: <CodeIcon />,
        title: 'Agents-as-data',
        body: 'YAML specs, versioned, eval-gated. Edit one in your IDE, push, watch the gate pass or fail.',
      },
      {
        icon: <PluginIcon />,
        title: 'MCP-first tool layer',
        body: "Tools are MCP servers. Bespoke is allowed but discouraged. Drop in @aldo-ai/mcp-fs, you're done.",
      },
      {
        icon: <ReplayIcon />,
        title: 'Replay any step',
        body: 'Pick a checkpoint, fork through any provider, side-by-side diff. Same input, fresh route.',
      },
      {
        icon: <GitIcon />,
        title: 'Fork via git',
        body: 'Connect a repo, point at aldo/agents/*.yaml. Webhook syncs on push. Specs live with code.',
      },
    ],
    cta: { label: 'Read the SDK docs →', href: '/docs/sdks/python' },
  },
  {
    id: 'pm',
    title: 'PM / Founder',
    subtitle: "Ship fast. Don't lose money.",
    tone: 'success',
    points: [
      {
        icon: <GateIcon />,
        title: 'Eval gates',
        body: 'Promotion blocks on regression. No "we forgot to re-run the eval" ever again.',
      },
      {
        icon: <DollarIcon />,
        title: 'Spend dashboard',
        body: 'Today / WTD / MTD with projected end-of-month, broken down by capability, agent, and project.',
      },
      {
        icon: <BellIcon />,
        title: 'Budget alerts',
        body: 'Tenant-wide caps + per-project soft thresholds. Slack + email + webhook. Never wake up to a surprise bill.',
      },
      {
        icon: <ShareIcon />,
        title: 'Share-by-URL',
        body: 'Public read-only run links with optional argon2id-hashed password. Send a customer the receipt.',
      },
    ],
    cta: { label: 'See the spend dashboard →', href: '/observability/spend' },
  },
  {
    id: 'sre',
    title: 'SRE / Ops',
    subtitle: 'Sign off the security review.',
    tone: 'warning',
    points: [
      {
        icon: <ShieldIcon />,
        title: 'Privacy tier as platform invariant',
        body: 'Sensitive agents physically cannot reach a cloud model. Router fails closed. No author convention.',
      },
      {
        icon: <AuditIcon />,
        title: 'Audit log',
        body: 'Every privileged action is logged with actor + tenant + reason. Exportable, immutable, queryable.',
      },
      {
        icon: <StatusIcon />,
        title: 'Status page',
        body: 'In-house /status, polls every 30s, ISR-backed timeline. No third-party badge.',
      },
      {
        icon: <HelmIcon />,
        title: 'Helm + Terraform self-host',
        body: 'charts/aldo-ai/ Helm chart (lint + kubeconform clean) + AWS-EKS / GCP-GKE / Azure-AKS Terraform modules.',
      },
    ],
    cta: { label: 'Self-host guide →', href: '/docs/guides/self-hosting' },
  },
];

const TONE_RING: Record<Persona['tone'], string> = {
  accent: 'border-accent/40 bg-accent/5',
  success: 'border-success/40 bg-success/5',
  warning: 'border-warning/40 bg-warning/5',
};

const TONE_TEXT: Record<Persona['tone'], string> = {
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
};

export function BuiltForTheWayYouWork() {
  return (
    <section id="personas" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-12 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Built for the way you work
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            Three roles, three rooms in the same house.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            We don&rsquo;t ship a "personas page" for marketing. The product is genuinely shaped
            around three jobs — author the agent, monitor the spend, sign off the deploy.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {PERSONAS.map((p) => (
            <article
              key={p.id}
              className={`flex flex-col rounded-xl border p-6 ${TONE_RING[p.tone]}`}
            >
              <header className="border-b border-border pb-4">
                <div
                  className={`text-[11px] font-semibold uppercase tracking-wider ${TONE_TEXT[p.tone]}`}
                >
                  {p.title}
                </div>
                <div className="mt-1 text-[15px] font-semibold text-fg">{p.subtitle}</div>
              </header>
              <ul className="mt-5 space-y-4">
                {p.points.map((pt) => (
                  <li key={pt.title} className="flex gap-3">
                    <span
                      className={`flex h-7 w-7 flex-none items-center justify-center rounded-md border border-border bg-bg-elevated ${TONE_TEXT[p.tone]}`}
                      aria-hidden
                    >
                      {pt.icon}
                    </span>
                    <div>
                      <div className="text-[14px] font-semibold text-fg">{pt.title}</div>
                      <div className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">
                        {pt.body}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <Link
                href={p.cta.href}
                className={`mt-auto inline-flex pt-5 text-[13px] font-medium ${TONE_TEXT[p.tone]} hover:underline`}
              >
                {p.cta.label}
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Icons (12px, currentColor) ─────────────────────────────────────────

function ic(d: string) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>icon</title>
      <path d={d} />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}
function PluginIcon() {
  return ic('M9 2v4M15 2v4M3 9h4M3 15h4M9 22v-4M15 22v-4M21 9h-4M21 15h-4M7 7h10v10H7z');
}
function ReplayIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}
function GitIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="6" cy="3" r="2.5" />
      <circle cx="6" cy="21" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M6 5.5v13M8.5 12h7M6 6c0 4 12 4 12 6" />
    </svg>
  );
}
function GateIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function DollarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
function ShareIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function AuditIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}
function StatusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function HelmIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
