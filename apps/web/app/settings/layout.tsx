import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Settings shell — left sub-nav inside the protected app chrome.
 * Profile is the default landing page (/settings).
 */

const SETTINGS_NAV = [
  { href: '/settings', label: 'Profile' },
  { href: '/settings/api-keys', label: 'API keys' },
  { href: '/settings/members', label: 'Members' },
  { href: '/settings/roles', label: 'Roles' },
  { href: '/settings/audit', label: 'Audit log' },
] as const;

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-8">
      <aside className="w-48 shrink-0">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Settings
        </h2>
        <nav className="flex flex-col gap-0.5">
          {SETTINGS_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
