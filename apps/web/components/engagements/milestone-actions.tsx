'use client';

/**
 * Sign-off + Reject actions on a single milestone. Shown inline only
 * for milestones in `pending` or `in_review` (terminal states are
 * captured in the rendered rationale upstream).
 *
 * Reject requires a non-empty reason — a hidden 409 is impossible
 * because the parent only renders this island for non-terminal
 * milestones, but we still surface the typed error if a race fires.
 */

import { rejectMilestoneApi, signOffMilestoneApi } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function MilestoneActions({
  slug,
  milestoneId,
}: {
  slug: string;
  milestoneId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'idle' | 'sign-off' | 'reject'>('idle');
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSignOff = async () => {
    setBusy('sign-off');
    setError(null);
    try {
      await signOffMilestoneApi(slug, milestoneId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sign-off failed');
    } finally {
      setBusy('idle');
    }
  };

  const onReject = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('reject');
    setError(null);
    try {
      await rejectMilestoneApi(slug, milestoneId, reason.trim());
      setShowReject(false);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'reject failed');
    } finally {
      setBusy('idle');
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-start gap-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={onSignOff}
        disabled={busy !== 'idle'}
        className="h-9 rounded-md bg-success/15 px-3 text-sm font-medium text-success ring-1 ring-success/30 transition hover:bg-success/25 disabled:opacity-50"
      >
        {busy === 'sign-off' ? 'Signing off…' : 'Sign off'}
      </button>
      <button
        type="button"
        onClick={() => setShowReject((s) => !s)}
        disabled={busy !== 'idle'}
        className="h-9 rounded-md bg-danger/10 px-3 text-sm font-medium text-danger ring-1 ring-danger/30 transition hover:bg-danger/20 disabled:opacity-50"
      >
        {showReject ? 'Cancel reject' : 'Reject'}
      </button>
      {showReject ? (
        <form onSubmit={onReject} className="flex flex-1 flex-wrap items-end gap-2">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm">
            <span className="font-medium text-fg-muted">Reason (required)</span>
            <input
              type="text"
              required
              minLength={1}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="missing CSP headers in deployment"
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy !== 'idle' || reason.trim() === ''}
            className="h-9 rounded-md bg-danger px-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy === 'reject' ? 'Rejecting…' : 'Confirm reject'}
          </button>
        </form>
      ) : null}
      {error !== null ? <p className="w-full text-sm text-danger">Error: {error}</p> : null}
    </div>
  );
}
