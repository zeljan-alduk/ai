'use client';

/**
 * Wave-14 — "New alert rule" dialog.
 *
 * Posts a `CreateAlertRuleRequest` after running it through the
 * pure-logic `draftToCreateRequest` validator (which is unit tested
 * in alert-form.test.ts). The form refuses non-Slack webhook URLs
 * inline.
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
import { createAlertRule } from '@/lib/api-dashboards';
import type { AlertKind } from '@aldo-ai/api-contract';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { type AlertFormDraft, draftToCreateRequest } from './alert-form';

const KINDS: ReadonlyArray<AlertKind> = [
  'cost_spike',
  'error_rate',
  'latency_p95',
  'guards_blocked',
  'budget_threshold',
];

export function NewAlertButton() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AlertFormDraft>({
    name: '',
    kind: 'cost_spike',
    thresholdValue: '50',
    comparator: 'gt',
    period: '1h',
    targetAgent: '',
    targetModel: '',
    channelsRaw: 'app',
  });
  const router = useRouter();

  const submit = () => {
    setError(null);
    const result = draftToCreateRequest(draft);
    if (!result.ok) {
      setError(result.errors.map((e) => `${e.field}: ${e.reason}`).join('; '));
      return;
    }
    start(async () => {
      try {
        await createAlertRule(result.request);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to create');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New rule</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New alert rule</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-slate-700">
            Name
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Spend > $50/day"
              className="mt-1"
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Kind
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as AlertKind })}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs font-medium text-slate-700">
              Comparator
              <select
                value={draft.comparator}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    comparator: e.target.value as AlertFormDraft['comparator'],
                  })
                }
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="gt">&gt;</option>
                <option value="gte">≥</option>
                <option value="lt">&lt;</option>
                <option value="lte">≤</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Threshold
              <Input
                value={draft.thresholdValue}
                onChange={(e) => setDraft({ ...draft, thresholdValue: e.target.value })}
                className="mt-1"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Period
              <select
                value={draft.period}
                onChange={(e) =>
                  setDraft({ ...draft, period: e.target.value as AlertFormDraft['period'] })
                }
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="5m">5m</option>
                <option value="1h">1h</option>
                <option value="24h">24h</option>
                <option value="7d">7d</option>
              </select>
            </label>
          </div>
          <label className="block text-xs font-medium text-slate-700">
            Target agent (optional)
            <Input
              value={draft.targetAgent}
              onChange={(e) => setDraft({ ...draft, targetAgent: e.target.value })}
              placeholder="security-reviewer"
              className="mt-1"
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Channels (one per line)
            <textarea
              value={draft.channelsRaw}
              onChange={(e) => setDraft({ ...draft, channelsRaw: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-mono"
              placeholder="app&#10;email&#10;slack:https://hooks.slack.com/services/..."
            />
          </label>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
