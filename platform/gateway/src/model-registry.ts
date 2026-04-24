import { readFileSync } from 'node:fs';
import type { ModelDescriptor } from '@meridian/types';
import YAML from 'yaml';
import { z } from 'zod';
import { DuplicateModelError } from './errors.js';
import type { ProviderKind } from './provider.js';

/**
 * Descriptor in the registry extends `ModelDescriptor` with a `providerKind`
 * tag that points at which adapter should serve it. This extra field lives
 * here (not in `@meridian/types`) because `providerKind` is a gateway
 * implementation concern, not a cross-package contract.
 */
export interface RegisteredModel extends ModelDescriptor {
  readonly providerKind: ProviderKind;
  /** Opaque per-model config for the adapter. */
  readonly providerConfig?: {
    readonly baseUrl?: string;
    readonly apiKeyEnv?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly extra?: Readonly<Record<string, unknown>>;
  };
}

export interface ModelRegistry {
  list(): readonly RegisteredModel[];
  get(id: string): RegisteredModel | undefined;
  register(model: RegisteredModel): void;
  remove(id: string): boolean;
  /** Replace the entire set of models. Used by loaders. */
  replaceAll(models: readonly RegisteredModel[]): void;
}

export function createModelRegistry(seed: readonly RegisteredModel[] = []): ModelRegistry {
  const byId = new Map<string, RegisteredModel>();
  for (const m of seed) {
    if (byId.has(m.id)) throw new DuplicateModelError(m.id);
    byId.set(m.id, m);
  }
  return {
    list: () => [...byId.values()],
    get: (id) => byId.get(id),
    register(model) {
      if (byId.has(model.id)) throw new DuplicateModelError(model.id);
      byId.set(model.id, model);
    },
    remove: (id) => byId.delete(id),
    replaceAll(models) {
      byId.clear();
      for (const m of models) {
        if (byId.has(m.id)) throw new DuplicateModelError(m.id);
        byId.set(m.id, m);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// YAML loader.

const ProviderPricingSchema = z.object({
  usdPerMtokIn: z.number().nonnegative(),
  usdPerMtokOut: z.number().nonnegative(),
  usdPerMtokCacheRead: z.number().nonnegative().optional(),
  usdPerMtokCacheWrite: z.number().nonnegative().optional(),
});

const RegisteredModelSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  providerKind: z.string().min(1),
  locality: z.enum(['cloud', 'on-prem', 'local']),
  provides: z.array(z.string()).readonly(),
  cost: ProviderPricingSchema,
  latencyP95Ms: z.number().int().positive().optional(),
  privacyAllowed: z.array(z.enum(['public', 'internal', 'sensitive'])).readonly(),
  capabilityClass: z.string().min(1),
  effectiveContextTokens: z.number().int().positive(),
  providerConfig: z
    .object({
      baseUrl: z.string().optional(),
      apiKeyEnv: z.string().optional(),
      headers: z.record(z.string()).optional(),
      extra: z.record(z.unknown()).optional(),
    })
    .optional(),
});

const ModelsFileSchema = z.object({
  apiVersion: z.literal('meridian/models.v1'),
  kind: z.literal('ModelCatalog'),
  models: z.array(RegisteredModelSchema),
});

export function parseModelsYaml(source: string): readonly RegisteredModel[] {
  const raw: unknown = YAML.parse(source);
  const parsed = ModelsFileSchema.parse(raw);
  // Zod gives us mutable arrays; cast to readonly shape matching RegisteredModel.
  return parsed.models as readonly RegisteredModel[];
}

export function loadModelsYaml(path: string): readonly RegisteredModel[] {
  return parseModelsYaml(readFileSync(path, 'utf8'));
}
