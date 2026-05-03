/**
 * Resource hub — minimal grid of 12 cards linking deeper into the
 * product. Each card: small icon · title · one-line description · arrow.
 *
 * Server-rendered. Semantic tokens. The Architecture-diagram card
 * uses an `#architecture` in-page anchor that the homepage Architecture
 * section needs to expose (added in page.tsx in the same wave).
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

interface Resource {
  readonly title: string;
  readonly desc: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly external?: boolean;
}

const RESOURCES: ReadonlyArray<Resource> = [
  {
    title: 'Quickstart (5-min)',
    desc: 'Install the CLI, init an agency, run your first agent.',
    href: '/docs',
    icon: <RocketIcon />,
  },
  {
    title: 'API reference',
    desc: 'Scalar OpenAPI viewer over the v1 surface.',
    href: '/api/docs',
    icon: <ApiIcon />,
  },
  {
    title: 'Python SDK',
    desc: 'pip install aldo-ai · async-first, fully typed.',
    href: '/docs/sdks/python',
    icon: <PythonIcon />,
  },
  {
    title: 'TypeScript SDK',
    desc: 'npm i @aldo-ai/sdk · works in Node + edge runtimes.',
    href: '/docs/sdks/typescript',
    icon: <TsIcon />,
  },
  {
    title: 'MCP integration',
    desc: 'Claude, Cursor, ChatGPT, VS Code, Zed — copy-paste configs.',
    href: '/docs/guides/mcp-server',
    icon: <PlugIcon />,
  },
  {
    title: 'Self-hosting',
    desc: 'Helm chart + AWS-EKS / GCP-GKE / Azure-AKS Terraform.',
    href: '/docs/guides/self-hosting',
    icon: <ServerIcon />,
  },
  {
    title: 'Compare to LangSmith',
    desc: 'Row-by-row, where we win and where they do.',
    href: '/vs/langsmith',
    icon: <ScaleIcon />,
  },
  {
    title: 'Compare to Braintrust',
    desc: 'Eval platform vs runtime — the honest framing.',
    href: '/vs/braintrust',
    icon: <ScaleIcon />,
  },
  {
    title: 'Compare to CrewAI',
    desc: 'Framework library vs control-plane — different products.',
    href: '/vs/crewai',
    icon: <ScaleIcon />,
  },
  {
    title: 'Architecture diagram',
    desc: 'One picture: client → router → models. Privacy enforced at the edge.',
    href: '#architecture',
    icon: <DiagramIcon />,
  },
  {
    title: 'Status page',
    desc: 'In-house, polls every 30s. No third-party badge.',
    href: '/status',
    icon: <PulseIcon />,
  },
  {
    title: 'Changelog',
    desc: 'What we shipped, the wave it landed in, the receipts.',
    href: '/changelog',
    icon: <ScrollIcon />,
  },
];

export function ResourceHub() {
  return (
    <section id="resources" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-12 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Dive deeper
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            Twelve doors into the product.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            Pick the surface that matches the job — read the source, copy the SDK config, audit the
            comparison tables, or watch the status page in real time.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RESOURCES.map((r) => (
            <li key={r.title}>
              <Link
                href={r.href}
                {...(r.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                className="group flex h-full items-start gap-3 rounded-lg border border-border bg-bg p-4 transition-all hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-border bg-bg-elevated text-fg-muted transition-colors group-hover:border-accent/50 group-hover:text-accent">
                  {r.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-semibold leading-snug text-fg">
                      {r.title}
                    </span>
                    <span
                      aria-hidden
                      className="text-fg-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                    >
                      →
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">{r.desc}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─── Icons (14px, currentColor) ─────────────────────────────────────────

function svgWrap(children: ReactNode) {
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
      <title>icon</title>
      {children}
    </svg>
  );
}

function RocketIcon() {
  return svgWrap(
    <>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    </>,
  );
}
function ApiIcon() {
  return svgWrap(
    <>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </>,
  );
}
function PythonIcon() {
  return svgWrap(
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>,
  );
}
function TsIcon() {
  return svgWrap(
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7 9h6M10 9v8M16 11s1-1.5 2.5-1.5S21 11 21 11.5 19.5 13 19 13.5 17 14.5 17 15.5s1.5 1.5 2 1.5 2-.5 2-.5" />
    </>,
  );
}
function PlugIcon() {
  return svgWrap(
    <>
      <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8z" />
      <path d="M12 17v5" />
    </>,
  );
}
function ServerIcon() {
  return svgWrap(
    <>
      <rect x="2" y="4" width="20" height="6" rx="1" />
      <rect x="2" y="14" width="20" height="6" rx="1" />
      <line x1="6" y1="7" x2="6.01" y2="7" />
      <line x1="6" y1="17" x2="6.01" y2="17" />
    </>,
  );
}
function ScaleIcon() {
  return svgWrap(<path d="M16 16l3-8M8 16l-3-8M3 8h18M12 3v18" />);
}
function DiagramIcon() {
  return svgWrap(
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>,
  );
}
function PulseIcon() {
  return svgWrap(<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />);
}
function ScrollIcon() {
  return svgWrap(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </>,
  );
}
