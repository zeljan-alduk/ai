/**
 * Wave-15E — pure state machine for the mobile sidebar drawer.
 *
 * The actual `useState` lives in `components/sidebar.tsx`; this module
 * encapsulates the transitions so they can be unit-tested without
 * mounting React. The shape matches the contract the component needs:
 *
 *   - open: did the user tap the hamburger?
 *   - lastPath: which route was active when we last opened/closed.
 *
 * Rules:
 *   1. `open()` from any state → `{ open: true, lastPath }`.
 *   2. `close()` from any state → `{ open: false, lastPath }`.
 *   3. `routeChanged(p)` while open AND `p !== lastPath` → close;
 *      otherwise pass through (so the user can navigate within an
 *      already-open drawer to discover sub-items).
 *   4. `viewportResized(w)` → if width crosses lg+ we force close
 *      (the docked sidebar takes over).
 */

import { isBelow } from './responsive';

export interface SidebarDrawerState {
  readonly open: boolean;
  readonly lastPath: string;
}

export function initialSidebarState(currentPath: string): SidebarDrawerState {
  return { open: false, lastPath: currentPath };
}

export function openDrawer(state: SidebarDrawerState): SidebarDrawerState {
  if (state.open) return state;
  return { ...state, open: true };
}

export function closeDrawer(state: SidebarDrawerState): SidebarDrawerState {
  if (!state.open) return state;
  return { ...state, open: false };
}

export function routeChanged(state: SidebarDrawerState, newPath: string): SidebarDrawerState {
  if (newPath === state.lastPath) return state;
  // Always sync lastPath; only auto-close if the drawer was open.
  return { open: false, lastPath: newPath };
}

export function viewportResized(state: SidebarDrawerState, width: number): SidebarDrawerState {
  // Above lg the docked sidebar is visible — the drawer must close.
  if (!isBelow(width, 'lg') && state.open) {
    return { ...state, open: false };
  }
  return state;
}
