'use client';

/**
 * MISSING_PIECES #9 — pending-approvals banner for /runs/[id].
 *
 * Server-fetches the initial list of pending approvals (via the
 * page's loader); this client component handles the interactive
 * approve/reject mutations and refetch loop. When zero are pending
 * the banner doesn't render.
 *
 * Live updates: the engine's `tool.pending_approval` events flow
 * through the existing run-events SSE stream. v0 polls the REST list
 * every 4s while there's at least one pending approval (cheap; only
 * runs as long as the operator is on the page); a follow-up could
 * subscribe to the SSE stream directly.
 */

import { useCallback, useEffect, useState, useTransition } from 'react';
import type { PendingApprovalWire } from '@aldo-ai/api-contract';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  approveRunCall,
  listRunApprovals,
  rejectRunCall,
} from '@/lib/api';

const POLL_INTERVAL_MS = 4_000;

export function PendingApprovalsBanner({
  runId,
  initial,
}: {
  runId: string;
  initial: readonly PendingApprovalWire[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<readonly PendingApprovalWire[]>(initial);
  const [busyCallId, setBusyCallId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingTransition, startTransition] = useTransition();

  const refetch = useCallback(async () => {
    try {
      const next = await listRunApprovals(runId);
      setPending(next.approvals);
    } catch (e) {
      // Silent on transient refetch failures — the buttons still work
      // and the next poll cycle retries.
      void e;
    }
  }, [runId]);

  // Poll while there's at least one pending approval. Stop polling
  // when the list empties so we don't burn cycles on a settled run.
  useEffect(() => {
    if (pending.length === 0) return;
    const id = setInterval(() => {
      void refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pending.length, refetch]);

  if (pending.length === 0 && busyCallId === null) return null;

  const onApprove = async (a: PendingApprovalWire): Promise<void> => {
    setBusyCallId(a.callId);
    setError(null);
    try {
      await approveRunCall(runId, { callId: a.callId });
      // Optimistic local update; the cycle-tree below reads from the
      // server-rendered run.events, so we trigger a router refresh
      // to pick up the new tool_result event the engine just appended.
      setPending((cur) => cur.filter((p) => p.callId !== a.callId));
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusyCallId(null);
    }
  };

  const onReject = async (a: PendingApprovalWire, reason: string): Promise<void> => {
    if (reason.trim().length === 0) {
      setError('A reason is required when rejecting an approval.');
      return;
    }
    setBusyCallId(a.callId);
    setError(null);
    try {
      await rejectRunCall(runId, { callId: a.callId, reason: reason.trim() });
      setPending((cur) => cur.filter((p) => p.callId !== a.callId));
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusyCallId(null);
    }
  };

  return (
    <section
      data-testid="pending-approvals-banner"
      className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-amber-900">
            {pending.length} approval{pending.length === 1 ? '' : 's'} pending
          </h3>
          <p className="text-xs text-amber-800">
            This run is paused until you approve or reject. The agent observes the
            decision as a tool result and decides what to do next.
          </p>
        </div>
        {pendingTransition ? (
          <span className="text-xs text-amber-700">Refreshing…</span>
        ) : null}
      </header>
      {error ? (
        <div className="mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-800">
          {error}
        </div>
      ) : null}
      <ul className="mt-2 space-y-2">
        {pending.map((a) => (
          <ApprovalRow
            key={a.callId}
            approval={a}
            busy={busyCallId === a.callId}
            onApprove={() => onApprove(a)}
            onReject={(reason) => onReject(a, reason)}
          />
        ))}
      </ul>
    </section>
  );
}

function ApprovalRow({
  approval,
  busy,
  onApprove,
  onReject,
}: {
  approval: PendingApprovalWire;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [showReason, setShowReason] = useState(false);

  return (
    <li
      data-testid={`pending-approval-${approval.callId}`}
      className="rounded border border-amber-200 bg-white px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white">
          tool
        </span>
        <span className="font-mono font-semibold text-slate-900">{approval.tool}</span>
        <span className="font-mono text-[11px] text-slate-500">{approval.callId.slice(0, 8)}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-testid={`approve-${approval.callId}`}
            disabled={busy}
            onClick={onApprove}
            className="inline-flex items-center rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? '…' : 'Approve'}
          </button>
          <button
            type="button"
            data-testid={`reject-${approval.callId}`}
            disabled={busy}
            onClick={() => setShowReason((v) => !v)}
            className="inline-flex items-center rounded border border-rose-400 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      </div>
      {approval.reason ? (
        <p className="mt-1 text-xs text-slate-600">
          <span className="font-semibold">Agent reason:</span> {approval.reason}
        </p>
      ) : null}
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-slate-500">Show args</summary>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-700">
          {stringify(approval.args)}
        </pre>
      </details>
      {showReason ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you rejecting?"
            disabled={busy}
            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={busy || reason.trim().length === 0}
            onClick={() => onReject(reason)}
            className="inline-flex items-center rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy ? '…' : 'Confirm reject'}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function formatError(e: unknown): string {
  if (e instanceof ApiClientError) return `${e.kind}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
