'use client';

/**
 * <ShareDialog> — wave 14 (Engineer 14D).
 *
 * Triggered from the page header on /runs/[id], /eval/sweeps/[id], and
 * /agents/[name]. Generates a public read-only share-link with optional
 * expiry and password. Below the generator, lists existing share-links
 * for the same resource and exposes per-row revoke + view-count.
 *
 * Owners can revoke any share; creators can revoke their own. The
 * server enforces this (see /v1/shares/:id/revoke); the dialog just
 * surfaces the affordance.
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createShareApi, deleteShareApi, listSharesApi, revokeShareApi } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import type { AnnotationTargetKind, ShareLink } from '@aldo-ai/api-contract';
import { Copy, Link as LinkIcon, Share2 } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

export interface ShareDialogProps {
  readonly targetKind: AnnotationTargetKind;
  readonly targetId: string;
  readonly trigger?: ReactNode;
}

type ExpiryChoice = '1h' | '24h' | '7d' | 'never';

function expiresInHoursFor(choice: ExpiryChoice): number | undefined {
  if (choice === '1h') return 1;
  if (choice === '24h') return 24;
  if (choice === '7d') return 24 * 7;
  return undefined;
}

export function ShareDialog({ targetKind, targetId, trigger }: ShareDialogProps) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<readonly ShareLink[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<ExpiryChoice>('24h');
  const [password, setPassword] = useState<string>('');
  const [usePassword, setUsePassword] = useState<boolean>(false);
  const [latestUrl, setLatestUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await listSharesApi({ targetKind, targetId });
      setShares(res.shares);
    } catch (err) {
      setError((err as Error).message ?? 'failed to load shares');
    }
  }, [targetKind, targetId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const onGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const args: {
        targetKind: AnnotationTargetKind;
        targetId: string;
        expiresInHours?: number;
        password?: string;
      } = { targetKind, targetId };
      const hours = expiresInHoursFor(expiry);
      if (hours !== undefined) args.expiresInHours = hours;
      if (usePassword && password.trim().length >= 4) {
        args.password = password.trim();
      }
      const res = await createShareApi(args);
      setShares((prev) => [res.share, ...prev]);
      setLatestUrl(res.share.url);
    } catch (err) {
      setError((err as Error).message ?? 'failed to generate share link');
    } finally {
      setGenerating(false);
    }
  };

  const onRevoke = async (id: string) => {
    try {
      const res = await revokeShareApi(id);
      setShares((prev) => prev.map((s) => (s.id === id ? res.share : s)));
    } catch (err) {
      setError((err as Error).message ?? 'failed to revoke');
    }
  };

  const onDelete = async (id: string) => {
    try {
      await deleteShareApi(id);
      setShares((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError((err as Error).message ?? 'failed to delete');
    }
  };

  const copyToClipboard = (s: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(s);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" size="sm">
            <Share2 className="h-4 w-4" />
            Share
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Share this {targetKind}</DialogTitle>
          <DialogDescription>
            Generate a public read-only link. Anyone with the URL can view; no sign-in required.
            Revoke at any time below.
          </DialogDescription>
        </DialogHeader>

        {error !== null && (
          <p className="rounded border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Expires
            <select
              className="rounded border border-border bg-bg p-1 text-sm text-fg"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value as ExpiryChoice)}
            >
              <option value="1h">in 1 hour</option>
              <option value="24h">in 24 hours</option>
              <option value="7d">in 7 days</option>
              <option value="never">never</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={usePassword}
              onChange={(e) => setUsePassword(e.target.checked)}
            />
            Require a password
          </label>
          {usePassword && (
            <input
              type="password"
              className="rounded border border-border bg-bg p-1 text-sm text-fg"
              placeholder="Min 4 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}

          <Button onClick={onGenerate} disabled={generating} size="sm">
            {generating ? 'Generating…' : 'Generate link'}
          </Button>

          {latestUrl !== null && (
            <div className="flex items-center gap-2 rounded border border-accent/30 bg-accent/5 p-2 text-xs">
              <LinkIcon className="h-4 w-4" aria-hidden />
              <code className="flex-1 truncate font-mono">{latestUrl}</code>
              <button
                type="button"
                onClick={() => copyToClipboard(latestUrl)}
                aria-label="Copy link"
                className="rounded p-1 hover:bg-bg-subtle"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-fg-muted">Existing shares</h3>
          {shares.length === 0 ? (
            <p className="text-xs text-fg-muted">No shares yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {shares.map((s) => {
                const expired = s.expiresAt !== null && Date.parse(s.expiresAt) < Date.now();
                const revoked = s.revokedAt !== null;
                const status = revoked ? 'revoked' : expired ? 'expired' : 'active';
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 rounded border border-border bg-bg p-2 text-xs"
                  >
                    <code className="flex-1 truncate font-mono">{s.url}</code>
                    <span
                      className={
                        status === 'active'
                          ? 'rounded bg-success/10 px-1.5 py-0.5 text-success'
                          : 'rounded bg-bg-subtle px-1.5 py-0.5 text-fg-muted'
                      }
                    >
                      {status}
                    </span>
                    <span className="text-fg-muted" title={s.createdAt}>
                      {formatRelativeTime(s.createdAt)}
                    </span>
                    <span className="tabular-nums text-fg-muted">{s.viewCount} views</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(s.url)}
                      aria-label="Copy link"
                      className="rounded p-1 hover:bg-bg-subtle"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    {!revoked && (
                      <button
                        type="button"
                        onClick={() => void onRevoke(s.id)}
                        className="text-danger hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void onDelete(s.id)}
                      className="text-danger hover:underline"
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
