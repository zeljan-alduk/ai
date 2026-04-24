/**
 * AgentRegistry implementation.
 *
 * Combines the loader, validator, and in-memory storage. Implements the
 * `AgentRegistry` interface from `@meridian/types`.
 *
 * Resolution rules for `load(ref)`:
 *  - if `ref.version` is given, return exactly that version or throw,
 *  - otherwise return the currently-promoted version; if none is promoted
 *    but exactly one version exists, return it (bootstrap convenience);
 *  - otherwise throw `NoPromotedVersionError`.
 */

import type {
  AgentRef,
  AgentRegistry as AgentRegistryIface,
  AgentSpec,
  ValidationResult,
} from '@meridian/types';
import { loadFromFile, parseYaml } from './loader.js';
import { assertValid } from './semver.js';
import { AgentNotFoundError, InMemoryStorage, NoPromotedVersionError } from './storage.js';

export interface RegistryOptions {
  /** Promotion can be gated by the caller; registry stays mechanism-only. */
  // TODO(v1): wire an EvalReport type + gate check; for now evidence is accepted blind.
  readonly acceptEvidence?: (ref: Required<AgentRef>, evidence: unknown) => Promise<boolean>;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
}

export class AgentRegistry implements AgentRegistryIface {
  private readonly storage: InMemoryStorage;
  private readonly opts: RegistryOptions;

  constructor(opts: RegistryOptions = {}) {
    this.opts = opts;
    this.storage = new InMemoryStorage(opts.now);
  }

  /** Parse + register a YAML document. Returns the full validation result. */
  register(yamlText: string): ValidationResult {
    const res = parseYaml(yamlText);
    if (res.ok && res.spec !== undefined) {
      this.storage.put(res.spec);
    }
    return res;
  }

  /** Convenience: read from disk and register. Throws on invalid YAML. */
  async registerFromFile(path: string): Promise<AgentSpec> {
    const res = await loadFromFile(path);
    if (!res.ok) {
      throw new RegistryLoadError(path, res.errors);
    }
    this.storage.put(res.spec);
    return res.spec;
  }

  /** Directly register an already-parsed spec (bypasses YAML). */
  registerSpec(spec: AgentSpec): void {
    this.storage.put(spec);
  }

  // --- AgentRegistry interface ---------------------------------------------

  async load(ref: AgentRef): Promise<AgentSpec> {
    if (ref.version !== undefined) {
      return this.storage.getVersion(ref.name, ref.version).spec;
    }

    // No explicit version: prefer the promoted pointer.
    const promoted = this.storage.promotedVersion(ref.name);
    if (promoted !== null) {
      return this.storage.getVersion(ref.name, promoted).spec;
    }

    // Bootstrap convenience: if only one version exists, return it.
    const versions = this.storage.listVersions(ref.name);
    if (versions.length === 0) throw new AgentNotFoundError(ref.name);
    if (versions.length === 1) {
      const only = versions[0];
      if (only !== undefined) return this.storage.getVersion(ref.name, only).spec;
    }
    throw new NoPromotedVersionError(ref.name);
  }

  validate(yaml: string): ValidationResult {
    return parseYaml(yaml);
  }

  async list(filter?: Partial<Pick<AgentSpec['identity'], 'name' | 'owner'>>): Promise<AgentRef[]> {
    const out: AgentRef[] = [];
    for (const name of this.storage.listNames()) {
      if (filter?.name !== undefined && filter.name !== name) continue;
      for (const version of this.storage.listVersions(name)) {
        const spec = this.storage.getVersion(name, version).spec;
        if (filter?.owner !== undefined && filter.owner !== spec.identity.owner) continue;
        out.push({ name, version });
      }
    }
    return out;
  }

  async promote(ref: Required<AgentRef>, evidence: unknown): Promise<void> {
    assertValid(ref.version);
    if (this.opts.acceptEvidence !== undefined) {
      const ok = await this.opts.acceptEvidence(ref, evidence);
      if (!ok) throw new EvidenceRejectedError(ref);
    }
    this.storage.promote(ref.name, ref.version, evidence);
  }

  // --- introspection helpers (not in the interface, but useful) ------------

  listVersions(name: string): readonly string[] {
    return this.storage.listVersions(name);
  }

  promotedVersion(name: string): string | null {
    return this.storage.promotedVersion(name);
  }
}

export class RegistryLoadError extends Error {
  public readonly path: string;
  public readonly errors: readonly { readonly path: string; readonly message: string }[];
  constructor(
    path: string,
    errors: readonly { readonly path: string; readonly message: string }[],
  ) {
    super(
      `failed to load agent from ${path}: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
    this.name = 'RegistryLoadError';
    this.path = path;
    this.errors = errors;
  }
}

export class EvidenceRejectedError extends Error {
  public readonly ref: Required<AgentRef>;
  constructor(ref: Required<AgentRef>) {
    super(`evidence rejected for ${ref.name}@${ref.version}`);
    this.name = 'EvidenceRejectedError';
    this.ref = ref;
  }
}
