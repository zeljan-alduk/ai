'use client';

import { logoutAction } from '@/app/(auth)/actions';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { switchTenantAction } from '@/components/sidebar-actions';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const NAV: ReadonlyArray<{ href: string; label: string; match: (p: string) => boolean }> = [
  // Wave-17 — projects entity. Foundation only in this wave: clicking a
  // project shows its settings, not yet a scoped view of work.
  {
    href: '/projects',
    label: 'Projects',
    match: (p) => p === '/projects' || p.startsWith('/projects/'),
  },
  { href: '/runs', label: 'Runs', match: (p) => p === '/runs' || p.startsWith('/runs/') },
  // Wave-14 — between Runs and Agents per the brief.
  {
    href: '/dashboards',
    label: 'Dashboards',
    match: (p) => p === '/dashboards' || p.startsWith('/dashboards/'),
  },
  {
    href: '/playground',
    label: 'Playground',
    match: (p) => p === '/playground' || p.startsWith('/playground/'),
  },
  { href: '/agents', label: 'Agents', match: (p) => p === '/agents' || p.startsWith('/agents/') },
  {
    href: '/secrets',
    label: 'Secrets',
    match: (p) => p === '/secrets' || p.startsWith('/secrets/'),
  },
  { href: '/models', label: 'Models', match: (p) => p === '/models' || p.startsWith('/models/') },
  {
    href: '/observability',
    label: 'Observability',
    match: (p) => p === '/observability' || p.startsWith('/observability/'),
  },
  // Wave-13 — between Observability and Billing per the brief.
  {
    href: '/activity',
    label: 'Activity',
    match: (p) => p === '/activity' || p.startsWith('/activity/'),
  },
  {
    href: '/billing',
    label: 'Billing',
    match: (p) => p === '/billing' || p.startsWith('/billing/'),
  },
  { href: '/eval', label: 'Eval', match: (p) => p === '/eval' || p.startsWith('/eval/') },
  // Wave-16 — Datasets between Eval and Models per the brief. (The
  // Eval section also gets an "Evaluators" sub-link rendered below
  // when the user is on /eval, /evaluators, or /datasets.)
  {
    href: '/datasets',
    label: 'Datasets',
    match: (p) => p === '/datasets' || p.startsWith('/datasets/'),
  },
  {
    href: '/settings',
    label: 'Settings',
    match: (p) => p === '/settings' || p.startsWith('/settings/'),
  },
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

/**
 * Top-level sidebar wrapper.
 *
 * Wave-15E mobile responsiveness:
 *   - At `lg:` and up the sidebar renders inline as a sticky aside,
 *     same as before.
 *   - Below `lg:` the aside is hidden and a floating hamburger button
 *     (rendered by `SidebarMobileTrigger`) opens a Sheet drawer.
 *   - The Sheet hosts the same nav. Tapping a nav link closes the
 *     drawer + navigates. Outside-area + the close affordance on the
 *     Sheet primitive both dismiss it. Radix already traps focus and
 *     restores it on close.
 */
export function Sidebar({ user }: { user: SidebarUser | null }) {
  const pathname = usePathname() ?? '/';
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close the drawer when the route changes — covers the case
  // where a Link click navigates without our onClick firing first
  // (e.g. tour-driven programmatic nav). The `pathname` dep is the
  // entire reason this effect re-runs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger we want; setMobileOpen is stable.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <SidebarMobileTrigger onClick={() => setMobileOpen(true)} />
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-bg-elevated lg:flex">
        <SidebarBody user={user} pathname={pathname} onNavigate={() => undefined} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[280px] p-0 sm:w-[300px] lg:hidden">
          <SheetTitle className="sr-only">Main navigation</SheetTitle>
          <SidebarBody user={user} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * The visible hamburger button that mounts inside the protected
 * layout's main area. Hidden at `lg:` and up where the sidebar is
 * docked. Top-left of the viewport with safe-area inset on iOS.
 */
export function SidebarMobileTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open navigation"
      className="fixed left-3 top-3 z-30 inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-bg-elevated text-fg shadow-sm hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg lg:hidden"
      style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <Menu className="h-5 w-5" aria-hidden />
    </button>
  );
}

