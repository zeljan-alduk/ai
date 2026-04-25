/**
 * Docs — `/docs` redirect.
 *
 * Real docs are TODO. Until they land, this route is a 308 permanent
 * redirect to the public GitHub repo (the README plus the
 * inline-documented codebase are the canonical reference today).
 *
 * Using a server-component `redirect()` rather than `next.config`
 * `redirects` keeps the rule local to the route file — easier to
 * find, easier to delete when real docs ship.
 */

import { permanentRedirect } from 'next/navigation';

export default function DocsRedirect(): never {
  permanentRedirect('https://github.com/zeljan-alduk/ai');
}
