/**
 * Tenant-scoped registered-agent store — the wave-10 successor to the
 * pre-9 `RegistryStorage` (which keyed by `name` only).
 *
 * Every method takes an explicit `tenantId` first argument; there is no
 * "default tenant" fallback at this layer. The route + bootloader are
 * responsible for resolving the request's tenant before reaching this
 * surface, and tenant isolation is the store's hard contract: no method
 * should ever return a row that belongs to a different tenant, and a
 * cross-tenant lookup must surface as "not found" — not as an error
 * carrying tenant metadata that could leak existence.
 *
 * The store persists the AUTHOR-SUPPLIED YAML alongside the parsed
 * `AgentSpec` so replays can re-validate against the original document.
 * The parsed spec is what the application uses at runtime; the YAML is
 * the audit-quality source of truth.
 *
 * LLM-agnostic: `AgentSpec` carries capability classes + privacy tier;
 * provider names never appear in this surface.
 */

import type { AgentSpec } from '@aldo-ai/types';

/** A single registered agent version belonging to a tenant. */
export interface RegisteredAgent {
  readonly tenantId: string;
  readonly name: string;
  readonly version: string;
  readonly spec: AgentSpec;
  /** The original YAML the operator authored. Returned verbatim. */
  readonly specYaml: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Tenant-scoped registered-agent store.
 *
 * `register` and `promote` together form the eval-promotion gate's
 * canonical write path: register a new version row, then bump the
 * pointer to it. The pointer table is an explicit row (one per
 * (tenant, name)) with a `current_version` column that may be NULL
 * (soft-delete). `list()` filters out tenants whose pointer is NULL.
 */
export interface RegisteredAgentStore {
  /**
   * List the CURRENT version of every agent registered to `tenantId`.
   * Soft-deleted agents (pointer.current_version = NULL) are omitted.
   */
  list(tenantId: string): Promise<readonly RegisteredAgent[]>;
  /** List every version of one agent, newest-stored first. */
  listAllVersions(tenantId: string, name: string): Promise<readonly RegisteredAgent[]>;
  /** Return the current version of `name`, or null when missing/soft-deleted. */
  get(tenantId: string, name: string): Promise<RegisteredAgent | null>;
  /** Return a specific (name, version) row, or null when missing. */
  getVersion(tenantId: string, name: string, version: string): Promise<RegisteredAgent | null>;
  /**
   * Insert (or update if (tenant, name, version) already exists) and
   * bump the pointer to the new version. Used by both first-register
   * and ordinary version bumps; the eval-promotion gate prefers the
   * separate `promote()` call to avoid auto-bumping a version that has
   * not passed its eval suites yet.
   *
   * Returns the row as persisted (with timestamps).
   */
  register(tenantId: string, spec: AgentSpec, specYaml: string): Promise<RegisteredAgent>;
  /**
   * Insert (or update) the version row WITHOUT bumping the pointer.
   * Used by the eval gate to stage a candidate version before deciding
   * whether to promote.
   */
  upsertVersion(tenantId: string, spec: AgentSpec, specYaml: string): Promise<RegisteredAgent>;
  /**
   * Bump the pointer to `version`. Throws when (tenant, name, version)
   * does not exist — never sets the pointer to a phantom version.
   */
  promote(tenantId: string, name: string, version: string): Promise<void>;
  /**
   * Soft-delete: sets `pointer.current_version = NULL` so list/get
   * surface the agent as missing while preserving the version history
   * (so audits can reconstruct what was running at any past point).
   * The eval gate prefers promotion to deletion; this is for explicit
   * operator action via the API.
   */
  delete(tenantId: string, name: string): Promise<void>;
}
