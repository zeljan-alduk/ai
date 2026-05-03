/**
 * Wave-4 — `/observability/spend` cost + spend analytics dashboard.
 *
 * Closes the LangSmith spend dashboard / Braintrust experiments cost
 * view / Bedrock + Vertex billing-page gap. Tenant-scoped, optionally
 * project-scoped (via `?project=`); the API enforces both.
 *
 * Server component just hosts the page header so layout chrome boots
 * fast. Everything else is one big client island that polls /v1/spend
 * every 30s and lets the user pick a window.
 */

import { PageHeader } from '@/components/page-header';
import { SpendDashboard } from '@/components/spend/spend-dashboard';

export const dynamic = 'force-dynamic';

export default function SpendRoute() {
  return (
    <>
      <PageHeader
        title="Spend"
        description="Cost + token usage across runs. Top-line cards, time series, and breakdowns by capability, agent, and project."
      />
      <SpendDashboard />
    </>
  );
}
