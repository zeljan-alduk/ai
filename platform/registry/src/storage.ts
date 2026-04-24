/**
 * Agent-spec storage backends.
 *
 * Two implementations live behind a common async `RegistryStorage`
 * interface:
 *   - `InMemoryStorage` — Maps; the default for tests + single-process
 *     bootstrap.
 *   - `PostgresStorage` — durable; defined in `./postgres.ts` so this
 *     module never imports the SQL driver.
 *
 * Responsibilities:
 *  - track multiple semver versions per agent name,
 *  - track the "promoted" version pointer per agent,
 *  - look up by (name, version) and by (name, latest-promoted).
 */

import type { AgentSpec } from '@aldo-ai/types';
import { assertValid, compare, latest } from './semver.js';

export interface StoredVersion {
  readonly spec: AgentSpec;
  /** ISO timestamp when this version was put into storage. */
  readonly storedAt: string;
  /** Opaque evidence payload attached at promotion time. */
  readonly promotionEvidence?: unknown;
}

/**
 * Shared async surface for storage backends. The registry only ever
 * touches storage through this interface, so swapping in-memory <->
 * Postgres is a one-line wiring change.
 */
export interface RegistryStorage {
  put(spec: AgentSpec): Promise<void>;
  has(name: string, version?: string): Promise<boolean>;
  getVersion(name: string, version: string): Promise<StoredVersion>;
  getPromoted(name: string): Promise<StoredVersion>;
  listVersions(name: string): Promise<readonly string[]>;
  listNames(): Promise<readonly string[]>;
  promotedVersion(name: string): Promise<string | null>;
  promote(name: string, version: string, evidence: unknown): Promise<void>;
  latestVersion(name: string): Promise<string | null>;
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
 * In-memory store. Not thread-safe across workers — fine for tests and
 * single-process bootstrap. Methods are exposed in two flavours: the
 * legacy sync surface (`putSync`, `getVersionSync`, …) that early callers
 * rely on, and the async `RegistryStorage` interface used by the
 * registry. The async wrappers just resolve immediately.
 */
export class InMemoryStorage implements RegistryStorage {
  /** name -> (version -> stored) */
  private readonly byName = new Map<string, Map<string, StoredVersion>>();

  /** name -> promoted version */
  private readonly promoted = new Map<string, string>();

  /** now() is injectable for determinism in tests. */
  constructor(private readonly now: () => Date = () => new Date()) {}

  // --- sync surface (preserved for backward compatibility) ----------------

  putSync(spec: AgentSpec): void {
    const { name, version } = spec.identity;
    assertValid(version);
    let versions = this.byName.get(name);
    if (versions === undefined) {
      versions = new Map();
      this.byName.set(name, versions);
    }
    versions.set(version, { spec, storedAt: this.now().toISOString() });
  }

  hasSync(name: string, version?: string): boolean {
    const versions = this.byName.get(name);
    if (versions === undefined) return false;
    if (version === undefined) return versions.size > 0;
    return versions.has(version);
  }

  getVersionSync(name: string, version: string): StoredVersion {
    const rec = this.byName.get(name)?.get(version);
    if (rec === undefined) throw new AgentNotFoundError(name, version);
    return rec;
  }

  getPromotedSync(name: string): StoredVersion {
    const v = this.promoted.get(name);
    if (v === undefined) throw new NoPromotedVersionError(name);
    return this.getVersionSync(name, v);
  }

  listVersionsSync(name: string): readonly string[] {
    const versions = this.byName.get(name);
    if (versions === undefined) return [];
    return [...versions.keys()].sort(compare);
  }

  listNamesSync(): readonly string[] {
    return [...this.byName.keys()].sort();
  }

  promotedVersionSync(name: string): string | null {
    return this.promoted.get(name) ?? null;
  }

  promoteSync(name: string, version: string, evidence: unknown): void {
    const versions = this.byName.get(name);
    const rec = versions?.get(version);
    if (versions === undefined || rec === undefined) {
      throw new AgentNotFoundError(name, version);
    }
    versions.set(version, { ...rec, promotionEvidence: evidence });
    this.promoted.set(name, version);
  }

  latestVersionSync(name: string): string | null {
    return latest(this.listVersionsSync(name));
  }

  // --- async surface (RegistryStorage) ------------------------------------

  async put(spec: AgentSpec): Promise<void> {
    this.putSync(spec);
  }
  async has(name: string, version?: string): Promise<boolean> {
    return this.hasSync(name, version);
  }
  async getVersion(name: string, version: string): Promise<StoredVersion> {
    return this.getVersionSync(name, version);
  }
  async getPromoted(name: string): Promise<StoredVersion> {
    return this.getPromotedSync(name);
  }
  async listVersions(name: string): Promise<readonly string[]> {
    return this.listVersionsSync(name);
  }
  async listNames(): Promise<readonly string[]> {
    return this.listNamesSync();
  }
  async promotedVersion(name: string): Promise<string | null> {
    return this.promotedVersionSync(name);
  }
  async promote(name: string, version: string, evidence: unknown): Promise<void> {
    this.promoteSync(name, version, evidence);
  }
  async latestVersion(name: string): Promise<string | null> {
    return this.latestVersionSync(name);
  }
}
