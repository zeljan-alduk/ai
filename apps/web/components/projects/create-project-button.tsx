'use client';

/**
 * Create-project Dialog. Fires `router.refresh()` on success so the
 * server-rendered list picks up the new row.
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ApiClientError, createProject } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function CreateProjectButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New project</Button>
      </DialogTrigger>
      {open ? <CreateProjectForm onDone={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function CreateProjectForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugDirty, setSlugDirty] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-derive slug from name until the user manually edits the slug
  // field, then leave it alone. Same pattern as Linear / Vercel.
  useEffect(() => {
    if (slugDirty) return;
    setSlug(toSlug(name));
  }, [name, slugDirty]);

  const slugValid = useMemo(
    () => slug.length >= 1 && slug.length <= 64 && SLUG_RE.test(slug),
    [slug],
  );

  const submit = async () => {
    if (name.trim() === '') {
      setError('Name is required.');
      return;
    }
    if (!slugValid) {
      setError('Slug must be lowercase letters, digits, or dashes (1–64 chars).');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createProject({ slug, name: name.trim(), description });
      onDone();
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.code === 'project_slug_conflict'
            ? `A project with slug "${slug}" already exists in this tenant.`
            : err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          Tenant-scoped grouping. Slug is shown in URLs and CLI commands. You can rename or archive
          the project later.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4 text-sm">
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
            placeholder="Customer support bot"
          />
        </Field>
        <Field
          label="Slug"
          hint={
            slugValid || slug.length === 0
              ? 'Lowercase letters, digits, or dashes. Used in URLs.'
              : 'Slug must be lowercase letters, digits, or dashes.'
          }
        >
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugDirty(true);
            }}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-[12px]"
            placeholder="customer-support-bot"
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
            placeholder="What lives in this project? Who owns it?"
          />
        </Field>

        {error !== null ? (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
            {error}
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting || !slugValid || name.trim() === ''}>
          {submitting ? 'Creating…' : 'Create project'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
      {hint !== undefined ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
