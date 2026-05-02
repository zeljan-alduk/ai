'use client';

/**
 * Per-row Sync/Disconnect actions for the connected-repo list.
 *
 * Both actions are write operations so they live in a client island; the
 * parent table is server-rendered. After a successful Sync we re-fetch
 * via `router.refresh()` so the Last sync column updates without a hard
 * navigation.
 */

import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api';
import {
  type GitRepoEntry,
  type GitSyncResultEnvelope,
  disconnectGitRepo,
  syncGitRepo,
} from '@/lib/api-admin';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ConnectedRepoRowActions({ repo }: { repo: GitRepoEntry }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'idle' | 'syncing' | 'deleting'>('idle');
  const [lastResult, setLastResult] = useState<GitSyncResultEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSync() {
    setBusy('syncing');
    setError(null);
    try {
      const res = await syncGitRepo(repo.id);
      setLastResult(res);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Sync failed');
    } finally {
      setBusy('idle');
    }
  }

  async function onDelete() {
    if (!confirm(`Disconnect ${repo.repoOwner}/${repo.repoName}?`)) return;
    setBusy('deleting');
    setError(null);
    try {
      await disconnectGitRepo(repo.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Disconnect failed');
      setBusy('idle');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onSync} disabled={busy !== 'idle'}>
          {busy === 'syncing' ? 'Syncing…' : 'Sync now'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          disabled={busy !== 'idle'}
          className="text-danger hover:bg-danger/10"
        >
          Disconnect
        </Button>
      </div>
      {error ? (
        <output className="text-[11px] text-danger">{error}</output>
      ) : lastResult ? (
        <output className="text-[11px] text-fg-muted">
          {lastResult.status === 'ok'
            ? `+${lastResult.added.length} added · ~${lastResult.updated.length} updated · -${lastResult.removed.length} removed`
            : `failed: ${lastResult.error ?? 'unknown'}`}
        </output>
      ) : null}
    </div>
  );
}
