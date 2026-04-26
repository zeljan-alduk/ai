/**
 * Wave-13 — `/notifications` page.
 *
 * Server-rendered list with kind-filter chips. Pagination is
 * deliberately bounded (most-recent 100 per call); the `/activity`
 * page is the right place for an exhaustive history.
 *
 * LLM-agnostic: notification kinds are platform concepts.
 */

import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listNotificationsApi } from '@/lib/api';
import { formatAbsolute, formatRelativeTime } from '@/lib/format';
import type { Notification, NotificationKind } from '@aldo-ai/api-contract';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const ALL_KINDS: ReadonlyArray<NotificationKind> = [
  'run_completed',
  'run_failed',
  'sweep_completed',
  'guards_blocked',
  'invitation_received',
  'budget_threshold',
];

const KIND_LABEL: Record<NotificationKind, string> = {
  run_completed: 'Runs completed',
  run_failed: 'Runs failed',
  sweep_completed: 'Sweeps completed',
  guards_blocked: 'Guards blocks',
  invitation_received: 'Invitations',
  budget_threshold: 'Budget alerts',
};

const KIND_TINT: Record<NotificationKind, string> = {
  run_completed: 'bg-emerald-100 text-emerald-800',
  run_failed: 'bg-red-100 text-red-800',
  sweep_completed: 'bg-sky-100 text-sky-800',
  guards_blocked: 'bg-amber-100 text-amber-800',
  invitation_received: 'bg-violet-100 text-violet-800',
  budget_threshold: 'bg-rose-100 text-rose-800',
};

interface SearchParamsShape {
  readonly kind?: string | string[];
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsShape>;
}) {
  const params = await searchParams;
  const rawKind = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  const kind = ALL_KINDS.find((k) => k === rawKind) ?? null;

  let body: Awaited<ReturnType<typeof listNotificationsApi>> | null = null;
  let error: unknown = null;
  try {
    body = await listNotificationsApi({ limit: 100, ...(kind !== null ? { kind } : {}) });
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Recent platform notifications for your tenant. The bell icon shows the live feed."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href="/notifications"
          className={`rounded-full border px-3 py-1 text-xs ${
            kind === null
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          All
        </Link>
        {ALL_KINDS.map((k) => (
          <Link
            key={k}
            href={`/notifications?kind=${encodeURIComponent(k)}`}
            className={`rounded-full border px-3 py-1 text-xs ${
              kind === k
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {KIND_LABEL[k]}
          </Link>
        ))}
      </div>
      {error ? (
        <ErrorView error={error} context="notifications" />
      ) : body !== null && body.notifications.length === 0 ? (
        <EmptyState
          title={kind ? `No ${KIND_LABEL[kind].toLowerCase()} yet.` : 'No notifications yet.'}
          hint="Notifications appear here as runs complete, sweeps finish, or guards block output."
        />
      ) : body !== null ? (
        <NotificationList items={body.notifications} />
      ) : null}
    </>
  );
}

function NotificationList({ items }: { items: ReadonlyArray<Notification> }) {
  return (
    <ol className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
      {items.map((n) => (
        <li
          key={n.id}
          className={`flex items-start gap-3 px-4 py-3 ${n.readAt === null ? 'bg-slate-50' : ''}`}
        >
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              KIND_TINT[n.kind] ?? 'bg-slate-100 text-slate-700'
            }`}
          >
            {KIND_LABEL[n.kind] ?? n.kind}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900">
              {n.link ? (
                <Link href={n.link} className="hover:underline">
                  {n.title}
                </Link>
              ) : (
                n.title
              )}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">{n.body}</p>
          </div>
          <span className="shrink-0 text-[11px] text-slate-500" title={formatAbsolute(n.createdAt)}>
            {formatRelativeTime(n.createdAt)}
          </span>
        </li>
      ))}
    </ol>
  );
}
