/**
 * Plain (non-server-action) module for the admin design-partners form
 * state. Kept out of `actions.ts` because non-async exports from a
 * `'use server'` module collapse to `undefined` at client-import time.
 */

export interface UpdateApplicationFormState {
  readonly error: string | null;
  /**
   * Stamp incremented on each successful save so the client island
   * can show a transient "saved" toast even when the underlying row
   * data didn't change. (`useActionState` re-renders only when the
   * returned object's identity changes.)
   */
  readonly savedAt: string | null;
}

export const EMPTY_UPDATE_STATE: UpdateApplicationFormState = {
  error: null,
  savedAt: null,
};
