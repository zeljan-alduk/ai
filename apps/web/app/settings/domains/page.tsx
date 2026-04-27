/**
 * /settings/domains — Wave-16D custom-domain wizard.
 *
 * Server component that fetches the current row; the actions
 * (add/verify/remove) are a client component in `domain-actions.tsx`.
 *
 * Wizard flow:
 *   1. Add domain → enter hostname → server returns TXT instructions.
 *   2. User publishes the TXT record at their DNS provider.
 *   3. User clicks "Verify" → server does a DNS lookup, confirms.
 *   4. Verified row shows the next-step CNAME instructions.
 *
 * SSL is provisioned automatically by Fly / Vercel once the TXT
 * verification succeeds; this page only reflects the status.
 */

import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listDomains } from '@/lib/api-admin';
import { DomainActions } from './domain-actions';

export const dynamic = 'force-dynamic';

const FLY_API_HOST = 'ai.aldo.tech';
const VERCEL_WEB_HOST = 'ai.aldo.tech';

export default async function DomainsPage() {
  let listed: Awaited<ReturnType<typeof listDomains>> | null = null;
  let error: unknown = null;
  try {
    listed = await listDomains();
  } catch (err) {
    error = err;
  }

  if (error) {
    return (
      <>
        <PageHeader title="Custom domains" description="" />
        <ErrorView error={error} context="domains" />
      </>
    );
  }

  const domain = listed?.domains[0] ?? null;

  return (
    <>
      <PageHeader
        title="Custom domains"
        description="Serve the API on your own hostname. Verification is via TXT record; SSL is provisioned automatically once verified."
      />
      <DomainActions
        initialDomain={domain}
        flyApiHost={FLY_API_HOST}
        vercelWebHost={VERCEL_WEB_HOST}
      />
    </>
  );
}
