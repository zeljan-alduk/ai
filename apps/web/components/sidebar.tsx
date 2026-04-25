'use client';

import { logoutAction } from '@/app/(auth)/actions';
import { switchTenantAction } from '@/components/sidebar-actions';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const NAV: ReadonlyArray<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: '/runs', label: 'Runs', match: (p) => p === '/runs' || p.startsWith('/runs/') },
  { href: '/agents', label: 'Agents', match: (p) => p === '/agents' || p.startsWith('/agents/') },
  {
    href: '/secrets',
    label: 'Secrets',
    match: (p) => p === '/secrets' || p.startsWith('/secrets/'),
  },
  { href: '/models', label: 'Models', match: (p) => p === '/models' || p.startsWith('/models/') },
  {
    href: '/billing',
    label: 'Billing',
    match: (p) => p === '/billing' || p.startsWith('/billing/'),
  },
  { href: '/eval', label: 'Eval', match: (p) => p === '/eval' || p.startsWith('/eval/') },
  { href: '/docs', label: 'Docs', match: (p) => p.startsWith('/docs') },
];

/** Match `/runs/<id>` and any sub-route (e.g. `/runs/<id>/debug`). */
const RUN_DETAIL_RE = /^\/runs\/([^/]+)(?:\/.*)?$/;

export interface SidebarUser {
  readonly email: string;
  readonly currentTenantSlug: string;
  readonly currentTenantName: string;
  readonly memberships: ReadonlyArray<{ tenantSlug: string; tenantName: string }>;
}

export function Sidebar({ user }: { user: SidebarUser | null }) {
  const pathname = usePathname() ?? '/';
  const runMatch = RUN_DETAIL_RE.exec(pathname);
  const runId = runMatch?.[1] ? decodeURIComponent(runMatch[1]) : null;
  const onDebug = runId ? pathname === `/runs/${encodeURIComponent(runId)}/debug` : false;

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-slate-200">
        <div className="h-6 w-6 rounded bg-slate-900" aria-hidden />
        <div>
          <div className="text-sm font-semibold leading-tight text-slate-900">ALDO AI</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">control plane</div>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded px-3 py-2 text-sm transition-colors ${
                active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        {runId ? (
          <div className="mt-1 ml-2 flex flex-col gap-0.5 border-l border-slate-200 pl-2">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-400">
              Run {runId.slice(0, 8)}
            </div>
            <Link
              href={`/runs/${encodeURIComponent(runId)}`}
              className={`rounded px-3 py-1.5 text-xs transition-colors ${
                pathname === `/runs/${encodeURIComponent(runId)}`
                  ? 'bg-slate-200 text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Detail
            </Link>
            <Link
              href={`/runs/${encodeURIComponent(runId)}/debug`}
              className={`rounded px-3 py-1.5 text-xs transition-colors ${
                onDebug ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Debug
            </Link>
          </div>
        ) : null}
      </nav>
      <div className="mt-auto border-t border-slate-200 p-3">
        {user ? <UserMenu user={user} /> : <SignedOutFooter />}
      </div>
    </aside>
  );
}

function SignedOutFooter() {
  return (
    <Link
      href="/login"
      className="block rounded px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
    >
      Sign in
    </Link>
  );
}

function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? email;
  // Take first two non-empty alphabetic characters; uppercase. Falls
  // back to first 2 chars of the local-part for short / weird inputs.
  const letters = local.replace(/[^a-z]/gi, '');
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

function UserMenu({ user }: { user: SidebarUser }) {
  const [open, setOpen] = useState(false);
  const otherMemberships = user.memberships.filter((m) => m.tenantSlug !== user.currentTenantSlug);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left hover:bg-slate-100"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
          {initialsOf(user.email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-slate-900" title={user.email}>
            {user.email}
          </span>
          <span
            className="block truncate text-[10px] uppercase tracking-wider text-slate-500"
            title={user.currentTenantName}
          >
            {user.currentTenantSlug}
          </span>
        </span>
        <span aria-hidden className="text-slate-400">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 mb-1 rounded-md border border-slate-200 bg-white p-1 shadow-md"
        >
          {otherMemberships.length > 0 ? (
            <>
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400">
                Switch tenant
              </div>
              {otherMemberships.map((m) => (
                <form key={m.tenantSlug} action={switchTenantAction} className="block">
                  <input type="hidden" name="tenantSlug" value={m.tenantSlug} />
                  <button
                    type="submit"
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100"
                  >
                    <span className="truncate text-slate-700" title={m.tenantName}>
                      {m.tenantName}
                    </span>
                    <span className="text-[10px] text-slate-400">{m.tenantSlug}</span>
                  </button>
                </form>
              ))}
              <div className="my-1 border-t border-slate-200" />
            </>
          ) : null}
          <form action={logoutAction}>
            <button
              type="submit"
              className="block w-full rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
            >
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
