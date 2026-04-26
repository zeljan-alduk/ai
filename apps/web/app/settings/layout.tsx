'use client';

import { cn } from '@/lib/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Settings shell — left sub-nav inside the protected app chrome.
 * Profile is the default landing page (/settings).
 *
 * Wave-15E mobile responsiveness:
 *   - Below `lg:` the left sub-nav becomes a horizontally scrolling
 *     chip strip pinned at the top of the page. Each chip is a
 *     `min-h-touch` link so it's easy to tap.
 *   - At `lg:` and up the original two-column layout returns.
 */

const SETTINGS_NAV = [
  { href: '/settings', label: 'Profile' },
  { href: '/settings/api-keys', label: 'API keys' },
  { href: '/settings/members', label: 'Members' },
  { href: '/settings/roles', label: 'Roles' },
  { href: '/settings/integrations', label: 'Integrations' },
  { href: '/settings/alerts', label: 'Alerts' },
  { href: '/settings/audit', label: 'Audit log' },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/settings') return pathname === '/settings';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/settings';
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      {/* Mobile / tablet: horizontal chip strip. */}
      <nav
        aria-label="Settings"
        className="-mx-1 flex shrink-0 items-center gap-2 overflow-x-auto px-1 pb-1 lg:hidden"
      >
        {SETTINGS_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-touch shrink-0 items-center whitespace-nowrap rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                active
                  ? 'border-fg bg-fg text-fg-inverse'
                  : 'border-border bg-bg-elevated text-fg-muted hover:bg-bg-subtle hover:text-fg',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {/* Desktop: vertical sub-nav. */}
      <aside className="hidden w-48 shrink-0 lg:block">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Settings
        </h2>
        <nav aria-label="Settings" className="flex flex-col gap-0.5">
          {SETTINGS_NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-touch items-center rounded px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-bg-subtle font-medium text-fg'
                    : 'text-fg-muted hover:bg-bg-subtle hover:text-fg',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
