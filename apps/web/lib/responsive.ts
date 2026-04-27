/**
 * Wave-15E — pure breakpoint helpers + responsive layout decisions.
 *
 * The numbers mirror `tailwind.config.ts`'s `screens` map. We keep them
 * here in TS so unit tests + non-Tailwind code paths (e.g. the
 * sidebar-drawer state machine, the responsive-grid hook) can ask "is
 * this width below `lg:`?" without a DOM dependency.
 *
 * Nothing in this module is provider-specific; it's pure layout maths.
 */

export const BREAKPOINTS = {
  xs: 480,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/**
 * Resolve a numeric viewport width to the largest matching breakpoint
 * key. `undefined` for widths below `xs`. Boundary semantics: a width
 * of exactly 768 is `md`, 767 is `sm`. Mirrors Tailwind's `min-width`
 * media-query semantics.
 */
export function breakpointFor(width: number): Breakpoint | undefined {
  if (!Number.isFinite(width) || width < BREAKPOINTS.xs) return undefined;
  let best: Breakpoint | undefined;
  for (const key of Object.keys(BREAKPOINTS) as Breakpoint[]) {
    if (width >= BREAKPOINTS[key]) best = key;
  }
  return best;
}

/**
 * Returns true when the width is strictly below the named breakpoint.
 * Useful for "below `lg:` show the hamburger" decisions.
 */
export function isBelow(width: number, bp: Breakpoint): boolean {
  return width < BREAKPOINTS[bp];
}

/**
 * Decide which navigation surface to render.
 *   - Below `lg:` → mobile hamburger + Sheet drawer.
 *   - At `lg:` and up → docked aside sidebar.
 */
export function navSurfaceFor(width: number): 'drawer' | 'docked' {
  return isBelow(width, 'lg') ? 'drawer' : 'docked';
}

/**
 * Return the column count for a fluid responsive grid given the
 * desktop max columns (1..12). Used by widget grids that collapse
 * gracefully on narrow widths.
 *
 * Below `md:` we always return 1 (stacked). Between `md:` and `lg:`
 * we cap at 2. Above `lg:` we honour the desktop value.
 */
export function gridColumns(width: number, desktopColumns: number): number {
  const cols = Math.max(1, Math.min(12, Math.round(desktopColumns)));
  if (isBelow(width, 'md')) return 1;
  if (isBelow(width, 'lg')) return Math.min(2, cols);
  return cols;
}
