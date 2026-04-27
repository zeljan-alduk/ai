/**
 * Register every Zod schema from `@aldo-ai/api-contract` as a named
 * OpenAPI component. The registry uses these names when an operation
 * (in `./operations/*.ts`) references the schema, so the document
 * carries `$ref: "#/components/schemas/RunSummary"` instead of inlining
 * the same shape on every endpoint.
 *
 * This is the ONLY file that imports from `@aldo-ai/api-contract` in
 * bulk — operations import individual schemas directly so the call
 * site is self-documenting.
 *
 * Adding a schema to api-contract should add an entry here. The test
 * suite asserts that the registry covers every named schema export.
 */

import * as contract from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from './registry.js';

/** Schemas we DO NOT register (covered by primitives or never referenced). */
const SKIP = new Set<string>([
  // Wave-13 — `RunTreeNode` is the recursive variant; we register the
  // top-level wrapper `GetRunTreeResponse` which references it.
]);

/** Optional human-readable descriptions for components that don't carry one. */
const DESCRIPTIONS: Record<string, string> = {
  ApiError: 'Standard error envelope returned for any non-2xx response.',
  PaginatedMeta: 'Cursor-paginated list metadata.',
  PaginationQuery: 'Cursor + limit query parameters for paginated lists.',
  PrivacyTier:
    'Privacy tier enforced platform-side. `sensitive` agents may only reach local-only models.',
  RunStatus: 'Lifecycle state of a run.',
  RunSummary: 'Compact run record for list views.',
  RunDetail: 'Full run record (events + usage timeline).',
  RunEvent: 'A single timeline event in a run (message, tool call, etc.).',
  AgentSummary: 'Compact agent record for list views.',
  ListRunsResponse: 'Paginated list of runs.',
  ListAgentsResponse: 'Paginated list of agents.',
  CreateRunRequest: 'Body for `POST /v1/runs` — creates a new run.',
  CreateRunResponse: '`POST /v1/runs` response — the freshly-created run summary.',
};

/**
 * Register every exported Zod schema from `@aldo-ai/api-contract`. We
 * iterate the module's named exports and register anything that looks
 * like a Zod schema (has `_def.typeName`) — this keeps the registry in
 * lockstep with the contract package without manual upkeep per schema.
 */
export function registerContractSchemas(registry: OpenAPIRegistry): void {
  for (const [name, value] of Object.entries(contract)) {
    if (SKIP.has(name)) continue;
    if (value === null || typeof value !== 'object') continue;
    const def = (value as { _def?: { typeName?: string } })._def;
    if (def === undefined || typeof def.typeName !== 'string') continue;
    const description = DESCRIPTIONS[name];
    registry.register(
      name,
      value as Parameters<OpenAPIRegistry['register']>[1],
      description !== undefined ? { description } : {},
    );
  }
}

/** Names of all schemas we expect the registry to carry. Used by tests. */
export function expectedSchemaNames(): readonly string[] {
  const names: string[] = [];
  for (const [name, value] of Object.entries(contract)) {
    if (SKIP.has(name)) continue;
    if (value === null || typeof value !== 'object') continue;
    const def = (value as { _def?: { typeName?: string } })._def;
    if (def === undefined || typeof def.typeName !== 'string') continue;
    names.push(name);
  }
  return names;
}
