/**
 * In-memory `RegisteredAgentStore`.
 *
 * Used by tests and CLI-mode bootstrap. Holds rows in nested Maps keyed
 * by `(tenantId -> name -> version -> RegisteredAgent)` so cross-tenant
 * leakage is impossible by construction: `list(tenantId)` only ever
 * walks one outer-key bucket.
 *
 * Pointer state lives in a parallel `(tenantId -> name -> version|null)`
 * Map. When `current_version === null` the row is soft-deleted and the
 * agent is filtered out of `list()` and `get()`.
 */

import type { AgentSpec } from '@aldo-ai/types';
import type { RegisteredAgent, RegisteredAgentStore } from './types.js';

interface VersionRecord {
  readonly spec: AgentSpec;
  readonly specYaml: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class InMemoryRegisteredAgentStore implements RegisteredAgentStore {
  /** tenantId -> name -> version -> record */
  private readonly rows = new Map<string, Map<string, Map<string, VersionRecord>>>();
  /** tenantId -> name -> current_version | null */
  private readonly pointers = new Map<string, Map<string, string | null>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async list(tenantId: string): Promise<readonly RegisteredAgent[]> {
    const tenantPtrs = this.pointers.get(tenantId);
    if (tenantPtrs === undefined) return [];
    const out: RegisteredAgent[] = [];
    // Sort lexicographically so the order is deterministic across boots.
    const names = [...tenantPtrs.keys()].sort();
    for (const name of names) {
      const v = tenantPtrs.get(name);
      if (v === null || v === undefined) continue;
      const rec = this.rows.get(tenantId)?.get(name)?.get(v);
      if (rec === undefined) continue;
      out.push(toRegisteredAgent(tenantId, name, v, rec));
    }
    return out;
  }

  async listAllVersions(tenantId: string, name: string): Promise<readonly RegisteredAgent[]> {
    const versions = this.rows.get(tenantId)?.get(name);
    if (versions === undefined) return [];
    // Newest-stored first (by createdAt then version for determinism).
    const out: RegisteredAgent[] = [];
    for (const [version, rec] of versions.entries()) {
      out.push(toRegisteredAgent(tenantId, name, version, rec));
    }
    out.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
      return a.version < b.version ? 1 : -1;
    });
    return out;
  }

  async get(tenantId: string, name: string): Promise<RegisteredAgent | null> {
    const v = this.pointers.get(tenantId)?.get(name);
    if (v === null || v === undefined) return null;
    const rec = this.rows.get(tenantId)?.get(name)?.get(v);
    if (rec === undefined) return null;
    return toRegisteredAgent(tenantId, name, v, rec);
  }

  async getVersion(
    tenantId: string,
    name: string,
    version: string,
  ): Promise<RegisteredAgent | null> {
    const rec = this.rows.get(tenantId)?.get(name)?.get(version);
    if (rec === undefined) return null;
    return toRegisteredAgent(tenantId, name, version, rec);
  }

  async register(tenantId: string, spec: AgentSpec, specYaml: string): Promise<RegisteredAgent> {
    const rec = this.upsertVersionSync(tenantId, spec, specYaml);
    this.setPointer(tenantId, spec.identity.name, spec.identity.version);
    return toRegisteredAgent(tenantId, spec.identity.name, spec.identity.version, rec);
  }

  async upsertVersion(
    tenantId: string,
    spec: AgentSpec,
    specYaml: string,
  ): Promise<RegisteredAgent> {
    const rec = this.upsertVersionSync(tenantId, spec, specYaml);
    return toRegisteredAgent(tenantId, spec.identity.name, spec.identity.version, rec);
  }

  async promote(tenantId: string, name: string, version: string): Promise<void> {
    const rec = this.rows.get(tenantId)?.get(name)?.get(version);
    if (rec === undefined) {
      throw new RegisteredAgentNotFoundError(tenantId, name, version);
    }
    this.setPointer(tenantId, name, version);
  }

  async delete(tenantId: string, name: string): Promise<void> {
    const tenantPtrs = this.pointers.get(tenantId);
    if (tenantPtrs === undefined) return;
    if (!tenantPtrs.has(name)) return;
    tenantPtrs.set(name, null);
  }

  // --- internals ----------------------------------------------------------

  private upsertVersionSync(tenantId: string, spec: AgentSpec, specYaml: string): VersionRecord {
    const { name, version } = spec.identity;
    let tenantRows = this.rows.get(tenantId);
    if (tenantRows === undefined) {
      tenantRows = new Map();
      this.rows.set(tenantId, tenantRows);
    }
    let nameRows = tenantRows.get(name);
    if (nameRows === undefined) {
      nameRows = new Map();
      tenantRows.set(name, nameRows);
    }
    const nowIso = this.now().toISOString();
    const existing = nameRows.get(version);
    const rec: VersionRecord = {
      spec,
      specYaml,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    nameRows.set(version, rec);
    return rec;
  }

  private setPointer(tenantId: string, name: string, version: string): void {
    let tenantPtrs = this.pointers.get(tenantId);
    if (tenantPtrs === undefined) {
      tenantPtrs = new Map();
      this.pointers.set(tenantId, tenantPtrs);
    }
    tenantPtrs.set(name, version);
  }
}

function toRegisteredAgent(
  tenantId: string,
  name: string,
  version: string,
  rec: VersionRecord,
): RegisteredAgent {
  return {
    tenantId,
    name,
    version,
    spec: rec.spec,
    specYaml: rec.specYaml,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

/**
 * Thrown when `promote()` is called on a (tenant, name, version) that
 * was never persisted. We deliberately do NOT distinguish "tenant
 * doesn't exist" from "version doesn't exist" so the error never leaks
 * existence across tenants.
 */
export class RegisteredAgentNotFoundError extends Error {
  public readonly tenantId: string;
  public readonly agentName: string;
  public readonly agentVersion: string | undefined;

  constructor(tenantId: string, name: string, version?: string) {
    super(
      version === undefined
        ? `agent "${name}" not found in tenant`
        : `agent "${name}@${version}" not found in tenant`,
    );
    this.name = 'RegisteredAgentNotFoundError';
    this.tenantId = tenantId;
    this.agentName = name;
    this.agentVersion = version;
  }
}
