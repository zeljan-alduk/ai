/**
 * Wave-14 — `/dashboards` list page.
 *
 * Server-rendered card grid: each card has a tiny SVG snapshot of the
 * widget layout, the dashboard name + description, and an action row
 * (Open / Delete). The "New dashboard" button opens a Dialog.
 */

import { LayoutThumbnail } from '@/components/dashboards/layout-thumbnail';
import { NewDashboardButton } from '@/components/dashboards/new-dashboard-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { listDashboards } from '@/lib/api-dashboards';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function DashboardsRoute() {
  const data = await listDashboards();
  return (
    <>
      <PageHeader
        title="Dashboards"
        description="Custom dashboards for runs, cost, and safety. Each tenant member sees the shared dashboards by default."
        actions={<NewDashboardButton />}
      />
      {data.dashboards.length === 0 ? (
        <EmptyState
          title="No dashboards yet."
          hint="Try a starter dashboard — Operations and Cost are seeded with sensible defaults so you can mix-and-match widgets without designing from scratch."
          illustration={<img src="/empty-states/dashboards.svg" alt="" width={88} height={88} />}
          action={<NewDashboardButton />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.dashboards.map((d) => (
            <Link
              key={d.id}
              href={`/dashboards/${encodeURIComponent(d.id)}`}
              className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">{d.name}</h3>
                {d.isShared ? (
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-blue-700">
                    shared
                  </span>
                ) : null}
              </div>
              <p className="mb-3 line-clamp-2 text-xs text-slate-500">
                {d.description || 'No description.'}
              </p>
              <LayoutThumbnail layout={d.layout} />
              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                <span>
                  {d.layout.length} widget{d.layout.length === 1 ? '' : 's'}
                </span>
                <span>{d.ownedByMe ? 'Owned by you' : 'Shared'}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
