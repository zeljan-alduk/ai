/**
 * Wave-14 — `/settings/alerts` — alert rules list + new-rule dialog.
 *
 * Server-fetches the list once; the AlertsTable client island handles
 * enable/disable, silence dropdown, test, and delete actions.
 */

import { AlertsTable } from '@/components/dashboards/alerts-table';
import { NewAlertButton } from '@/components/dashboards/new-alert-dialog';
import { PageHeader } from '@/components/page-header';
import { listAlertRules } from '@/lib/api-dashboards';

export const dynamic = 'force-dynamic';

export default async function AlertsRoute() {
  const data = await listAlertRules();
  return (
    <>
      <PageHeader
        title="Alert rules"
        description="Trigger notifications when cost, error rate, latency, or guards-blocked counts cross a threshold. Channels: in-app bell, email (stub), Slack incoming-webhook."
        actions={<NewAlertButton />}
      />
      <AlertsTable rules={data.rules} />
    </>
  );
}
