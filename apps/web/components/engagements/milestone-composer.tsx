'use client';

import { createMilestoneApi } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function MilestoneComposer({ slug }: { slug: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createMilestoneApi(slug, {
        title: title.trim(),
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
      });
      setTitle('');
      setDescription('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create milestone');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[2fr_3fr_auto] sm:items-end">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-fg-muted">Title</span>
        <input
          type="text"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="spec sign-off"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-fg-muted">Description (optional)</span>
        <input
          type="text"
          maxLength={4000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Customer reviews + signs off the architecture decision."
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={submitting || title === ''}
        className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Adding…' : 'Add milestone'}
      </button>
      {error !== null ? (
        <p className="text-sm text-danger sm:col-span-3">Error: {error}</p>
      ) : null}
    </form>
  );
}
