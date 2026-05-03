'use client';

/**
 * Sticky right-edge section nav rail (≥ lg only).
 *
 * Lists every top-level homepage section. Highlights the section
 * currently in view via a single IntersectionObserver — no scroll
 * listener, no rAF loop. Hidden on viewports below `lg` (the
 * homepage on mobile gets the same content top-to-bottom; the rail
 * would crowd a small viewport).
 *
 * Targets must exist as elements with the matching `id`. Each
 * homepage section in `(marketing)/page.tsx` carries an id —
 * keep this list in sync with that file.
 *
 * Real semantic markup: `<aside aria-label="Section navigation">`,
 * `<nav>`, `<a>` with focus-visible rings.
 */

import { useEffect, useState } from 'react';

interface NavItem {
  readonly id: string;
  readonly label: string;
}

const ITEMS: ReadonlyArray<NavItem> = [
  { id: 'five-things', label: 'Five things' },
  { id: 'product-surfaces', label: 'See it in motion' },
  { id: 'use-cases', label: 'Use cases' },
  { id: 'define-an-agent', label: 'Define an agent' },
  { id: 'replay', label: 'Replay' },
  { id: 'cli-quickstart', label: '30s quickstart' },
  { id: 'personas', label: 'For your role' },
  { id: 'comparison', label: 'Comparison' },
  { id: 'ecosystem', label: 'Ecosystem' },
  { id: 'mcp', label: 'MCP' },
  { id: 'built-in-the-open', label: 'Built in the open' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'resources', label: 'Resources' },
  { id: 'faq', label: 'FAQ' },
  { id: 'newsletter', label: 'Newsletter' },
  { id: 'why-we-built', label: 'Why we built it' },
  { id: 'get-started', label: 'Get started' },
];

export function SectionNavRail() {
  const [active, setActive] = useState<string>(ITEMS[0]?.id ?? '');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof IntersectionObserver === 'undefined') return;

    // Map of id → IntersectionObserverEntry. We pick the most-visible
    // entry on every callback. rootMargin nudges the trigger so a
    // section is "active" as soon as its top crosses ~30% from the
    // top of the viewport.
    const observed = new Map<string, IntersectionObserverEntry>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          observed.set(e.target.id, e);
        }
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, e] of observed) {
          if (e.isIntersecting && e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            bestId = id;
          }
        }
        if (bestId) setActive(bestId);
      },
      {
        rootMargin: '-30% 0px -55% 0px',
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );

    const targets: HTMLElement[] = [];
    for (const it of ITEMS) {
      const el = document.getElementById(it.id);
      if (el) {
        observer.observe(el);
        targets.push(el);
      }
    }

    return () => {
      for (const el of targets) observer.unobserve(el);
      observer.disconnect();
    };
  }, []);

  return (
    <aside
      aria-label="Section navigation"
      // Hide below lg — mobile users scroll naturally; the rail would
      // crowd a small viewport. Pinned to the right edge with a small
      // gutter, vertically centered, max height capped to keep room
      // for the global header + footer.
      className="pointer-events-none fixed top-1/2 right-3 z-30 hidden -translate-y-1/2 lg:block"
    >
      <nav className="pointer-events-auto rounded-xl border border-border bg-bg-elevated/80 px-2 py-3 shadow-md backdrop-blur supports-[backdrop-filter]:bg-bg-elevated/60">
        <ul className="flex max-h-[70vh] flex-col gap-0.5 overflow-y-auto pr-0.5">
          {ITEMS.map((it) => {
            const isActive = it.id === active;
            return (
              <li key={it.id}>
                <a
                  href={`#${it.id}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={`group flex items-center gap-2 rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-fg-muted hover:bg-bg-subtle hover:text-fg'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-1 flex-none rounded-full transition-all ${
                      isActive ? 'w-3 bg-accent' : 'w-1.5 bg-fg-faint group-hover:bg-fg-muted'
                    }`}
                  />
                  <span className="truncate">{it.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
