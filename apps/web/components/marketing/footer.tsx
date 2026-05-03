/**
 * Marketing footer — server component, no JS.
 *
 * Wave-iter-2: expanded from a single-row 46-line strip into a proper
 * 4-column sitemap (Product / Developers / Company / Legal) with a
 * brand-mark + copyright + GitHub link bottom row. Every link goes
 * somewhere real; broken links here are a smell test.
 *
 * Theme-aware via semantic tokens — flips correctly under html.dark.
 * The repo URL was confirmed in iteration-2 brief.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

const CONTACT_EMAIL = 'info@aldo.tech';
const REPO_URL = 'https://github.com/zeljan-alduk/ai';

interface FooterLink {
  readonly label: string;
  readonly href: string;
  readonly external?: boolean;
}

interface FooterColumn {
  readonly title: string;
  readonly links: ReadonlyArray<FooterLink>;
}

const COLUMNS: ReadonlyArray<FooterColumn> = [
  {
    title: 'Product',
    links: [
      { label: 'Agents', href: '/agents' },
      { label: 'Runs', href: '/runs' },
      { label: 'Datasets', href: '/datasets' },
      { label: 'Eval Playground', href: '/eval/playground' },
      { label: 'Prompts', href: '/prompts' },
      { label: 'Threads', href: '/threads' },
      { label: 'Spend', href: '/observability/spend' },
      { label: 'Status', href: '/status' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Docs', href: '/docs' },
      { label: 'API reference', href: '/api/docs' },
      { label: 'Python SDK', href: '/docs/sdks/python' },
      { label: 'TypeScript SDK', href: '/docs/sdks/typescript' },
      { label: 'MCP server', href: '/docs/guides/mcp-server' },
      { label: 'VS Code extension', href: '/docs/sdks/typescript' },
      { label: 'Changelog', href: '/changelog' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Roadmap', href: '/roadmap' },
      { label: 'Compare', href: '/vs' },
      { label: 'Security', href: '/security' },
      { label: 'Contact', href: `mailto:${CONTACT_EMAIL}` },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Licence (FSL-1.1-ALv2)', href: 'https://fsl.software', external: true },
      { label: 'Privacy', href: '/security#privacy' },
      { label: 'Terms', href: '/security#terms' },
      { label: 'Data retention', href: '/security#retention' },
      { label: 'Sub-processors', href: '/security#sub-processors' },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-bg-elevated">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-14">
        {/* Brand strip */}
        <div className="mb-10 flex flex-col gap-4 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 items-center justify-center rounded bg-fg font-mono text-[11px] font-bold text-bg"
                aria-hidden
              >
                A
              </span>
              <span className="text-[15px] font-semibold text-fg">ALDO TECH LABS</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
              The control plane for agent teams. Privacy enforced by the platform. Local models
              first-class. Every run replayable. Built in-house, source-available.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="ALDO AI on GitHub"
              className="inline-flex items-center gap-2 rounded border border-border bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <GithubIcon />
              <span>Star on GitHub</span>
            </a>
            <Link
              href="/signup"
              className="inline-flex rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Start free trial →
            </Link>
          </div>
        </div>

        {/* Sitemap columns */}
        <nav aria-label="Footer sitemap" className="grid grid-cols-2 gap-8 sm:grid-cols-4 sm:gap-6">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg">
                {col.title}
              </h3>
              <ul className="mt-4 flex flex-col gap-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external || l.href.startsWith('mailto:') ? (
                      <a
                        href={l.href}
                        {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                        className="inline-flex text-[13px] text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {l.label}
                        {l.external ? (
                          <span aria-hidden className="ml-1 text-fg-faint">
                            ↗
                          </span>
                        ) : null}
                      </a>
                    ) : (
                      <Link
                        href={l.href}
                        className="inline-flex text-[13px] text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Bottom row */}
        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-[12px] text-fg-faint sm:flex-row sm:items-center sm:justify-between">
          <div>
            © ALDO TECH LABS · Built in-house ·{' '}
            <a
              href="https://fsl.software"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-fg"
            >
              FSL-1.1-ALv2
            </a>{' '}
            (Apache 2.0 in 2 yrs)
          </div>
          <div className="flex items-center gap-4">
            <Link href="/status" className="hover:text-fg">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                <span>System status</span>
              </span>
            </Link>
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-fg">
              {CONTACT_EMAIL}
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="text-fg-muted hover:text-fg"
            >
              <GithubIcon />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function GithubIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <title>GitHub</title>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
