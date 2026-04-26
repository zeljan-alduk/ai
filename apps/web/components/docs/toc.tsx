/**
 * Right-rail in-page table of contents.
 *
 * Pure server component: takes the heading list extracted by
 * `lib/docs/loader.ts` and renders an anchor list. Smooth-scroll on
 * click is handled by the browser via the `id=` attributes injected
 * by the loader's heading renderer.
 *
 * No client component is needed because the active-heading highlight
 * (scroll-spy) is opt-in — see `toc-scroll-spy.tsx` if a follow-up
 * wants to add it.
 *
 * LLM-agnostic: the TOC just mirrors the page structure.
 */

import type { DocHeading } from '@/lib/docs/loader';

export interface DocsTocProps {
  readonly headings: ReadonlyArray<DocHeading>;
}

export function DocsToc({ headings }: DocsTocProps) {
  if (headings.length === 0) {
    return <div className="text-xs text-fg-muted">No sub-sections on this page.</div>;
  }
  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        On this page
      </p>
      <ul className="space-y-1">
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? 'ml-3 border-l border-border pl-2' : ''}>
            <a href={`#${h.id}`} className="block py-0.5 text-fg-muted hover:text-fg">
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
