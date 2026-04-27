import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listAuditLog } from '@/lib/api-admin';
import Link from 'next/link';
import { AuditTable } from './audit-table';

export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (k: string): string | undefined => {
    const v = params[k];
    if (typeof v === 'string') return v;
    return undefined;
  };
  const verb = single('verb');
  const objectKind = single('objectKind');
  const since = single('since');
  const cursor = single('cursor');

  let listed: Awaited<ReturnType<typeof listAuditLog>> | null = null;
  let error: unknown = null;
  try {
    listed = await listAuditLog({
      ...(verb !== undefined ? { verb } : {}),
      ...(objectKind !== undefined ? { objectKind } : {}),
      ...(since !== undefined ? { since } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
      limit: 50,
    });
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only history of mutations on this tenant — secrets, agents, API keys, members, invitations. Owner-only. Click any row for full JSON."
      />

      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-3">
        <label className="block text-xs text-slate-700">
          Verb
          <input
            name="verb"
            defaultValue={verb ?? ''}
            placeholder="secret.set"
            className="mt-0.5 block w-40 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block text-xs text-slate-700">
          Object kind
          <input
            name="objectKind"
            defaultValue={objectKind ?? ''}
            placeholder="secret"
            className="mt-0.5 block w-40 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block text-xs text-slate-700">
          Since (ISO)
          <input
            name="since"
            defaultValue={since ?? ''}
            placeholder="2026-04-25T00:00:00Z"
            className="mt-0.5 block w-56 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
        >
          Filter
        </button>
        <Link href="/settings/audit" className="text-xs text-slate-500 hover:underline">
          Clear
        </Link>
      </form>

      {error ? (
        <ErrorView error={error} context="audit" />
      ) : listed && listed.entries.length > 0 ? (
        <>
          <AuditTable entries={listed.entries} />
          {listed.meta.hasMore && listed.meta.nextCursor !== null ? (
            <div className="mt-3 text-right">
              <Link
                href={{
                  pathname: '/settings/audit',
                  query: {
                    ...(verb !== undefined ? { verb } : {}),
                    ...(objectKind !== undefined ? { objectKind } : {}),
                    ...(since !== undefined ? { since } : {}),
                    cursor: listed.meta.nextCursor,
                  },
                }}
                className="text-xs text-slate-700 hover:underline"
              >
                Older →
              </Link>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="No audit entries match."
          hint="Adjust the filters above, or kick off an action (revoke a key, set a secret) to populate the log."
        />
      )}
    </>
  );
}
