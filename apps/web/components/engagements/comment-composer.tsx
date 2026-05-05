'use client';

import { createEngagementCommentApi } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const KIND_OPTIONS: { value: 'comment' | 'change_request' | 'architecture_decision'; label: string }[] = [
  { value: 'comment', label: 'Comment' },
  { value: 'change_request', label: 'Change request' },
  { value: 'architecture_decision', label: 'Architecture decision' },
];

export function CommentComposer({ slug }: { slug: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<typeof KIND_OPTIONS[number]['value']>('comment');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createEngagementCommentApi(slug, {
        body: body.trim(),
        kind,
      });
      setBody('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to post comment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {KIND_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setKind(opt.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
              kind === opt.value
                ? 'bg-accent/12 text-accent ring-accent/30'
                : 'bg-bg-subtle/40 text-fg-muted ring-border hover:text-fg'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <textarea
        rows={3}
        required
        minLength={1}
        maxLength={8000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={
          kind === 'change_request'
            ? "What needs to change before the next milestone?"
            : kind === 'architecture_decision'
              ? 'Capture the rationale: chose Postgres + Hono because…'
              : 'Free-form discussion.'
        }
        className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-faint">
          Comments can reference a run via the run viewer's "discuss" link (coming soon).
        </p>
        <button
          type="submit"
          disabled={submitting || body.trim() === ''}
          className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </div>
      {error !== null ? <p className="text-sm text-danger">Error: {error}</p> : null}
    </form>
  );
}
