'use server';

import '@/lib/api-server-init';

/**
 * Server actions invoked from the sidebar user menu.
 *
 * Kept in their own module so the (client) sidebar can import them
 * without dragging the auth-page actions module into its bundle.
 */

import { ApiClientError, switchTenant } from '@/lib/api';
import { setSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';

export async function switchTenantAction(form: FormData): Promise<void> {
  const slug = form.get('tenantSlug');
  if (typeof slug !== 'string' || slug.length === 0) return;

  try {
    const result = await switchTenant({ tenantSlug: slug });
    await setSession(result.token);
  } catch (err) {
    // Swallow the failure — the sidebar is not the right place to surface
    // a multi-line error. The page will re-render with the prior tenant
    // intact. A future iteration can flash a toast.
    if (!(err instanceof ApiClientError)) throw err;
  }
  // Force every server component below the layout to re-fetch with the
  // new tenant's session. `revalidatePath('/', 'layout')` is the
  // App-Router-blessed way to nuke the route cache from the root down.
  revalidatePath('/', 'layout');
}
