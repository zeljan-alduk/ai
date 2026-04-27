/**
 * Layout for the `/docs/*` route tree.
 *
 * The docs surface lives outside the `(marketing)` route group so it
 * can mount its own chrome:
 *   - top bar with logo + Cmd-K hint + GitHub link
 *   - left sidebar (collapsible by section, highlights current page)
 *   - main column: page content with prose styling
 *   - right rail: per-page table of contents (rendered in the page)
 *
 * The root layout still treats `/docs` as a chromeless path (no app
 * sidebar, no auth fetch), which keeps the docs surface fully public
 * and fast for unauthenticated visitors. The Cmd-K palette is mounted
 * by the root layout — wave 15 wires the docs search index into it.
 *
 * LLM-agnostic: the docs chrome itself never names a provider. Pages
 * about local-model adapters do mention runtime backends (Ollama,
 * MLX, …), which is allowed because those are runtime adapter ids,
 * not LLM providers.
 */

import { DocsSidebar } from '@/components/docs/sidebar';
import { listAllDocPages } from '@/lib/docs/loader';
import { Search } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function DocsLayout({ children }: { children: ReactNode }) {
  const pages = listAllDocPages();
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <DocsTopBar />
      <div className="flex flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-border px-4 py-6 lg:block">
          <div className="sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto">
            <DocsSidebar pages={pages} />
          </div>
        </aside>
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}

function DocsTopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg/80 px-4 backdrop-blur">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-fg">
          <span aria-hidden="true" className="inline-block h-5 w-5 rounded bg-accent" />
          ALDO AI
        </Link>
        <nav className="flex items-center gap-4 text-sm text-fg-muted">
          <Link href="/docs" className="hover:text-fg">
            Docs
          </Link>
          <Link href="/docs/quickstart" className="hover:text-fg">
            Quickstart
          </Link>
          <Link href="/docs/api" className="hover:text-fg">
            API
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <span
          className="hidden items-center gap-2 rounded border border-border px-2 py-1 text-xs text-fg-muted md:inline-flex"
          title="Open the command palette to search docs"
        >
          <Search aria-hidden="true" className="h-3 w-3" />
          Search
          <kbd className="rounded bg-bg-subtle px-1 font-mono text-[10px]">
            <span className="hidden sm:inline">Cmd</span>
            <span className="sm:hidden">Ctrl</span>+K
          </kbd>
        </span>
        {/* GitHub link removed — repository is private. */}
      </div>
    </header>
  );
}
