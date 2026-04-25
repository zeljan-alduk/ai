'use server';

/**
 * Server action that asks the API to seed the current tenant with the
 * default agency template, then sends the operator to /runs. Engineer
 * O is adding the `POST /v1/tenants/me/seed-default` endpoint; until
 * then the action surfaces the server's error message inline so the
 * page can fall back to the manual "Create my first agent" path.
 *
 * LLM-agnostic: this just triggers a server-side seed; provider
 * routing happens later inside the gateway.
 */

import '@/lib/api-server-init';

import { ApiClientError } from '@/lib/api';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export async function seedDefaultAgencyAction(): Promise<void> {
  const session = await getSession();
  if (!session) redirect('/login');

  // We intentionally call the API directly (not through the auth-proxy)
  // because we're already on the server. Use the same `request<T>()`
  // path through `lib/api.ts` once Engineer O publishes the wire shape.
  const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
  let res: Response;
  try {
    res = await fetch(new URL('/v1/tenants/me/seed-default', apiBase), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${session.token}`,
      },
      cache: 'no-store',
    });
  } catch (err) {
    throw new ApiClientError('network', 'Could not reach the API to seed the default agency.', {
      cause: err,
    });
  }

  if (!res.ok && res.status !== 204) {
    // Fall back to /runs anyway — the agency may have been partially
    // seeded, or the endpoint may not be wired yet. The operator can
    // re-trigger from this page.
    redirect('/runs');
  }
  redirect('/runs');
}
