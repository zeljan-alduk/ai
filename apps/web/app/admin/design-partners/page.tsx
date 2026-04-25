/**
 * `/admin/design-partners` — admin review surface for the
 * design-partner program.
 *
 * Server component. Fetches `/v1/admin/design-partner-applications`
 * and renders one row per submission with an inline editor for
 * status + admin notes. Each save fires the
 * `updateDesignPartnerApplicationAction` server action; the page
 * uses `revalidatePath('/admin/design-partners')` so the next
 * navigation re-fetches.
 *
 * Permission model:
 *   The page is in the protected shell (sidebar layout). The
 *   middleware's auth guard redirects unauthenticated visitors to
 *   `/login`. We then ALSO check the admin permission server-side
 *   here — we render a "403 not an admin" page when the API returns
 *   403, so the founder doesn't accidentally bookmark this URL on a
 *   non-admin tenant and see an empty list with no explanation.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { PageHeader } from '@/components/page-header';
import { ApiClientError, listDesignPartnerApplications } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import type { DesignPartnerApplication } from '@aldo-ai/api-contract';
import { ApplicationCard } from './application-card';

export const dynamic = 'force-dynamic';

interface SearchParams {
  readonly status?: string;
}

export default async function AdminDesignPartnersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filter = isStatus(sp.status) ? sp.status : undefined;

  let listed: { applications: readonly DesignPartnerApplication[] } | null = null;
  let forbidden = false;
  let error: unknown = null;
  try {
    listed = await listDesignPartnerApplications(filter ? { status: filter } : {});
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 403) {
      forbidden = true;
    } else {
      error = err;
    }
  }

  if (forbidden) {
    return (
      <>
        <PageHeader title="Design-partner applications" description="Admin only." />
        <div className="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          <p className="font-semibold">403 — not an admin.</p>
          <p className="mt-2">
            This page is restricted to platform admins (currently the owner of the default tenant).
            If you believe you should have access, ask the operator to add your tenant to the
            admin-slug list in
            <code className="ml-1 rounded bg-red-100 px-1 font-mono text-[12px]">
              apps/api/src/routes/design-partners.ts
            </code>
            .
          </p>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Design-partner applications" description="Admin only." />
        <div className="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          <p className="font-semibold">Could not load applications.</p>
          <p className="mt-2">{error instanceof Error ? error.message : 'Unknown error.'}</p>
        </div>
      </>
    );
  }

  const apps = listed?.applications ?? [];

  return (
    <>
      <PageHeader
        title="Design-partner applications"
        description="Submissions from the public /design-partner form. New entries go to status=new; the founder triages them here."
      />
      <FilterBar selected={filter} />
      {apps.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">No applications match this filter.</p>
          <p className="mt-1 text-sm text-slate-500">
            Try removing the status filter, or wait for the next submission.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {apps.map((a) => (
            <li key={a.id}>
              <ApplicationCard
                application={a}
                createdRelative={formatRelativeTime(a.createdAt)}
                reviewedRelative={a.reviewedAt ? formatRelativeTime(a.reviewedAt) : null}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function FilterBar({ selected }: { selected: string | undefined }) {
  const filters: ReadonlyArray<{ label: string; value: string | undefined }> = [
    { label: 'All', value: undefined },
    { label: 'New', value: 'new' },
    { label: 'Contacted', value: 'contacted' },
    { label: 'Accepted', value: 'accepted' },
    { label: 'Declined', value: 'declined' },
  ];
  return (
    <div className="mb-4 flex items-center gap-2 text-sm">
      {filters.map((f) => {
        const href =
          f.value === undefined
            ? '/admin/design-partners'
            : `/admin/design-partners?status=${f.value}`;
        const active = selected === f.value;
        return (
          <a
            key={f.label}
            href={href}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              active
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </a>
        );
      })}
    </div>
  );
}

function isStatus(s: string | undefined): s is 'new' | 'contacted' | 'accepted' | 'declined' {
  return s === 'new' || s === 'contacted' || s === 'accepted' || s === 'declined';
}
