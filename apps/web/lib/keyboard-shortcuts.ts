/**
 * Global keyboard-shortcut router for the web app.
 *
 * Two surfaces care about it:
 *
 *   1. The Cmd-K / Ctrl-K palette opener (handled inside
 *      `components/command-palette.tsx` directly because it owns the
 *      open/close state and the listener has to share that closure).
 *   2. The g-prefix navigation chords ("g a" → /agents, etc.) plus
 *      single-key globals ("?" → shortcuts overlay, "/" → focus first
 *      search input). Lives in `components/keyboard-shortcuts-router.tsx`.
 *
 * This file factors the *pure* parts out: the chord-state machine and
 * the input-focus guard. Pure → unit-testable without jsdom. The
 * router component just wires DOM events into these helpers.
 */

/**
 * Minimal shape we duck-type against so the helper is unit-testable
 * without booting jsdom. Real DOM `Element`s satisfy this trivially.
 */
export interface TypingTargetShape {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  readonly getAttribute?: (name: string) => string | null;
}

/** Returns true when the event target is an editable surface. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const t = target as TypingTargetShape;
  // We require a tagName-bearing object so a bare {role:'combobox'}
  // POJO doesn't accidentally count as a typing surface.
  if (typeof t.tagName !== 'string') return false;
  const tag = t.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable === true) return true;
  // Radix popovers / cmdk's combobox often expose role="combobox" on a
  // wrapping div that hosts the live region; treat them as typing too
  // so chords don't accidentally fire while the user is in a search.
  const role = t.getAttribute ? t.getAttribute('role') : null;
  if (role === 'combobox' || role === 'searchbox' || role === 'textbox') return true;
  return false;
}

/**
 * Pure mapping of the supported g-prefix chords. Keep this list tight
 * — every entry shows up in the shortcuts overlay so the user can see
 * what's available.
 */
export const GO_SHORTCUTS: ReadonlyArray<{
  /** Second key after `g`. */
  readonly key: string;
  /** Pretty label for the overlay ("g a"). */
  readonly chord: string;
  /** Where the chord navigates. */
  readonly href: string;
  /** Human label ("Agents"). */
  readonly label: string;
}> = [
  { key: 'a', chord: 'g a', href: '/agents', label: 'Agents' },
  { key: 'r', chord: 'g r', href: '/runs', label: 'Runs' },
  { key: 'e', chord: 'g e', href: '/eval', label: 'Eval' },
  { key: 'p', chord: 'g p', href: '/projects', label: 'Projects' },
  { key: 'd', chord: 'g d', href: '/datasets', label: 'Datasets' },
  { key: 's', chord: 'g s', href: '/settings', label: 'Settings' },
  { key: 'h', chord: 'g h', href: '/', label: 'Home' },
];

/**
 * Static documentation rows shown in the `?` overlay. Includes the
 * non-g-prefix keys (Cmd-K, /, ?). Source of truth for what the help
 * surface lists.
 */
export interface ShortcutDoc {
  readonly chord: string;
  readonly description: string;
}

export const STATIC_SHORTCUT_DOCS: ReadonlyArray<ShortcutDoc> = [
  { chord: '⌘ K  /  Ctrl K', description: 'Open the command palette' },
  { chord: '/', description: 'Focus the search input on this page' },
  { chord: '?', description: 'Open this keyboard-shortcuts overlay' },
  { chord: 'Esc', description: 'Close any open palette / overlay' },
];

/**
 * Result of feeding one keypress into the chord state machine.
 *
 *   - `consumed: true, action: 'enter-chord'` — the press started a
 *     g-chord; the caller should suppress default + start its 1.5s
 *     timeout window.
 *   - `consumed: true, action: 'navigate', href`   — the press
 *     completed a g-chord; the caller should `router.push(href)`.
 *   - `consumed: false` — the press is irrelevant; the caller does
 *     nothing.
 */
export type ChordOutcome =
  | { consumed: false }
  | { consumed: true; action: 'enter-chord' }
  | { consumed: true; action: 'navigate'; href: string }
  | { consumed: true; action: 'reset' };

export interface ChordState {
  /** True while the user has just pressed `g` and we're waiting. */
  pending: boolean;
}

export const INITIAL_CHORD_STATE: ChordState = { pending: false };

/**
 * Feed a key into the chord state machine. Pure function (no DOM
 * access) so we can table-test it.
 *
 * The caller passes `isTyping = true` when the focus is on an input;
 * the machine refuses to start or advance a chord in that case.
 */
export function nextChord(
  state: ChordState,
  key: string,
  options: { readonly isTyping: boolean },
): { state: ChordState; outcome: ChordOutcome } {
  if (options.isTyping) {
    return { state: INITIAL_CHORD_STATE, outcome: { consumed: false } };
  }
  if (!state.pending) {
    if (key === 'g') {
      return { state: { pending: true }, outcome: { consumed: true, action: 'enter-chord' } };
    }
    return { state, outcome: { consumed: false } };
  }
  // We had a pending `g` — try to resolve the chord.
  const match = GO_SHORTCUTS.find((s) => s.key === key);
  if (match) {
    return {
      state: INITIAL_CHORD_STATE,
      outcome: { consumed: true, action: 'navigate', href: match.href },
    };
  }
  // Any other key cancels the chord without firing.
  return { state: INITIAL_CHORD_STATE, outcome: { consumed: true, action: 'reset' } };
}
