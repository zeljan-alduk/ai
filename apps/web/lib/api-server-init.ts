/**
 * Server-only bootstrap: wire `lib/api.ts` to the cookie-backed
 * session resolver. Importing this module from a server component is
 * how we attach `Authorization: Bearer <token>` to every API request
 * the server makes on behalf of the user.
 *
 * Why a side-effect-on-import instead of a static dependency? Because
 * `lib/api.ts` is also imported from client components (the secrets
 * delete button, the new-secret form, …), and pulling `next/headers`
 * into that module's import graph would break the client bundle.
 * Splitting the wiring into this server-only file keeps the bundle
 * tree clean: client paths never reach here, server paths import this
 * once at the root layout and the wiring carries through.
 */

import { setServerTokenResolver } from './api';
import { getSession } from './session';

let installed = false;

/** Idempotent. Safe to call from any server component. */
export function ensureServerSessionWired(): void {
  if (installed) return;
  installed = true;
  setServerTokenResolver(async () => {
    const session = await getSession();
    return session?.token ?? null;
  });
}

// Side-effect-on-import: any server file that does
// `import './lib/api-server-init'` automatically gets the wiring.
ensureServerSessionWired();
