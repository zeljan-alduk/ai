/**
 * Runs operations — list, search, create, get, tree, bulk, debug,
 * compare. SSE event streams are documented as `text/event-stream`.
 */

import {
  ApprovalDecisionResponse,
  ApproveRunRequest,
  BulkRunActionRequest,
  BulkRunActionResponse,
  CreateRunRequest,
  CreateRunResponse,
  GetRunResponse,
  GetRunTreeResponse,
  ListPendingApprovalsResponse,
  ListRunsResponse,
  RejectRunRequest,
  RunCompareResponse,
  RunSearchRequest,
  RunSearchResponse,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import {
  Resp401,
  Resp404,
  Resp422,
  Resp422PrivacyTier,
  SECURITY_BOTH,
  jsonResponse,
  pathParam,
  queryParam,
} from './_shared.js';

export function registerRunOperations(reg: OpenAPIRegistry): void {
  reg.registerTag('Runs', 'Run lifecycle, search, comparison, and SSE event tail.');

  reg.registerPath({
    method: 'get',
    path: '/v1/runs',
    summary: 'List runs (paginated)',
    description:
      'Lists runs in reverse-chronological order. Filter by `agentName` and `status` via query params.',
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [
      queryParam('agentName', 'Filter by agent name.'),
      queryParam('status', 'Filter by lifecycle status.'),
      queryParam('cursor', 'Opaque pagination cursor from a previous response.'),
      queryParam('limit', 'Page size (1–200).', { type: 'integer', minimum: 1, maximum: 200 }),
    ],
    responses: { '200': jsonResponse('Runs page.', ListRunsResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/runs',
    summary: 'Create a new run',
    description:
      "Creates and queues a run for the specified agent. Returns 422 `privacy_tier_unroutable` BEFORE any provider contact if the agent's privacy tier cannot be satisfied by the live catalog.",
    tags: ['Runs'],
    security: SECURITY_BOTH,
    request: { required: true, content: { 'application/json': { schema: CreateRunRequest } } },
    responses: {
      '200': jsonResponse('Run created.', CreateRunResponse),
      '401': Resp401(),
      '422': Resp422PrivacyTier(),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/runs/search',
    summary: 'Full-text + faceted run search',
    description:
      'Searches runs by free-text + status[] + agent[] + cost / duration / time ranges. Cursor-paginated; returns total match count.',
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [
      queryParam(
        'q',
        'Free-text query (matches agent name, run id, error msg, tool args/results).',
      ),
      queryParam('status', 'Repeatable. Restrict to these lifecycle states.'),
      queryParam('agent', 'Repeatable. Restrict to these agent names.'),
      queryParam('cost_gte', 'Minimum total USD.', { type: 'number', minimum: 0 }),
      queryParam('cost_lte', 'Maximum total USD.', { type: 'number', minimum: 0 }),
      queryParam('limit', 'Page size (1–100).', { type: 'integer', minimum: 1, maximum: 100 }),
    ],
    responses: { '200': jsonResponse('Search results.', RunSearchResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/runs/bulk',
    summary: 'Bulk action on a list of runs',
    description:
      'Atomic batch action (archive / unarchive / add-tag / remove-tag) on up to 500 run ids.',
    tags: ['Runs'],
    security: SECURITY_BOTH,
    request: { required: true, content: { 'application/json': { schema: BulkRunActionRequest } } },
    responses: {
      '200': jsonResponse('Action applied.', BulkRunActionResponse),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/runs/compare',
    summary: 'Side-by-side diff of two runs',
    description:
      'Returns a structural diff (events, tool calls, usage) between two runs. Used by the runs diff viewer.',
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [
      queryParam('a', 'First run id.', { type: 'string' }, true),
      queryParam('b', 'Second run id.', { type: 'string' }, true),
    ],
    responses: {
      '200': jsonResponse('Diff payload.', RunCompareResponse),
      '401': Resp401(),
      '404': Resp404('Run'),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/runs/{id}',
    summary: 'Fetch a single run',
    description: 'Full run detail (events + usage + status). Used by the run detail page.',
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Run id.', '<run-id>')],
    responses: {
      '200': jsonResponse('Run detail.', GetRunResponse),
      '401': Resp401(),
      '404': Resp404('Run'),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/runs/{id}/tree',
    summary: 'Composite-run tree',
    description:
      'For composite (multi-agent) runs, returns the rooted tree of supervisor + subagent runs with per-node usage rollups.',
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Run id (parent or descendant).', '<run-id>')],
    responses: {
      '200': jsonResponse('Run tree.', GetRunTreeResponse),
      '401': Resp401(),
      '404': Resp404('Run'),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/runs/{id}/events',
    summary: 'Server-sent event stream of run timeline events',
    description:
      'Long-lived SSE stream. The server writes one `event: <type>` + `data: <json>` block per RunEvent. Disconnects close the stream.',
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Run id.', '<run-id>')],
    responses: {
      '200': {
        description: 'Server-sent event stream.',
        content: {
          'text/event-stream': {
            schema: { type: 'string', description: 'newline-delimited SSE frames' },
          },
        },
      },
      '401': Resp401(),
      '404': Resp404('Run'),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/runs/{id}/breakpoints',
    summary: 'List breakpoints attached to a run',
    description:
      'Returns the live breakpoint set for the in-flight or completed run. Used by the debugger panel.',
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Run id.', '<run-id>')],
    responses: {
      '200': jsonResponse('Breakpoint list.', {
        $ref: '#/components/schemas/ListBreakpointsResponse',
      }),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/runs/{id}/breakpoints',
    summary: 'Create a breakpoint on a run',
    description: 'Attaches a breakpoint that pauses the run when its trigger condition is met.',
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Run id.', '<run-id>')],
    request: {
      required: true,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/CreateBreakpointRequest' } },
      },
    },
    responses: {
      '200': jsonResponse('Breakpoint created.', { $ref: '#/components/schemas/Breakpoint' }),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/runs/{id}/breakpoints/{bp}',
    summary: 'Delete a breakpoint',
    description: 'Removes a breakpoint by id; idempotent.',
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [
      pathParam('id', 'Run id.', '<run-id>'),
      pathParam('bp', 'Breakpoint id.', '<bp-id>'),
    ],
    responses: { '204': { description: 'Deleted.' }, '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/runs/{id}/continue',
    summary: 'Resume a paused run',
    description:
      'Resumes execution past a breakpoint. Body carries an optional override for the next step.',
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Run id.', '<run-id>')],
    request: {
      required: true,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ContinueCommand' } },
      },
    },
    responses: { '200': jsonResponse('Resumed.', { type: 'object' }), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/runs/{id}/edit-and-resume',
    summary: 'Edit step inputs and resume',
    description:
      'Mutates the next-step inputs of a paused run and resumes. The original event is retained for replay.',
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Run id.', '<run-id>')],
    request: {
      required: true,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/EditAndResumeCommand' } },
      },
    },
    responses: { '200': jsonResponse('Resumed.', { type: 'object' }), '401': Resp401() },
  });

  // ─── MISSING_PIECES #9 — approval gates ────────────────────────────
  // Iterative agents with `tools.approvals: always` (or
  // `protected_paths`) suspend the loop on every gated tool call.
  // The three routes below let an out-of-band approver list pending
  // requests and resolve them.

  reg.registerPath({
    method: 'get',
    path: '/v1/runs/{id}/approvals',
    summary: 'List pending approvals for a run',
    description:
      "Lists every approval the engine is currently blocked on for this run. Empty when nothing is pending. The engine pauses the iterative loop on every tool call whose spec marks `tools.approvals: always`; an approver POSTs `/approve` or `/reject` (below) to resolve.",
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Run id.', '<run-id>')],
    responses: {
      '200': jsonResponse('Pending approvals (possibly empty).', ListPendingApprovalsResponse),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/runs/{id}/approve',
    summary: 'Approve a pending tool call',
    description:
      "Resolves a pending approval as approved. The engine resumes the loop and dispatches the tool. The decision is auditable — both `tool.pending_approval` and `tool.approval_resolved` events land on the run-event log. Returns 404 when no pending approval matches `(runId, callId)`; 503 when the runtime / approval controller isn't wired for this tenant (typically because no providers are enabled).",
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Run id.', '<run-id>')],
    request: { required: true, content: { 'application/json': { schema: ApproveRunRequest } } },
    responses: {
      '200': jsonResponse('Approval resolved.', ApprovalDecisionResponse),
      '401': Resp401(),
      '404': Resp404('approval'),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/runs/{id}/reject',
    summary: 'Reject a pending tool call',
    description:
      "Resolves a pending approval as rejected. The engine appends a synthetic `tool_result` payload of `{ rejected: true, reason, approver }` and resumes the loop — the agent observes the rejection and decides what to do next (no exception thrown). `reason` is REQUIRED so operators justify the denial.",
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Run id.', '<run-id>')],
    request: { required: true, content: { 'application/json': { schema: RejectRunRequest } } },
    responses: {
      '200': jsonResponse('Rejection resolved.', ApprovalDecisionResponse),
      '401': Resp401(),
      '404': Resp404('approval'),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/runs/{id}/swap-model',
    summary: 'Swap the model on the next step and resume',
    description:
      "Resumes a paused run with a different model selection. The replay path enforces the agent's privacy tier — a swap to a model that violates it is rejected with `privacy_tier_unroutable`.",
    tags: ['Runs'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Run id.', '<run-id>')],
    request: {
      required: true,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/SwapModelCommand' } },
      },
    },
    responses: {
      '200': jsonResponse('Swapped + resumed.', { type: 'object' }),
      '401': Resp401(),
      '422': Resp422PrivacyTier(),
    },
  });
}
