/**
 * Thin adapter over `@meridian/registry` so commands can depend on a stable
 * surface and tests can inject a mock via `setRegistry`.
 */

import { validate as registryValidate } from '@meridian/registry';
import type { ValidationResult } from '@meridian/types';

export interface RegistryLike {
  /** Validate YAML text. Returns a ValidationResult (see @meridian/types). */
  validate(yamlText: string): ValidationResult;
}

const defaultRegistry: RegistryLike = {
  validate: registryValidate,
};

let injected: RegistryLike | null = null;

export async function getRegistry(): Promise<RegistryLike> {
  return injected ?? defaultRegistry;
}

/** Test hook: swap in a fake registry. Pass `null` to restore the default. */
export function setRegistry(reg: RegistryLike | null): void {
  injected = reg;
}
