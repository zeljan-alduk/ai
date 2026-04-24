/**
 * Gateway-local errors. `NoEligibleModelError` is imported from `@meridian/types`
 * and re-exported so callers have a single import site.
 */

export { NoEligibleModelError } from '@meridian/types';

/** Thrown when a descriptor references a providerKind not in the adapter registry. */
export class UnknownProviderKindError extends Error {
  constructor(readonly providerKind: string) {
    super(`no adapter registered for providerKind="${providerKind}"`);
    this.name = 'UnknownProviderKindError';
  }
}

/** Thrown when a descriptor with a given id is already registered. */
export class DuplicateModelError extends Error {
  constructor(readonly modelId: string) {
    super(`model already registered: ${modelId}`);
    this.name = 'DuplicateModelError';
  }
}

/** Thrown when a caller asks for a budget check and the estimated cost exceeds it. */
export class BudgetExceededError extends Error {
  constructor(
    readonly modelId: string,
    readonly estimatedUsd: number,
    readonly usdMax: number,
  ) {
    super(
      `estimated cost ${estimatedUsd.toFixed(6)} USD exceeds budget ${usdMax.toFixed(6)} for ${modelId}`,
    );
    this.name = 'BudgetExceededError';
  }
}

/** Wrapper for provider-level transport failures. Adapters throw these. */
export class ProviderError extends Error {
  constructor(
    readonly providerKind: string,
    readonly modelId: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`[${providerKind}:${modelId}] ${message}`);
    this.name = 'ProviderError';
  }
}
