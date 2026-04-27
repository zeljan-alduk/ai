'use client';

/**
 * Wave-14C — per-row actions for an integration.
 *
 * Renders three buttons:
 *
 *   - Test fire: hits POST /v1/integrations/:id/test, surfaces the
 *     result inline so the operator can confirm the runner works
 *     without waiting for a real run.
 *   - Pause/resume: PATCH `enabled` to flip the toggle.
 *   - Delete: DELETE the row after a confirm prompt.
 */

import { Button } from '@/components/ui/button';
import {
  type IntegrationContract,
  deleteIntegration,
  testFireIntegration,
  updateIntegration,
} from '@/lib/api-admin';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function IntegrationActions({ integration }: { integration: IntegrationContract }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lastTest, setLastTest] = useState<string | null>(null);

  const fire = async () => {
    setBusy(true);
    setLastTest(null);
    try {
      const res = await testFireIntegration(integration.id);
      if (res.ok) {
        setLastTest(`OK${res.statusCode !== undefined ? ` (${res.statusCode})` : ''}`);
        router.refresh();
      } else {
        setLastTest(
          res.timedOut === true ? 'timed out' : `failed: ${res.error ?? 'unknown error'}`,
        );
      }
    } catch (err) {
      setLastTest(err instanceof Error ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async () => {
    setBusy(true);
    try {
      await updateIntegration(integration.id, { enabled: !integration.enabled });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete integration "${integration.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteIntegration(integration.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={fire} disabled={busy}>
        Test
      </Button>
      <Button size="sm" variant="ghost" onClick={toggleEnabled} disabled={busy}>
        {integration.enabled ? 'Pause' : 'Resume'}
      </Button>
      <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
        Delete
      </Button>
      {lastTest !== null && <span className="text-[11px] text-slate-500">{lastTest}</span>}
    </div>
  );
}
