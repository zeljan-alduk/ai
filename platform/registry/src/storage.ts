/**
 * In-memory storage for agent specs.
 *
 * Responsibilities:
 *  - track multiple semver versions per agent name,
 *  - track the "promoted" version pointer per agent,
 *  - look up by (name, version) and by (name, latest-promoted).
 *
 * Backed by simple Maps; Postgres-backed storage lands in a later ADR.
 */
// TODO(v1): swap this for a Postgres-backed store (ADR pending).

import type { AgentSpec } from '@meridian/types';
import { assertValid, compare, latest } from './semver.js';

export interface StoredVersion {
  readonly spec: AgentSpec;
  /** ISO timestamp when this version was put into storage. */
  readonly storedAt: string;
  /** Opaque evidence payload attached at promotion time. */
  readonly promotionEvidence?: unknown;
}

export class AgentNotFoundError extends Error {
  public readonly agentName: string;
  public readonly agentVersion: string | undefined;
  constructor(agentName: string, agentVersion?: string) {
    super(
      agentVersion === undefined
        ? `agent "${agentName}" not found`
        : `agent "${agentName}@${agentVersion}" not found`,
    );
    this.name = 'AgentNotFoundError';
    this.agentName = agentName;
    this.agentVersion = agentVersion;
  }
}

export class NoPromotedVersionError extends Error {
  public readonly agentName: string;
  constructor(agentName: string) {
    super(`agent "${agentName}" has no promoted version`);
    this.name = 'NoPromotedVersionError';
    this.agentName = agentName;
  }
}

export class VersionMismatchError extends Error {
  public readonly agentName: string;
  constructor(agentName: string) {
    super(`spec identity.name does not match the key used to store it (${agentName})`);
    this.name = 'VersionMismatchError';
    this.agentName = agentName;
  }
}

/**
 * In-memory store. Not thread-safe across workers — fine for v0 (single
 * process). The public API throws typed errors and never returns `undefined`.
 */
export class InMemoryStorage {
  /** name -> (version -> stored) */
  private readonly byName = new Map<string, Map<string, StoredVersion>>();

  /** name -> promoted version */
  private readonly promoted = new Map<string, string>();

  /** now() is injectable for determinism in tests. */
  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Inserts or overwrites a (name, version) entry. Version must be valid semver. */
  put(spec: AgentSpec): void {
    const { name, version } = spec.identity;
    assertValid(version);
    let versions = this.byName.get(name);
    if (versions === undefined) {
      versions = new Map();
      this.byName.set(name, versions);
    }
    versions.set(version, { spec, storedAt: this.now().toISOString() });
  }

  has(name: string, version?: string): boolean {
    const versions = this.byName.get(name);
    if (versions === undefined) return false;
    if (version === undefined) return versions.size > 0;
    return versions.has(version);
  }

  /** Returns the stored record for a specific version. Throws if absent. */
  getVersion(name: string, version: string): StoredVersion {
    const rec = this.byName.get(name)?.get(version);
    if (rec === undefined) throw new AgentNotFoundError(name, version);
    return rec;
  }

  /** Returns the latest-promoted spec. Throws if none is promoted. */
  getPromoted(name: string): StoredVersion {
    const v = this.promoted.get(name);
    if (v === undefined) throw new NoPromotedVersionError(name);
    // invariant: promoted pointer always references a stored version.
    return this.getVersion(name, v);
  }

  /** Returns all versions for a name, sorted ascending. Empty array if unknown. */
  listVersions(name: string): readonly string[] {
    const versions = this.byName.get(name);
    if (versions === undefined) return [];
    return [...versions.keys()].sort(compare);
  }

  /** Returns all known agent names. */
  listNames(): readonly string[] {
    return [...this.byName.keys()].sort();
  }

  /** Returns the current promoted version for a name, or null. */
  promotedVersion(name: string): string | null {
    return this.promoted.get(name) ?? null;
  }

  /**
   * Flip the promoted pointer for `name` to `version`. `evidence` is stored
   * alongside the version so audits can see why a promotion happened. The
   * version must already be in storage.
   */
  promote(name: string, version: string, evidence: unknown): void {
    const versions = this.byName.get(name);
    const rec = versions?.get(version);
    if (versions === undefined || rec === undefined) {
      throw new AgentNotFoundError(name, version);
    }
    versions.set(version, { ...rec, promotionEvidence: evidence });
    this.promoted.set(name, version);
  }

  /** Returns the greatest semver stored for `name`, or null. */
  latestVersion(name: string): string | null {
    return latest(this.listVersions(name));
  }
}
