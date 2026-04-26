'use client';

/**
 * Wave-14 — "New dashboard" dialog.
 *
 * Minimal form: name + description + isShared. After create, redirect
 * to /dashboards/<new-id> in editor mode so the user can drop widgets.
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createDashboard } from '@/lib/api-dashboards';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function NewDashboardButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isShared, setIsShared] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () => {
    setError(null);
    start(async () => {
      try {
        const created = await createDashboard({
          name: name.trim(),
          description: description.trim(),
          isShared,
          layout: [],
        });
        setOpen(false);
        setName('');
        setDescription('');
        router.push(`/dashboards/${encodeURIComponent(created.id)}?edit=1`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to create');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New dashboard</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New dashboard</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-slate-700">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cost MTD"
              className="mt-1"
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Description
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              className="mt-1"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
            />
            Share with everyone in this tenant (read-only).
          </label>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || name.trim().length === 0}>
            {pending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
