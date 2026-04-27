/**
 * Theme cookie helpers — server-side reads + a server action that
 * persists the user's choice across requests.
 *
 * Three states:
 *   - `'light'` — user explicitly chose light
 *   - `'dark'`  — user explicitly chose dark
 *   - `'system'` (or no cookie) — follow `prefers-color-scheme`
 *
 * The root layout reads `getTheme()` and ships the right `class="dark"`
 * on `<html>` so the SSR'd page matches the user's last choice — no
 * flash of wrong theme. On `'system'` we still need a tiny client
 * effect to add/remove the class because the server can't see media
 * queries; that lives in `<ThemeToggle />`.
 *
 * LLM-agnostic: the toggle has nothing to do with provider routing.
 */

export const THEME_COOKIE = 'aldo_theme';
export const THEME_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // one year

export type Theme = 'light' | 'dark' | 'system';

/** Tight typeguard so we never round-trip a bogus value into the DOM. */
export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * Resolve a raw cookie value to a `Theme`. Anything malformed falls
 * back to `'system'` so a corrupt cookie can't break rendering.
 */
export function parseTheme(raw: string | undefined | null): Theme {
  if (!raw) return 'system';
  return isTheme(raw) ? raw : 'system';
}

/**
 * Cycle order used by the toggle button: light -> dark -> system -> light.
 * Exported so tests can assert the contract without poking the
 * component internals.
 */
export function nextTheme(current: Theme): Theme {
  switch (current) {
    case 'light':
      return 'dark';
    case 'dark':
      return 'system';
    case 'system':
      return 'light';
  }
}

/**
 * Resolve a `Theme` to the actual class to apply on `<html>`. For
 * `'system'` the caller decides (it depends on a media-query that's
 * only available on the client). Returns `null` on `'system'` to
 * signal "leave it to the client effect".
 */
export function themeClass(theme: Theme): 'dark' | null {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return null;
  return null;
}
