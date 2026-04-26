/**
 * Server-only theme helpers — `getTheme()` reads the cookie inside a
 * server component / server action / route handler.
 *
 * Split from `lib/theme.ts` because `lib/theme.ts` is import-clean
 * for the client bundle (it has the `nextTheme` cycle + `parseTheme`
 * helpers that the ThemeToggle uses), while *this* file pulls in
 * `next/headers` which is server-only.
 */

import { cookies } from 'next/headers';
import { THEME_COOKIE, type Theme, parseTheme } from './theme';

/** Read the persisted theme from the request cookie. Defaults to `'system'`. */
export async function getTheme(): Promise<Theme> {
  const store = await cookies();
  return parseTheme(store.get(THEME_COOKIE)?.value);
}
