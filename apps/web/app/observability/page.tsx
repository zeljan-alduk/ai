import { ObservabilityPage } from '@/components/observability/observability-page';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

/**
 * Wave-12 /observability — the platform's safety story rendered as
 * live data. Authentication-required, tenant-scoped (the API enforces
 * both via the bearer-token middleware).
 *
 * The page is one big client island that polls
 * `/v1/observability/summary` every 15s. Server component just hosts
 * the page header so the layout chrome boots fast.
 */
export default function ObservabilityRoute() {
  return (
    <div data-tour="privacy-feed">
      <PageHeader
        title="Observability"
        description="Live signals from the platform: privacy-tier enforcement, sandbox/guards activity, and local-vs-cloud routing. Updates every 15 seconds."
      />
      <ObservabilityPage />
    </div>
  );
}
