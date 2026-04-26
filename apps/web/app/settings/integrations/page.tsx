/**
 * /settings/integrations — Wave-14C outbound integrations admin.
 *
 * Lists every integration in the active tenant, with kind icon, name,
 * subscribed events, enabled toggle, and last-fired relative time.
 * Owners + admins can manage; members + viewers see view-only.
 *
 * The page itself is a server component that fetches the list; the
 * row actions, the New-integration dialog, and the test-fire button
 * are client components in sibling files.
 */

import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listIntegrations } from '@/lib/api-admin';
import { formatRelativeTime } from '@/lib/format';
import { IntegrationActions } from './integration-actions';
import { NewIntegrationDialog } from './new-integration-dialog';

export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  slack: 'Slack',
  github: 'GitHub',
  webhook: 'Webhook',
  discord: 'Discord',
};

const EVENT_LABELS: Record<string, string> = {
  run_completed: 'Run completed',
  run_failed: 'Run failed',
  sweep_completed: 'Sweep completed',
  guards_blocked: 'Guards blocked',
  budget_threshold: 'Budget threshold',
  invitation_received: 'Invitation received',
};

export default async function IntegrationsPage() {
  let listed: Awaited<ReturnType<typeof listIntegrations>> | null = null;
  let error: unknown = null;
  try {
    listed = await listIntegrations();
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Forward run, sweep, and guard events to Slack, GitHub, Discord, or any HMAC-signed webhook. Owners + admins can manage; members are read-only."
        actions={<NewIntegrationDialog />}
      />
      {error ? (
        <ErrorView error={error} context="integrations" />
      ) : listed === null ? null : listed.integrations.length === 0 ? (
        <EmptyState
          title="No integrations yet."
          hint="Send run, sweep, and guard events to your team's chat or your CI. Slack, GitHub, Discord, and HMAC-signed webhooks are supported out of the box."
          illustration={<img src="/empty-states/integrations.svg" alt="" width={88} height={88} />}
          action={<NewIntegrationDialog />}
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <table className="aldo-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Name</th>
                <th>Events</th>
                <th>Enabled</th>
                <th>Last fired</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {listed.integrations.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="font-medium text-slate-900">
                    <span className="inline-flex items-center gap-1.5">
                      <KindIcon kind={i.kind} />
                      {KIND_LABELS[i.kind] ?? i.kind}
                    </span>
                  </td>
                  <td className="font-medium">{i.name}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {i.events.map((e) => (
                        <span
                          key={e}
                          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
                          title={EVENT_LABELS[e] ?? e}
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {i.enabled ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        On
                      </span>
                    ) : (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        Paused
                      </span>
                    )}
                  </td>
                  <td className="text-xs text-slate-500">
                    {i.lastFiredAt ? formatRelativeTime(i.lastFiredAt) : '—'}
                  </td>
                  <td>
                    <IntegrationActions integration={i} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function KindIcon({ kind }: { kind: string }) {
  // Tiny coloured square per kind — keeps the row scannable without
  // reaching for a real logo asset (which would carry a brand-mark
  // license question).
  const bg: Record<string, string> = {
    slack: 'bg-pink-500',
    github: 'bg-slate-700',
    webhook: 'bg-blue-500',
    discord: 'bg-indigo-500',
  };
  return (
    <span aria-hidden className={`inline-block h-3 w-3 rounded-sm ${bg[kind] ?? 'bg-slate-400'}`} />
  );
}
