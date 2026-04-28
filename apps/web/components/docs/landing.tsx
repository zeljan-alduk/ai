/**
 * Docs landing layout — hero + section grid.
 *
 * Pure server component. Renders four region-of-interest cards per
 * section so the landing page works as both a navigation surface and
 * a "what is this?" overview for first-time visitors.
 *
 * LLM-agnostic: the labels and copy reference platform concepts
 * (capability classes, privacy tiers, …) — never a model provider.
 */

import { ArrowUpRight, BookOpen, Code, Compass, FileText, Hammer, Library } from 'lucide-react';
import Link from 'next/link';

import type { DocPage, DocSectionKey } from '@/lib/docs/registry';

export interface LandingSection {
  readonly key: DocSectionKey;
  readonly label: string;
  readonly description: string;
  readonly pages: ReadonlyArray<DocPage>;
}

export interface DocsLandingProps {
  readonly sections: ReadonlyArray<LandingSection>;
  readonly quickstart: { title: string; summary: string; slug: string } | null;
}

const SECTION_ICONS: Record<DocSectionKey, typeof BookOpen> = {
  overview: Compass,
  concepts: Library,
  guides: Hammer,
  api: Code,
  sdks: FileText,
  reference: BookOpen,
};

export function DocsLanding({ sections, quickstart }: DocsLandingProps) {
  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <header className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Documentation</p>
        <h1 className="text-4xl font-semibold tracking-tight text-fg">
          Build, route, and replay AI agents you can trust.
        </h1>
        <p className="max-w-2xl text-lg text-fg-muted">
          ALDO AI is the LLM-agnostic agent orchestrator. Define agents as YAML, route by capability
          class, enforce privacy at the platform layer, and replay every run. These docs cover the
          full surface — from your first signup to running fully self-hosted.
        </p>
        <div className="flex flex-wrap gap-3">
          {quickstart ? (
            <Link
              href={`/docs/${quickstart.slug}`}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              Start the 5-minute quickstart
              <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          ) : null}
          <Link
            href="/docs/api"
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg-subtle"
          >
            Browse the API reference
          </Link>
          <Link
            href="/api/docs"
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg-subtle"
          >
            Open Swagger UI
            <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
        <p className="text-xs text-fg-muted">
          Prefer Redoc?{' '}
          <Link href="/api/redoc" className="underline hover:text-fg">
            Three-column read-only reference
          </Link>
          . Need the raw spec?{' '}
          <Link href="/openapi.json" className="underline hover:text-fg">
            <code className="font-mono text-[12px]">openapi.json</code>
          </Link>
          .
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        {sections.map((section) => {
          const Icon = SECTION_ICONS[section.key] ?? BookOpen;
          return (
            <section
              key={section.key}
              className="rounded-lg border border-border bg-bg-elevated p-6"
            >
              <div className="flex items-center gap-3">
                <Icon aria-hidden="true" className="h-5 w-5 text-accent" />
                <h2 className="text-lg font-semibold text-fg">{section.label}</h2>
              </div>
              {section.description ? (
                <p className="mt-1 text-sm text-fg-muted">{section.description}</p>
              ) : null}
              <ul className="mt-4 space-y-2">
                {section.pages.slice(0, 6).map((page) => (
                  <li key={page.slug}>
                    <Link
                      href={`/docs/${page.slug}`}
                      className="group flex items-start justify-between gap-3 rounded-md px-2 py-1 text-sm hover:bg-bg-subtle"
                    >
                      <span className="flex-1">
                        <span className="block font-medium text-fg">{page.title}</span>
                        <span className="block text-xs text-fg-muted">{page.summary}</span>
                      </span>
                      <ArrowUpRight
                        aria-hidden="true"
                        className="mt-0.5 h-3.5 w-3.5 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
              {section.pages.length > 6 ? (
                <p className="mt-2 text-xs text-fg-muted">
                  +{section.pages.length - 6} more in the sidebar
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
