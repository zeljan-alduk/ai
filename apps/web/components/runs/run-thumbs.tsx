'use client';

/**
 * <RunThumbs> — wave-19 (Frontend Engineer).
 *
 * Inline thumbs-up / thumbs-down pair shown in the /runs/[id] page
 * header. Backed by the same annotation + reaction storage the
 * <CommentsThread> uses; clicking either button creates (or surfaces)
 * a tiny "header thumbs" annotation per user, then toggles the
 * reaction on it. The intent is to give an operator a one-click
 * verdict without forcing them to write a comment.
 *
 * Polling: re-fetches every 30s so collaborators' votes show up
 * without a page reload.
 *
 * LLM-agnostic by construction.
 */

import { createAnnotationApi, listAnnotationsApi, toggleReactionApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Annotation } from '@aldo-ai/api-contract';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const HEADER_TAG = '__header_thumbs__';

interface RunThumbsProps {
  readonly runId: string;
  readonly currentUserId: string;
  readonly initialAnnotations?: readonly Annotation[];
}

interface Aggregate {
  thumbsUp: number;
  thumbsDown: number;
  myVote: 'thumbs_up' | 'thumbs_down' | null;
  myAnnotationId: string | null;
}

/** Roll up reactions across the page's annotations into an aggregate. */
function aggregate(annotations: readonly Annotation[], me: string): Aggregate {
  let up = 0;
  let down = 0;
  let myVote: Aggregate['myVote'] = null;
  let myAnnotationId: Aggregate['myAnnotationId'] = null;
  for (const a of annotations) {
    for (const r of a.reactions) {
      if (r.kind === 'thumbs_up') up += r.count;
      if (r.kind === 'thumbs_down') down += r.count;
      if (r.reactedByMe && (r.kind === 'thumbs_up' || r.kind === 'thumbs_down')) {
        // Only count the FIRST reaction-by-me as "my vote" — collisions
        // with comment-thread reactions are unusual.
        if (myVote === null) {
          myVote = r.kind;
          myAnnotationId = a.id;
        }
      }
    }
    if (a.authorUserId === me && a.body === HEADER_TAG && myAnnotationId === null) {
      myAnnotationId = a.id;
    }
  }
  return { thumbsUp: up, thumbsDown: down, myVote, myAnnotationId };
}

export function RunThumbs({ runId, currentUserId, initialAnnotations }: RunThumbsProps) {
  const [annotations, setAnnotations] = useState<readonly Annotation[]>(initialAnnotations ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await listAnnotationsApi({ targetKind: 'run', targetId: runId });
      if (mountedRef.current) setAnnotations(res.annotations);
    } catch {
      // Silent — header thumbs are auxiliary, never block the page.
    }
  }, [runId]);

  useEffect(() => {
    mountedRef.current = true;
    if (initialAnnotations === undefined) void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => {
      mountedRef.current = false;
      clearInterval(t);
    };
  }, [refresh, initialAnnotations]);

  const agg = useMemo(() => aggregate(annotations, currentUserId), [annotations, currentUserId]);

  /**
   * Toggle. Three states:
   *   - no current vote → create (or reuse) my header annotation, react.
   *   - same vote → unreact (toggle off).
   *   - different vote → flip: unreact old, react new on the same annotation.
   */
  const onVote = useCallback(
    async (kind: 'thumbs_up' | 'thumbs_down') => {
      if (pending) return;
      setError(null);
      setPending(true);
      try {
        let annotationId = agg.myAnnotationId;
        if (annotationId === null) {
          // Spin up the operator's header-thumbs annotation. The body
          // sentinel `HEADER_TAG` lets future loads surface it without
          // a separate column. (Migration 026 didn't extend
          // annotations — sentinel-in-body is the lowest-friction
          // shape.)
          const res = await createAnnotationApi({
            targetKind: 'run',
            targetId: runId,
            body: HEADER_TAG,
          });
          annotationId = res.annotation.id;
        }
        if (agg.myVote !== null && agg.myVote !== kind) {
          // Flip: unreact old then react new.
          await toggleReactionApi(annotationId, agg.myVote);
          await toggleReactionApi(annotationId, kind);
        } else {
          // Either fresh (no vote) → react, or same kind → unreact.
          await toggleReactionApi(annotationId, kind);
        }
        await refresh();
      } catch (e) {
        setError((e as Error).message ?? 'failed to record vote');
      } finally {
        if (mountedRef.current) setPending(false);
      }
    },
    [agg.myAnnotationId, agg.myVote, pending, refresh, runId],
  );

  return (
    <div
      aria-label="Rate this run"
      className="inline-flex items-center overflow-hidden rounded border border-border bg-bg-elevated"
    >
      <ThumbButton
        kind="thumbs_up"
        active={agg.myVote === 'thumbs_up'}
        count={agg.thumbsUp}
        disabled={pending}
        onClick={() => void onVote('thumbs_up')}
      />
      <span aria-hidden="true" className="h-5 w-px bg-border" />
      <ThumbButton
        kind="thumbs_down"
        active={agg.myVote === 'thumbs_down'}
        count={agg.thumbsDown}
        disabled={pending}
        onClick={() => void onVote('thumbs_down')}
      />
      {error !== null ? (
        <span className="ml-2 text-[10px] text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function ThumbButton({
  kind,
  active,
  count,
  disabled,
  onClick,
}: {
  kind: 'thumbs_up' | 'thumbs_down';
  active: boolean;
  count: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = kind === 'thumbs_up' ? ThumbsUp : ThumbsDown;
  const label = kind === 'thumbs_up' ? 'Thumbs up' : 'Thumbs down';
  const activeTone =
    kind === 'thumbs_up'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
      : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors disabled:opacity-50',
        active ? activeTone : 'text-fg-muted hover:bg-bg-subtle hover:text-fg',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
