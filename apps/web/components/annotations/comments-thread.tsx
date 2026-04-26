'use client';

/**
 * <CommentsThread> — wave 14 (Engineer 14D).
 *
 * Threaded annotation view with a markdown compose box, a
 * 15-second polling tail for new comments, and a single level of
 * threading. Mounted on /runs/[id], /eval/sweeps/[id], /agents/[name]
 * via a thin server-component wrapper that hydrates the initial
 * snapshot.
 *
 * The component is deliberately self-contained: it owns the state
 * machine for "loaded annotations / pending compose / edit-in-place /
 * reaction toggling" so the host pages stay simple.
 *
 * Markdown rendering uses `marked` for parsing and `dompurify` for
 * sanitisation. Rendering raw user HTML is a known XSS path; the
 * sanitiser strips every script, on*, javascript: URL and CSS
 * expression. Any tag not on the allow-list is dropped.
 *
 * LLM-agnostic by construction — the comment body is opaque text,
 * never a model output / provider blob.
 */

import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Button } from '@/components/ui/button';
import {
  createAnnotationApi,
  deleteAnnotationApi,
  listAnnotationsApi,
  toggleReactionApi,
  updateAnnotationApi,
} from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/format';
import type {
  Annotation,
  AnnotationReactionKind,
  AnnotationTargetKind,
} from '@aldo-ai/api-contract';
import DOMPurify from 'isomorphic-dompurify';
import { Check, Eye, ThumbsDown, ThumbsUp } from 'lucide-react';
import { marked } from 'marked';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface CommentsThreadProps {
  readonly targetKind: AnnotationTargetKind;
  readonly targetId: string;
  /** Caller's user id — used to highlight own-comments and the edit/delete affordances. */
  readonly currentUserId: string;
  /** Caller's email — rendered in the compose box header. */
  readonly currentUserEmail: string;
  /** Initial server-rendered snapshot (avoids a fetch on first paint). */
  readonly initialAnnotations?: readonly Annotation[];
  /**
   * Polling interval. Per the brief: 15 seconds. Tests/dev may pass
   * a smaller value; the SSE upgrade path lives in a future wave.
   */
  readonly pollMs?: number;
}

const REACTION_ICONS: Record<
  AnnotationReactionKind,
  React.ComponentType<{ className?: string }>
> = {
  thumbs_up: ThumbsUp,
  thumbs_down: ThumbsDown,
  eyes: Eye,
  check: Check,
};

const REACTION_LABEL: Record<AnnotationReactionKind, string> = {
  thumbs_up: 'thumbs up',
  thumbs_down: 'thumbs down',
  eyes: 'eyes',
  check: 'check',
};

/** Marked + DOMPurify pipeline. Returns a sanitised HTML string. */
function renderMarkdown(body: string): string {
  // `marked.parse` is sync when async opt-out; this uses the default
  // sync API. The output is a string of HTML which we then sanitise.
  const raw = marked.parse(body, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
  });
}

interface ThreadNode {
  readonly comment: Annotation;
  readonly replies: readonly Annotation[];
}

/** Group annotations into top-level + replies (single level). */
function buildThreads(annotations: readonly Annotation[]): readonly ThreadNode[] {
  const byId = new Map<string, Annotation>();
  for (const a of annotations) byId.set(a.id, a);
  const tops: Annotation[] = [];
  const repliesByParent = new Map<string, Annotation[]>();
  for (const a of annotations) {
    if (a.parentId === null || !byId.has(a.parentId)) {
      tops.push(a);
    } else {
      const bucket = repliesByParent.get(a.parentId) ?? [];
      bucket.push(a);
      repliesByParent.set(a.parentId, bucket);
    }
  }
  return tops.map((t) => ({
    comment: t,
    replies: (repliesByParent.get(t.id) ?? []).slice().sort(byCreatedAt),
  }));
}

