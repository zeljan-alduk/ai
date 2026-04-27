/**
 * Plain (non-server-action) module for the design-partner form state.
 *
 * Kept out of `actions.ts` because non-async exports from a
 * `'use server'` module flatten to `undefined` in client components,
 * breaking `useActionState`'s initial-state contract.
 */

export interface DesignPartnerFormState {
  readonly error: string | null;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly successId: string | null;
}

export const EMPTY_DESIGN_PARTNER_STATE: DesignPartnerFormState = {
  error: null,
  fieldErrors: {},
  successId: null,
};
