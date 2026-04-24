/**
 * Thin adapter over `@meridian/registry` so commands can depend on a stable
 * surface while the registry itself is still in flux.
 *
 * TODO: wire once registry ships a stable `index.ts` export. Today the
 * registry has no public barrel; we import the `validator` module directly
 * and fall back to a minimal stub if the import fails (e.g. during
 * single-binary compile before the workspace is wired).
 */

import type { ValidationResult } from '@meridian/types';

export interface RegistryLike {
  /** Validate YAML text. Returns a ValidationResult (see @meridian/types). */
  validate(yamlText: string): ValidationResult;
}

let cached: RegistryLike | null = null;

/**
 * Load the registry lazily. Kept async so we can swap in a dynamic import of a
 * not-yet-published module without changing the call sites.
 */
export async function getRegistry(): Promise<RegistryLike> {
  if (cached !== null) return cached;
  try {
    // TODO: swap to `@meridian/registry` root export once it exists.
    // The specifier is assembled at runtime so bundlers don't try to
    // statically resolve a path that isn't declared in the registry's
    // `package.json#exports`. This keeps the adapter honest about the
    // registry being in flux.
    const specifier = ['@meridian/registry', 'src', 'validator.js'].join('/');
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      validate: (yaml: string) => ValidationResult;
    };
    cached = { validate: mod.validate };
    return cached;
  } catch {
    // Fallback stub — keeps the CLI bootable even if the registry hasn't
    // been built yet. Tests inject their own via `setRegistry`.
    cached = {
      validate: (_yaml: string): ValidationResult => ({
        ok: false,
        errors: [
          {
            path: '$',
            message: 'registry not available — rebuild @meridian/registry or inject a RegistryLike',
          },
        ],
      }),
    };
    return cached;
  }
}

/** Test hook: swap in a fake registry. */
export function setRegistry(reg: RegistryLike | null): void {
  cached = reg;
}
