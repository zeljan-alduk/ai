'use client';

/**
 * Wave-13 notification bell — Popover-anchored, top of sidebar.
 *
 * Subscribes to `/v1/sse/events?stream=notifications` for live updates
 * via the browser's `EventSource`. Falls back to polling
 * `GET /v1/notifications` every 60s when SSE drops.
 *
 * Visual:
 *   - bell icon with an unread-count badge (capped at "9+").
 *   - popover with the recent 20 unread + read notifications mixed.
 *   - each row: kind icon, title, body, relative time, "mark read" CTA.
 *   - footer: "View all" → /notifications; "Mark all read" CTA.
 *
 * LLM-agnostic: notification kinds are platform concepts; the bell
 * never tags a row with a provider name.
 */

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  listNotificationsApi,
  markAllNotificationsReadApi,
  markNotificationReadApi,
} from '@/lib/api';
import { formatAbsolute, formatRelativeTime } from '@/lib/format';
import type { Notification, NotificationKind } from '@aldo-ai/api-contract';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

const KIND_ICON: Record<NotificationKind, string> = {
  run_completed: '✓',
  run_failed: '✗',
  sweep_completed: '⌗',
  guards_blocked: '⚠',
  invitation_received: '✉',
  budget_threshold: '$',
  comment_mention: '@',
  quota_exceeded: '⊘',
};

const KIND_TINT: Record<NotificationKind, string> = {
  run_completed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  run_failed: 'text-red-700 bg-red-50 border-red-200',
  sweep_completed: 'text-sky-700 bg-sky-50 border-sky-200',
  guards_blocked: 'text-amber-700 bg-amber-50 border-amber-200',
  invitation_received: 'text-violet-700 bg-violet-50 border-violet-200',
  budget_threshold: 'text-rose-700 bg-rose-50 border-rose-200',
  comment_mention: 'text-blue-700 bg-blue-50 border-blue-200',
  quota_exceeded: 'text-amber-700 bg-amber-50 border-amber-200',
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<readonly Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listNotificationsApi({ limit: 20 });
      setItems(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch {
      // Silently swallow — the badge just stays at its last value.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Poll every 60s as a backstop in case SSE drops and EventSource's
  // backoff hasn't reconnected yet.
  useEffect(() => {
    const t = setInterval(() => {
      void reload();
    }, 60_000);
    return () => clearInterval(t);
  }, [reload]);

  // SSE subscription for live notifications. EventSource handles
  // exponential-backoff reconnect on its own.
  const sseRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const es = new EventSource('/api/auth-proxy/v1/sse/events?stream=notifications', {
      withCredentials: true,
    });
    sseRef.current = es;
    const onNotification = (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as Notification;
        setItems((prev) => {
          // De-dupe by id in case a backstop poll already inserted it.
          if (prev.some((n) => n.id === data.id)) return prev;
          return [data, ...prev].slice(0, 20);
        });
        if (data.readAt === null) setUnreadCount((n) => n + 1);
      } catch {
        // Bad payload — ignore.
      }
    };
    es.addEventListener('notification', onNotification as EventListener);
    return () => {
      es.close();
    };
  }, []);

  const onMarkRead = useCallback(async (id: string) => {
    try {
      await markNotificationReadApi(id);
      setItems((prev) =>
        prev.map((n) =>
          n.id === id && n.readAt === null ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      );
      setUnreadCount((n) => Math.max(0, n - 1));
    } catch {
      // Best-effort.
    }
  }, []);

  const onMarkAllRead = useCallback(async () => {
    try {
      await markAllNotificationsReadApi();
      setItems((prev) =>
        prev.map((n) => (n.readAt === null ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      setUnreadCount(0);
    } catch {
      // Best-effort.
    }
  }, []);

  const badge = unreadCountBadge(unreadCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
          className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:h-8 sm:w-8"
        >
          <BellIcon />
          {badge !== null ? (
            <span className="absolute right-1 top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white sm:-right-0.5 sm:-top-0.5">
              {badge}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      {/* Wave-15E — on mobile (xs/sm) the popover stretches to the
          viewport width minus a comfortable margin and grows to a
          near-full-height sheet so notifications are easy to read +
          tap. On `sm:` and up it reverts to the original 320px panel. */}
      <PopoverContent
        className="w-[calc(100vw-1rem)] max-w-[420px] sm:w-80"
        align="end"
        sideOffset={8}
        collisionPadding={8}
      >
        <div className="flex items-center justify-between pb-2">
          <h3 className="text-sm font-semibold text-fg">Notifications</h3>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="text-[11px] text-slate-600 hover:text-slate-900 hover:underline"
            >
              Mark all read
            </button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">
            {loading ? 'Loading…' : "You're all caught up."}
          </p>
        ) : (
          <ul className="-mx-2 max-h-[60vh] overflow-y-auto">
            {items.map((n) => (
              <NotificationRow key={n.id} n={n} onMarkRead={onMarkRead} />
            ))}
          </ul>
        )}
        <div className="mt-2 border-t border-slate-200 pt-2 text-right">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="text-[11px] text-slate-600 hover:text-slate-900 hover:underline"
          >
            View all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  n,
  onMarkRead,
}: {
  n: Notification;
  onMarkRead: (id: string) => void;
}) {
  const tint = KIND_TINT[n.kind] ?? 'text-slate-700 bg-slate-50 border-slate-200';
  const icon = KIND_ICON[n.kind] ?? '•';
  return (
    <li
      className={`flex items-start gap-2 rounded px-2 py-2 ${
        n.readAt === null ? 'bg-slate-50' : ''
      }`}
    >
      <span
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${tint}`}
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-xs font-medium text-slate-900" title={n.title}>
            {n.link ? (
              <Link href={n.link} className="hover:underline">
                {n.title}
              </Link>
            ) : (
              n.title
            )}
          </p>
          <span className="shrink-0 text-[10px] text-slate-500" title={formatAbsolute(n.createdAt)}>
            {formatRelativeTime(n.createdAt)}
          </span>
        </div>
        <p className="line-clamp-2 text-[11px] text-slate-600" title={n.body}>
          {n.body}
        </p>
        {n.readAt === null ? (
          <button
            type="button"
            onClick={() => onMarkRead(n.id)}
            className="mt-1 text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-900"
          >
            Mark read
          </button>
        ) : null}
      </div>
    </li>
  );
}

function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      role="img"
      aria-label="Notifications"
    >
      <title>Notifications</title>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/** Render the unread-count badge (capped at "9+"). Null = no badge. */
export function unreadCountBadge(n: number): string | null {
  if (n <= 0) return null;
  if (n > 9) return '9+';
  return String(n);
}
