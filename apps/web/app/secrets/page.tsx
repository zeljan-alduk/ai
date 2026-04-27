import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listSecrets } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import Link from 'next/link';
import { DeleteSecretButton } from './delete-button';

export const dynamic = 'force-dynamic';

export default async function SecretsPage() {
  let listed: Awaited<ReturnType<typeof listSecrets>> | null = null;
  let error: unknown = null;
  try {
    listed = await listSecrets();
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Secrets"
        description="Tenant-scoped opaque blobs (provider keys, OAuth tokens, webhook signing keys). Resolved only at tool-call time — never in prompts, traces, or logs."
        actions={
          <Link
            href="/secrets/new"
            className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
          >
            New secret
          </Link>
        }
      />
      {error ? (
        <ErrorView error={error} context="secrets" />
      ) : listed ? (
        listed.secrets.length === 0 ? (
          <EmptyState
            title="No secrets yet."
            hint="Secrets are tenant-scoped opaque values referenced from agent specs as secret://NAME and resolved only at tool-call time inside ToolHost. They never appear in prompts, run events, traces, or logs. Add one to wire up provider keys, OAuth tokens, or webhook signing keys."
            action={
              <Link
                href="/secrets/new"
                className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
              >
                New secret
              </Link>
            }
          />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-end">
              <p className="text-xs text-slate-500">
                {listed.secrets.length} secret{listed.secrets.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
              <table className="aldo-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Fingerprint</th>
                    <th>Preview</th>
                    <th>Updated</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.secrets.map((s) => (
                    <tr key={s.name} className="hover:bg-slate-50">
                      <td>
                        <span className="font-mono text-sm text-slate-900">{s.name}</span>
                        {s.referencedBy && s.referencedBy.length > 0 ? (
                          <p className="mt-0.5 text-xs text-slate-500">
                            referenced by{' '}
                            <span className="font-mono">{s.referencedBy.join(', ')}</span>
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <span className="font-mono text-xs text-slate-600" title={s.fingerprint}>
                          {s.fingerprint.slice(0, 12)}
                        </span>
                      </td>
                      <td>
                        <span className="font-mono text-xs text-slate-600">
                          <span className="text-slate-400">…</span>
                          {s.preview}
                        </span>
                      </td>
                      <td className="text-sm text-slate-600" title={s.updatedAt}>
                        {formatRelativeTime(s.updatedAt)}
                      </td>
                      <td className="text-right">
                        <DeleteSecretButton name={s.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}
    </>
  );
}
