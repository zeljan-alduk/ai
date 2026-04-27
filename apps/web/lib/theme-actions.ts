'use server';

/**
 * Server action: persist a theme choice to the `aldo_theme` cookie.
 *
 * The toggle component calls this whenever the user clicks the
 * sun/moon button. We intentionally do not redirect — the client
 * island flips the `<html class="dark">` immediately for an instant
 * UI update, and the cookie just survives across requests.
 */

import { cookies } from 'next/headers';
import { THEME_COOKIE, THEME_MAX_AGE_SECONDS, type Theme, isTheme } from './theme';

export async function setThemeAction(theme: Theme): Promise<void> {
  if (!isTheme(theme)) return;
  const store = await cookies();
  store.set(THEME_COOKIE, theme, {
    path: '/',
    maxAge: THEME_MAX_AGE_SECONDS,
    sameSite: 'lax',
    httpOnly: false, // the toggle reads it; non-secret display preference
    secure: process.env.NODE_ENV === 'production',
  });
}
