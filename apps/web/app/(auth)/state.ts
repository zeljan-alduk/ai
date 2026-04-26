/**
 * Plain (non-server-action) module for the auth-form state shapes.
 *
 * Splitting these out of `actions.ts` is structural: a `'use server'`
 * file's exports are flattened to async-action references when
 * imported into a client component, which means a `const` like
 * `EMPTY_AUTH_STATE` arrives as `undefined`. Importing it from this
 * non-`'use server'` module preserves the value as expected by
 * `useActionState`'s `initialState` argument.
 */

export interface AuthFormState {
  /** Inline error message rendered above the submit button. */
  readonly error: string | null;
  /** Field-level errors keyed by form field name. */
  readonly fieldErrors: Readonly<Record<string, string>>;
}

export const EMPTY_AUTH_STATE: AuthFormState = { error: null, fieldErrors: {} };
