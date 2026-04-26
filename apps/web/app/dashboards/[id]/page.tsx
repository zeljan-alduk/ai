/**
 * Wave-14 — `/dashboards/[id]` viewer + (toggle) editor.
 *
 * Server-fetches the dashboard row + the data payload for every
 * widget in one round-trip, then renders the widgets at their grid
 * positions via CSS Grid. The "Edit" button on the page header flips
 * to the client-side editor (DnD via @dnd-kit/core).
 */

import { DashboardCanvas } from '@/components/dashboards/dashboard-canvas';
import { PageHeader } from '@/components/page-header';
import { getDashboard, getDashboardData } from '@/lib/api-dashboards';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function DashboardDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const { edit } = await searchParams;
  const editing = edit === '1';
  let dashboard: Awaited<ReturnType<typeof getDashboard>> | undefined;
  try {
    dashboard = await getDashboard(id);
  } catch {
    notFound();
  }
  let widgets: Record<string, unknown> = {};
  try {
    const payload = await getDashboardData(id);
    widgets = payload.widgets;
  } catch {
    widgets = {};
  }
  return (
    <>
      <PageHeader title={dashboard.name} description={dashboard.description || 'Dashboard.'} />
      <DashboardCanvas
        id={id}
        layout={dashboard.layout}
        initialData={widgets}
        canEdit={dashboard.ownedByMe}
        startInEditor={editing}
      />
    </>
  );
}
