import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec } from '../src/index.js';

const spec = buildOpenApiSpec({ version: '0.0.0-test' });

describe('runs operations', () => {
  it('GET /v1/runs is a list endpoint', () => {
    expect(spec.paths['/v1/runs']?.get).toBeDefined();
  });

  it('POST /v1/runs creates a run with privacy-tier 422', () => {
    const op = spec.paths['/v1/runs']?.post as
      | {
          responses: Record<
            string,
            { content?: Record<string, { example?: { error?: { code?: string } } }> }
          >;
        }
      | undefined;
    expect(op).toBeDefined();
    expect(op?.responses['422']?.content?.['application/json']?.example?.error?.code).toBe(
      'privacy_tier_unroutable',
    );
  });

  it('GET /v1/runs/search exists', () => {
    expect(spec.paths['/v1/runs/search']?.get).toBeDefined();
  });

  it('POST /v1/runs/bulk exists', () => {
    expect(spec.paths['/v1/runs/bulk']?.post).toBeDefined();
  });

  it('GET /v1/runs/{id} fetches one run', () => {
    expect(spec.paths['/v1/runs/{id}']?.get).toBeDefined();
  });

  it('GET /v1/runs/{id}/tree fetches the composite tree', () => {
    expect(spec.paths['/v1/runs/{id}/tree']?.get).toBeDefined();
  });

  it('GET /v1/runs/{id}/events streams via text/event-stream', () => {
    const op = spec.paths['/v1/runs/{id}/events']?.get as
      | { responses: Record<string, { content?: Record<string, unknown> }> }
      | undefined;
    expect(op?.responses['200']?.content?.['text/event-stream']).toBeDefined();
  });

  it('GET /v1/runs/compare diffs two runs', () => {
    expect(spec.paths['/v1/runs/compare']?.get).toBeDefined();
  });

  it('breakpoint endpoints exist', () => {
    expect(spec.paths['/v1/runs/{id}/breakpoints']?.get).toBeDefined();
    expect(spec.paths['/v1/runs/{id}/breakpoints']?.post).toBeDefined();
    expect(spec.paths['/v1/runs/{id}/breakpoints/{bp}']?.delete).toBeDefined();
  });

  it('debug commands exist', () => {
    expect(spec.paths['/v1/runs/{id}/continue']?.post).toBeDefined();
    expect(spec.paths['/v1/runs/{id}/edit-and-resume']?.post).toBeDefined();
    expect(spec.paths['/v1/runs/{id}/swap-model']?.post).toBeDefined();
  });

  // MISSING_PIECES #9 — approval-gate routes documented.
  it('GET /v1/runs/{id}/approvals lists pending approvals', () => {
    expect(spec.paths['/v1/runs/{id}/approvals']?.get).toBeDefined();
  });

  it('POST /v1/runs/{id}/approve carries the ApproveRunRequest body', () => {
    const op = spec.paths['/v1/runs/{id}/approve']?.post as
      | {
          requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
        }
      | undefined;
    expect(op).toBeDefined();
    const ref = op?.requestBody?.content?.['application/json']?.schema?.$ref;
    expect(ref).toContain('ApproveRunRequest');
  });

  it('POST /v1/runs/{id}/reject carries the RejectRunRequest body', () => {
    const op = spec.paths['/v1/runs/{id}/reject']?.post as
      | {
          requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
        }
      | undefined;
    expect(op).toBeDefined();
    const ref = op?.requestBody?.content?.['application/json']?.schema?.$ref;
    expect(ref).toContain('RejectRunRequest');
  });

  it('approval components are registered in the spec', () => {
    const schemas = (spec as { components?: { schemas?: Record<string, unknown> } }).components
      ?.schemas;
    expect(schemas?.PendingApprovalWire).toBeDefined();
    expect(schemas?.ListPendingApprovalsResponse).toBeDefined();
    expect(schemas?.ApproveRunRequest).toBeDefined();
    expect(schemas?.RejectRunRequest).toBeDefined();
    expect(schemas?.ApprovalDecisionResponse).toBeDefined();
  });

  it('IterationWire components are registered in the spec', () => {
    const schemas = (spec as { components?: { schemas?: Record<string, unknown> } }).components
      ?.schemas;
    expect(schemas?.IterationWire).toBeDefined();
    expect(schemas?.IterationTerminationConditionWire).toBeDefined();
    expect(schemas?.IterationSummaryStrategyWire).toBeDefined();
  });
});
