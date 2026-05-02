'use client';

/**
 * Docs left-rail navigation. Server-rendered into the docs layout;
 * the client component only owns the active-page highlight + the
 * collapse/expand animation on each section.
 *
 * Sections are taken from `DOC_SECTIONS`; pages within each section
 * preserve their order in `STATIC_DOC_PAGES`. Generated API pages
 * are filtered out of the sidebar — they live behind the API
 * landing page which has its own searchable index.
 *
 * Active-page detection uses Next's `usePathname()` — the segment
 * after `/docs/` is matched against each page's slug. The `/docs`
 * landing matches an empty slug.
 *
 * LLM-agnostic: nav labels never name a provider.
 */

import { cn } from '@/lib/cn';
import { DOC_SECTIONS, type DocPage } from '@/lib/docs/registry';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';

export interface DocsSidebarProps {
  readonly pages: ReadonlyArray<DocPage>;
}

export function DocsSidebar({ pages }: DocsSidebarProps) {
  const pathname = usePathname();
  const currentSlug = useMemo(() => {
    if (!pathname) return '';
    if (pathname === '/docs') return '';
    return pathname.replace(/^\/docs\//, '').replace(/\/$/, '');
  }, [pathname]);

  // Group pages by section, dropping the auto-generated API rows.
  const grouped = useMemo(() => {
    const out = new Map<string, DocPage[]>();
    for (const section of DOC_SECTIONS) out.set(section.key, []);
    for (const page of pages) {
      if (page.generated) continue;
      const arr = out.get(page.section);
      if (arr) arr.push(page);
    }
    return out;
  }, [pages]);

  return (
    <nav aria-label="Docs navigation" className="space-y-6 text-sm">
      {DOC_SECTIONS.map((section) => {
        const items = grouped.get(section.key);
        if (!items || items.length === 0) return null;
        return (
          <DocsSidebarSection
            key={section.key}
            label={section.label}
            items={items}
            currentSlug={currentSlug}
          />
        );
      })}
      <DocsSidebarReference />
    </nav>
  );
}

/**
 * "Reference & tools" — pinned to the bottom of the docs sidebar.
 * These links leave the curated /docs surface and land on the
 * auto-generated OpenAPI viewers (Scalar at /api/docs, Redoc at
 * /api/redoc) and the raw spec at /openapi.json. Always visible so
 * a developer never has to hunt for the interactive reference.
 */
function DocsSidebarReference() {
  return (
    <div>
      <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Reference &amp; tools
      </p>
      <ul className="mt-1 space-y-0.5">
        <li>
          <Link
            href="/api/docs"
            className="block rounded px-2 py-1 text-fg-muted transition-colors hover:bg-bg-subtle/50 hover:text-fg"
          >
            API reference (interactive)
          </Link>
        </li>
        <li>
          <Link
            href="/api/redoc"
            className="block rounded px-2 py-1 text-fg-muted transition-colors hover:bg-bg-subtle/50 hover:text-fg"
          >
            API reference (read-only)
          </Link>
        </li>
        <li>
          <a
            href="/openapi.json"
            className="block rounded px-2 py-1 font-mono text-[12px] text-fg-muted transition-colors hover:bg-bg-subtle/50 hover:text-fg"
          >
            openapi.json
          </a>
        </li>
        <li>
          <Link
            href="/changelog"
            className="block rounded px-2 py-1 text-fg-muted transition-colors hover:bg-bg-subtle/50 hover:text-fg"
          >
            Changelog
          </Link>
        </li>
        <li>
          <Link
            href="/status"
            className="block rounded px-2 py-1 text-fg-muted transition-colors hover:bg-bg-subtle/50 hover:text-fg"
          >
            System status
          </Link>
        </li>
      </ul>
    </div>
  );
}

interface DocsSidebarSectionProps {
  readonly label: string;
  readonly items: ReadonlyArray<DocPage>;
  readonly currentSlug: string;
}

function DocsSidebarSection({ label, items, currentSlug }: DocsSidebarSectionProps) {
  const sectionContainsCurrent = items.some((item) => item.slug === currentSlug);
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide text-fg-muted hover:text-fg"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span>{label}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn('h-3 w-3 transition-transform', !open && '-rotate-90')}
        />
      </button>
      {open ? (
        <ul className="mt-1 space-y-0.5">
          {items.map((item) => {
            const active =
              item.slug === currentSlug ||
              (item.slug === '' && currentSlug === '') ||
              (sectionContainsCurrent &&
                item.slug !== '' &&
                currentSlug.startsWith(`${item.slug}/`));
            const href = item.slug === '' ? '/docs' : `/docs/${item.slug}`;
            return (
              <li key={item.slug || 'index'}>
                <Link
                  href={href}
                  className={cn(
                    'block rounded px-2 py-1 transition-colors',
                    active
                      ? 'bg-bg-subtle font-medium text-fg'
                      : 'text-fg-muted hover:bg-bg-subtle/50 hover:text-fg',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.title}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
