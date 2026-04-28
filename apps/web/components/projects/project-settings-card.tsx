'use client';

/**
 * Inline project settings — rename, edit description, archive/unarchive.
 * Calls `updateProject` and `router.refresh()` on every save.
 */

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiClientError, updateProject } from '@/lib/api';
import type { Project } from '@aldo-ai/api-contract';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ProjectSettingsCard({ project }: { project: Project }) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [submitting, setSubmitting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const isArchived = project.archivedAt !== null;
  const dirty = name !== project.name || description !== project.description;

  const save = async () => {
    if (name.trim() === '') {
      setError('Name cannot be empty.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updateProject(project.slug, {
        name: name.trim(),
        description,
      });
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleArchive = async () => {
    setArchiving(true);
    setError(null);
    try {
      await updateProject(project.slug, { archived: !isArchived });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : (err as Error).message);
    } finally {
      setArchiving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
          />
        </Field>

        {error !== null ? (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
            {error}
          </div>
        ) : null}
        {savedAt !== null && error === null ? (
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
            Saved.
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleArchive}
            disabled={archiving || submitting}
          >
            {archiving ? 'Working…' : isArchived ? 'Unarchive project' : 'Archive project'}
          </Button>
          <Button onClick={save} disabled={submitting || !dirty}>
            {submitting ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}
