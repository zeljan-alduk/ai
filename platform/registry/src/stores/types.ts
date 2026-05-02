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
  /**
   * Wave-17 project scoping. Nullable on the wire so pre-retrofit
   * clients (and any in-flight insert from a code path that predates
   * migration 020) round-trip cleanly. Application logic resolves a
   * missing value to the tenant's Default project at write time; the
   * field is therefore in practice always non-null on rows the new
   * write paths produced.
   */
  readonly projectId: string | null;
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
/**
 * Wave-17 — optional project scoping for write paths.
 *
 * `register` / `upsertVersion` accept an optional `projectId`; the API
 * route resolves it from the request (explicit body field or the
 * tenant's Default project) before calling the store. The store
 * persists whatever value it is handed and does NOT attempt to fall
 * back to a default — that resolution is a tenant-aware concern that
 * lives in the application layer (see apps/api/src/projects-store.ts
 * `getDefaultProjectIdForTenant`). When `projectId` is omitted the
 * store inserts SQL NULL; the wave-17 backfill (migration 020) is the
 * only way a NULL row should ever surface in production.
 */
export interface RegisterOptions {
  /** Optional project id. Null/undefined → SQL NULL. */
  readonly projectId?: string | null;
}

/** Filter options for `list()`. */
export interface ListOptions {
  /**
   * When set, restrict the result to agents whose `project_id` equals
   * the given id. When unset, list every agent in the tenant
   * (preserves the pre-wave-17 behaviour so pre-picker clients still
   * work without code changes).
   */
  readonly projectId?: string;
}

export interface RegisteredAgentStore {
  /**
   * List the CURRENT version of every agent registered to `tenantId`.
   * Soft-deleted agents (pointer.current_version = NULL) are omitted.
   * When `opts.projectId` is set, the result is further restricted to
   * that project's agents only — a missing `opts` argument keeps the
   * pre-wave-17 "all agents in tenant" behaviour.
   */
  list(tenantId: string, opts?: ListOptions): Promise<readonly RegisteredAgent[]>;
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
  register(
    tenantId: string,
    spec: AgentSpec,
    specYaml: string,
    opts?: RegisterOptions,
  ): Promise<RegisteredAgent>;
  /**
   * Insert (or update) the version row WITHOUT bumping the pointer.
   * Used by the eval gate to stage a candidate version before deciding
   * whether to promote.
   */
  upsertVersion(
    tenantId: string,
    spec: AgentSpec,
    specYaml: string,
    opts?: RegisterOptions,
  ): Promise<RegisteredAgent>;
  /**
   * Wave-17 — move every version of `name` (within `tenantId`) to a
   * different project. Used by the `/v1/agents/:name` PATCH path so an
   * operator can re-home an agent without re-registering it. No-op if
   * the row doesn't exist; the route checks existence beforehand and
   * returns 404.
   */
  moveToProject(tenantId: string, name: string, projectId: string): Promise<void>;
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
