'use client';

/**
 * Wave-14 — alert rules list table with row-level actions.
 */

import { Button } from '@/components/ui/button';
import {
  deleteAlertRule,
  silenceAlertRule,
  testAlertRule,
  updateAlertRule,
} from '@/lib/api-dashboards';
import type { AlertRule } from '@aldo-ai/api-contract';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { silenceUntilFor } from './alert-form';

export function AlertsTable({ rules }: { rules: ReadonlyArray<AlertRule> }) {
  if (rules.length === 0) {
    return <p className="text-sm text-slate-500">No alert rules yet.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Threshold</th>
            <th className="px-3 py-2">Channels</th>
            <th className="px-3 py-2">Last fired</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {rules.map((r) => (
            <AlertRow key={r.id} rule={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertRow({ rule }: { rule: AlertRule }) {
  const [pending, start] = useTransition();
  const [testResult, setTestResult] = useState<string | null>(null);
  const [silenceOpen, setSilenceOpen] = useState(false);
  const router = useRouter();

  const toggle = () => {
    start(async () => {
      await updateAlertRule(rule.id, { enabled: !rule.enabled });
      router.refresh();
    });
  };

  const test = () => {
    start(async () => {
      const r = await testAlertRule(rule.id);
      setTestResult(
        r.wouldTrigger
          ? `Would fire: value=${r.value}`
          : `Quiet: value=${r.value}${r.note !== undefined ? ` (${r.note})` : ''}`,
      );
    });
  };

  const remove = () => {
    if (!confirm(`Delete alert "${rule.name}"?`)) return;
    start(async () => {
      await deleteAlertRule(rule.id);
      router.refresh();
    });
  };

  const silence = (option: '1h' | '24h' | '7d' | 'forever') => {
    start(async () => {
      await silenceAlertRule(rule.id, silenceUntilFor(option));
      setSilenceOpen(false);
      router.refresh();
    });
  };

  return (
    <tr className="text-slate-700">
      <td className="px-3 py-2 align-top">
        <div className="font-medium text-slate-900">{rule.name}</div>
        {rule.targets.agent !== undefined ? (
          <div className="text-[11px] text-slate-500">agent: {rule.targets.agent}</div>
        ) : null}
        {rule.targets.model !== undefined ? (
          <div className="text-[11px] text-slate-500">model: {rule.targets.model}</div>
        ) : null}
      </td>
      <td className="px-3 py-2 align-top">{rule.kind}</td>
      <td className="px-3 py-2 align-top tabular-nums">
        {rule.threshold.comparator} {rule.threshold.value} / {rule.threshold.period}
      </td>
      <td className="px-3 py-2 align-top text-[11px]">
        {rule.notificationChannels.length === 0
          ? '—'
          : rule.notificationChannels.map((c) => (c.startsWith('slack:') ? 'slack' : c)).join(', ')}
      </td>
      <td className="px-3 py-2 align-top text-[11px] text-slate-500">
        {rule.lastTriggeredAt !== null ? new Date(rule.lastTriggeredAt).toLocaleString() : 'never'}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={toggle} disabled={pending}>
            {rule.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button size="sm" variant="ghost" onClick={test} disabled={pending}>
            Test
          </Button>
          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSilenceOpen((v) => !v)}
              disabled={pending}
            >
              Silence
            </Button>
            {silenceOpen ? (
              <div className="absolute right-0 z-10 mt-1 w-32 rounded-md border border-slate-200 bg-white shadow-md">
                {(['1h', '24h', '7d', 'forever'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-100"
                    onClick={() => silence(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Button size="sm" variant="destructive" onClick={remove} disabled={pending}>
            Delete
          </Button>
        </div>
        {testResult !== null ? (
          <p className="mt-1 text-right text-[10px] text-slate-500">{testResult}</p>
        ) : null}
      </td>
    </tr>
  );
}
