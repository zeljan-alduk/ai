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
  // MISSING_PIECES #9 — approval-gate wire shapes.
  PendingApprovalWire:
    'A pending approval surfaced when an iterative agent\'s tool call hits a `tools.approvals: always` rule. The engine pauses until the approver POSTs `/v1/runs/:id/approve` or `/reject`.',
  ListPendingApprovalsResponse:
    'Body of `GET /v1/runs/:id/approvals` — every pending approval for the run, in request order.',
  ApproveRunRequest:
    'Body for `POST /v1/runs/:id/approve` — resolves the pending approval keyed by `callId` as approved. Optional free-form `reason` for audit.',
  RejectRunRequest:
    'Body for `POST /v1/runs/:id/reject` — resolves the pending approval as rejected. `reason` is REQUIRED so operators justify the denial.',
  ApprovalDecisionResponse:
    'Response for both `/approve` and `/reject` — echoes the decision (approver, reason, at) so the caller can render the audit row.',
  // MISSING_PIECES §9 — iteration block on agent specs (additive).
  IterationWire:
    'Wave-Iter — leaf-loop iteration block on an agent spec. Distinct from `composite.iteration` (multi-agent supervisor); this one drives `IterativeAgentRun`.',
  IterationTerminationConditionWire:
    'Discriminated union of declarative termination matchers — text-includes | tool-result | budget-exhausted. The loop fires the FIRST match in spec order.',
  IterationSummaryStrategyWire:
    'rolling-window | periodic-summary — picks how `IterativeAgentRun` compresses history when token utilisation crosses 80% of `contextWindow`.',
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
