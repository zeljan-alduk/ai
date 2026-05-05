'use client';

/**
 * /engagements create form — small client island.
 *
 * Posts to /v1/engagements; on success, navigates to the new engagement's
 * detail page. On 409 (slug conflict) surfaces the typed error message.
 */

import { createEngagementApi } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CreateEngagementForm() {
  const router = useRouter();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await createEngagementApi({
        slug: slug.trim(),
        name: name.trim(),
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
      });
      router.push(`/engagements/${res.engagement.slug}`);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to create engagement';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-fg-muted">Slug</span>
        <input
          type="text"
          required
          pattern="^[a-z0-9][a-z0-9-]*$"
          maxLength={64}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="acme-q3"
          className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-fg-muted">Name</span>
        <input
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ACME Q3 platform rebuild"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={submitting || slug === '' || name === ''}
        className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Create'}
      </button>
      <label className="flex flex-col gap-1 text-sm sm:col-span-3">
        <span className="font-medium text-fg-muted">Description (optional)</span>
        <textarea
          rows={2}
          maxLength={4000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Lift-and-shift CRM to multi-tenant arch."
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
        />
      </label>
      {error !== null ? (
        <p className="text-sm text-danger sm:col-span-3">Error: {error}</p>
      ) : null}
    </form>
  );
}