function SidebarBody({
  user,
  pathname,
  onNavigate,
}: {
  user: SidebarUser | null;
  pathname: string;
  onNavigate: () => void;
}) {
  const runMatch = RUN_DETAIL_RE.exec(pathname);
  const runId = runMatch?.[1] ? decodeURIComponent(runMatch[1]) : null;
  const onDebug = runId ? pathname === `/runs/${encodeURIComponent(runId)}/debug` : false;
  const onLive = runId ? pathname === `/runs/${encodeURIComponent(runId)}/live` : false;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-5 py-5">
        <div className="h-6 w-6 rounded bg-fg" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight text-fg">ALDO AI</div>
          <div className="text-[11px] uppercase tracking-wider text-fg-muted">control plane</div>
        </div>
        {user ? <NotificationBell /> : null}
      </div>
      <nav aria-label="Primary" className="flex flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const active = item.match(pathname);
          const evalSubLinkAfter = item.href === '/eval';
          return (
            <div key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-touch items-center rounded px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  active
                    ? 'bg-fg text-fg-inverse'
                    : 'text-fg-muted hover:bg-bg-subtle hover:text-fg',
                )}
              >
                {item.label}
              </Link>
              {evalSubLinkAfter ? (
                <EvalSubLinks pathname={pathname} onNavigate={onNavigate} />
              ) : null}
            </div>
          );
        })}
        {runId ? (
          <div className="mt-1 ml-2 flex flex-col gap-0.5 border-l border-border pl-2">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-fg-faint">
              Run {runId.slice(0, 8)}
            </div>
            <Link
              href={`/runs/${encodeURIComponent(runId)}`}
              onClick={onNavigate}
              aria-current={pathname === `/runs/${encodeURIComponent(runId)}` ? 'page' : undefined}
              className={cn(
                'flex min-h-touch items-center rounded px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                pathname === `/runs/${encodeURIComponent(runId)}`
                  ? 'bg-bg-subtle text-fg'
                  : 'text-fg-muted hover:bg-bg-subtle',
              )}
            >
              Detail
            </Link>
            <Link
              href={`/runs/${encodeURIComponent(runId)}/live`}
              onClick={onNavigate}
              aria-current={onLive ? 'page' : undefined}
              className={cn(
                'flex min-h-touch items-center rounded px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                onLive ? 'bg-fg text-fg-inverse' : 'text-fg-muted hover:bg-bg-subtle',
              )}
            >
              Live
            </Link>
            <Link
              href={`/runs/${encodeURIComponent(runId)}/debug`}
              onClick={onNavigate}
              aria-current={onDebug ? 'page' : undefined}
              className={cn(
                'flex min-h-touch items-center rounded px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                onDebug ? 'bg-fg text-fg-inverse' : 'text-fg-muted hover:bg-bg-subtle',
              )}
            >
              Debug
            </Link>
          </div>
        ) : null}
      </nav>
      <div className="mt-auto border-t border-border p-3">
        {user ? <UserMenu user={user} /> : <SignedOutFooter onNavigate={onNavigate} />}
      </div>
    </div>
  );
}

/**
 * Wave-16 — sub-link rendered under the Eval row. Always visible so
 * users can discover Evaluators from anywhere; highlights when active.
 */
function EvalSubLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: () => void;
}) {
  const active = pathname === '/evaluators' || pathname.startsWith('/evaluators/');
  return (
    <div className="ml-2 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
      <Link
        href="/evaluators"
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-touch items-center rounded px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active ? 'bg-fg text-fg-inverse' : 'text-fg-muted hover:bg-bg-subtle',
        )}
      >
        Evaluators
      </Link>
    </div>
  );
}

function SignedOutFooter({ onNavigate }: { onNavigate: () => void }) {
  return (
    <Link
      href="/login"
      onClick={onNavigate}
      className="flex min-h-touch items-center rounded px-2 py-1.5 text-sm text-fg-muted hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        className="flex w-full min-h-touch items-center gap-2 rounded px-1.5 py-1.5 text-left hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fg text-[11px] font-semibold text-fg-inverse">
          {initialsOf(user.email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-fg" title={user.email}>
            {user.email}
          </span>
          <span
            className="block truncate text-[10px] uppercase tracking-wider text-fg-muted"
            title={user.currentTenantName}
          >
            {user.currentTenantSlug}
          </span>
        </span>
        <span aria-hidden className="text-fg-faint">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 mb-1 rounded-md border border-border bg-bg-elevated p-1 shadow-md"
        >
          {otherMemberships.length > 0 ? (
            <>
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-fg-faint">
                Switch tenant
              </div>
              {otherMemberships.map((m) => (
                <form key={m.tenantSlug} action={switchTenantAction} className="block">
                  <input type="hidden" name="tenantSlug" value={m.tenantSlug} />
                  <button
                    type="submit"
                    className="flex w-full min-h-touch items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate text-fg-muted" title={m.tenantName}>
                      {m.tenantName}
                    </span>
                    <span className="text-[10px] text-fg-faint">{m.tenantSlug}</span>
                  </button>
                </form>
              ))}
              <div className="my-1 border-t border-border" />
            </>
          ) : null}
          {/* Wave-14C — relaunch the product tour on demand. The
              tour provider listens for the `aldo:tour:start` window
              event and re-opens at step 0. */}
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('aldo:tour:start'));
              setOpen(false);
            }}
            className="block w-full min-h-touch rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Take the tour
          </button>
          <form action={logoutAction}>
            <button
              type="submit"
              className="block w-full min-h-touch rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