function byCreatedAt(a: Annotation, b: Annotation): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function CommentsThread(props: CommentsThreadProps) {
  const {
    targetKind,
    targetId,
    currentUserId,
    currentUserEmail,
    initialAnnotations,
    pollMs = 15_000,
  } = props;

  const [annotations, setAnnotations] = useState<readonly Annotation[]>(initialAnnotations ?? []);
  const [loading, setLoading] = useState<boolean>(initialAnnotations === undefined);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef<boolean>(true);

  // Pull a fresh snapshot. Idempotent — replaces the whole list.
  const refresh = useCallback(async () => {
    try {
      const res = await listAnnotationsApi({ targetKind, targetId });
      if (!mountedRef.current) return;
      setAnnotations(res.annotations);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError((err as Error).message ?? 'failed to load comments');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [targetKind, targetId]);

  useEffect(() => {
    mountedRef.current = true;
    if (initialAnnotations === undefined) {
      void refresh();
    } else {
      setLoading(false);
    }
    const t = setInterval(() => {
      void refresh();
    }, pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(t);
    };
  }, [refresh, pollMs, initialAnnotations]);

  const threads = useMemo(() => buildThreads(annotations), [annotations]);

  const onCreate = useCallback(
    async (body: string, parentId?: string) => {
      const fields: {
        targetKind: AnnotationTargetKind;
        targetId: string;
        body: string;
        parentId?: string;
      } = { targetKind, targetId, body };
      if (parentId !== undefined) fields.parentId = parentId;
      const res = await createAnnotationApi(fields);
      setAnnotations((prev) => [...prev, res.annotation]);
    },
    [targetKind, targetId],
  );

  const onUpdate = useCallback(async (id: string, body: string) => {
    const res = await updateAnnotationApi(id, body);
    setAnnotations((prev) => prev.map((a) => (a.id === id ? res.annotation : a)));
  }, []);

  const onDelete = useCallback(async (id: string) => {
    await deleteAnnotationApi(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id && a.parentId !== id));
  }, []);

  const onToggleReaction = useCallback(async (id: string, kind: AnnotationReactionKind) => {
    const res = await toggleReactionApi(id, kind);
    setAnnotations((prev) => prev.map((a) => (a.id === id ? res.annotation : a)));
  }, []);

  return (
    <section
      aria-label="Comments thread"
      className="flex flex-col gap-4 rounded-lg border border-border bg-bg-elevated p-4"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-fg">
          Comments {annotations.length > 0 ? `(${annotations.length})` : ''}
        </h2>
        <span className="text-xs text-fg-muted">
          Posting as <span className="font-mono">{currentUserEmail}</span>
        </span>
      </header>

      {error !== null && (
        <p className="rounded border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
          {error}
        </p>
      )}

      {threads.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {loading ? 'Loading comments…' : 'No comments yet — be the first to post.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {threads.map((node) => (
            <li
              key={node.comment.id}
              className="flex flex-col gap-2 rounded border border-border bg-bg p-3"
            >
              <CommentCard
                annotation={node.comment}
                currentUserId={currentUserId}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onToggleReaction={onToggleReaction}
                onReply={(body) => onCreate(body, node.comment.id)}
              />
              {node.replies.length > 0 && (
                <ul className="ml-6 flex flex-col gap-2 border-l border-border pl-3">
                  {node.replies.map((r) => (
                    <li key={r.id}>
                      <CommentCard
                        annotation={r}
                        currentUserId={currentUserId}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        onToggleReaction={onToggleReaction}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Compose box at the bottom. */}
      <ComposeBox
        placeholder="Add a comment. Markdown supported. ⌘+Enter to post."
        onSubmit={(body) => onCreate(body)}
      />
    </section>
  );
}

interface CommentCardProps {
  annotation: Annotation;
  currentUserId: string;
  onUpdate: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleReaction: (id: string, kind: AnnotationReactionKind) => Promise<void>;
  onReply?: (body: string) => Promise<void>;
}

function CommentCard({
  annotation,
  currentUserId,
  onUpdate,
  onDelete,
  onToggleReaction,
  onReply,
}: CommentCardProps) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const isOwn = annotation.authorUserId === currentUserId;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <AgentAvatar name={annotation.authorEmail || annotation.authorUserId} size={28} />
        <div className="flex-1">
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <span className="font-medium text-fg">{annotation.authorEmail}</span>
            <span title={annotation.createdAt}>{formatRelativeTime(annotation.createdAt)}</span>
            {annotation.updatedAt !== annotation.createdAt && (
              <span className="italic">(edited)</span>
            )}
          </div>
          {editing ? (
            <ComposeBox
              defaultValue={annotation.body}
              placeholder="Edit comment"
              onSubmit={async (body) => {
                await onUpdate(annotation.id, body);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
              submitLabel="Save"
            />
          ) : (
            <div
              className="prose prose-sm mt-1 max-w-none text-sm text-fg [&_a]:text-accent [&_a]:underline [&_code]:rounded [&_code]:bg-bg-subtle [&_code]:px-1"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by DOMPurify
              dangerouslySetInnerHTML={{ __html: renderMarkdown(annotation.body) }}
            />
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-9">
        {annotation.reactions.map((r) => {
          const Icon = REACTION_ICONS[r.kind];
          return (
            <button
              key={r.kind}
              type="button"
              onClick={() => onToggleReaction(annotation.id, r.kind)}
              aria-label={`React with ${REACTION_LABEL[r.kind]}`}
              aria-pressed={r.reactedByMe}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                r.reactedByMe
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border bg-bg text-fg-muted hover:bg-bg-subtle',
              )}
            >
              <Icon className="h-3 w-3" />
              <span className="tabular-nums">{r.count}</span>
            </button>
          );
        })}
        {onReply !== undefined && (
          <button
            type="button"
            className="ml-2 text-xs text-fg-muted hover:underline"
            onClick={() => setReplying((p) => !p)}
          >
            {replying ? 'Cancel reply' : 'Reply'}
          </button>
        )}
        {isOwn && !editing && (
          <>
            <button
              type="button"
              className="ml-2 text-xs text-fg-muted hover:underline"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              type="button"
              className="ml-2 text-xs text-danger hover:underline"
              onClick={() => onDelete(annotation.id)}
            >
              Delete
            </button>
          </>
        )}
      </div>
      {replying && onReply !== undefined && (
        <div className="ml-9">
          <ComposeBox
            placeholder="Reply"
            onSubmit={async (body) => {
              await onReply(body);
              setReplying(false);
            }}
            onCancel={() => setReplying(false)}
            submitLabel="Reply"
          />
        </div>
      )}
    </div>
  );
}

interface ComposeBoxProps {
  placeholder: string;
  defaultValue?: string;
  onSubmit: (body: string) => Promise<void> | void;
  onCancel?: () => void;
  submitLabel?: string;
}

function ComposeBox({
  placeholder,
  defaultValue,
  onSubmit,
  onCancel,
  submitLabel = 'Comment',
}: ComposeBoxProps) {
  const [text, setText] = useState(defaultValue ?? '');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setText('');
      setTab('write');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          className={cn(
            'rounded px-2 py-1',
            tab === 'write'
              ? 'bg-bg-subtle font-medium text-fg'
              : 'text-fg-muted hover:bg-bg-subtle',
          )}
          onClick={() => setTab('write')}
        >
          Write
        </button>
        <button
          type="button"
          className={cn(
            'rounded px-2 py-1',
            tab === 'preview'
              ? 'bg-bg-subtle font-medium text-fg'
              : 'text-fg-muted hover:bg-bg-subtle',
          )}
          onClick={() => setTab('preview')}
        >
          Preview
        </button>
      </div>
      {tab === 'write' ? (
        <textarea
          className="min-h-[100px] w-full rounded border border-border bg-bg p-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Cmd-Enter (macOS) or Ctrl-Enter (other platforms) submits.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
      ) : (
        <div
          className="prose prose-sm min-h-[100px] max-w-none rounded border border-border bg-bg p-2 text-sm text-fg [&_a]:text-accent [&_a]:underline"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by DOMPurify
          dangerouslySetInnerHTML={{
            __html: text.trim().length > 0 ? renderMarkdown(text) : '<em>Nothing to preview</em>',
          }}
        />
      )}
      <div className="flex items-center justify-end gap-2">
        {onCancel !== undefined && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={submitting || text.trim().length === 0}
        >
          {submitting ? 'Posting…' : submitLabel}
        </Button>
      </div>
    </div>
  );
}
