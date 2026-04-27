import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listApiKeys } from '@/lib/api-admin';
import { formatRelativeTime } from '@/lib/format';
import { DeleteKeyButton, RevokeKeyButton } from './key-actions';
import { NewKeyDialog } from './new-key-dialog';

export const dynamic = 'force-dynamic';

export default async function ApiKeysPage() {
  let listed: Awaited<ReturnType<typeof listApiKeys>> | null = null;
  let error: unknown = null;
  try {
    listed = await listApiKeys();
  } catch (err) {
    error = err;
  }

  return (
    <div data-tour="api-keys">
      <PageHeader
        title="API keys"
        description="Programmatic credentials scoped to this tenant. Each key is shown once on creation and never re-displayable. Revoking is immediate."
        actions={<NewKeyDialog />}
      />
      {error ? (
        <ErrorView error={error} context="api-keys" />
      ) : listed ? (
        listed.keys.length === 0 ? (
          <EmptyState
            title="No API keys yet."
            hint="Mint one to call /v1/runs, /v1/agents, or any other API surface from your CI / scripts. Keys are scoped — start with the minimum (read-only) and broaden as needed."
            action={<NewKeyDialog />}
          />
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <table className="aldo-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Scopes</th>
                  <th>Last used</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {listed.keys.map((k) => (
                  <tr key={k.id} className="hover:bg-slate-50">
                    <td className="font-medium text-slate-900">{k.name}</td>
                    <td>
                      <span className="font-mono text-xs text-slate-600">{k.prefix}…</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <span
                            key={s}
                            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="text-xs text-slate-500">
                      {k.lastUsedAt ? formatRelativeTime(k.lastUsedAt) : '—'}
                    </td>
                    <td className="text-xs text-slate-500">
                      {k.expiresAt ? (
                        expiresLabel(k.expiresAt)
                      ) : (
                        <span className="text-slate-400">never</span>
                      )}
                    </td>
                    <td>
                      {k.revokedAt ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                          revoked
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">
                          active
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      {k.revokedAt ? null : <RevokeKeyButton id={k.id} />}
                      <DeleteKeyButton id={k.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}

function expiresLabel(at: string): string {
  const ms = new Date(at).getTime() - Date.now();
  if (Number.isNaN(ms)) return at;
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86400_000);
  if (days >= 1) return `in ${days}d`;
  const hours = Math.floor(ms / 3600_000);
  if (hours >= 1) return `in ${hours}h`;
  return 'soon';
}
