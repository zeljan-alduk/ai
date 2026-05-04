/**
 * MISSING_PIECES #9 — approval-gate unit + integration tests.
 *
 * Unit:
 *   - approvalPolicyFor resolves per-spec overrides correctly:
 *     bare names, server-prefixed names, defaults, protected_paths.
 *   - InMemoryApprovalController:
 *     · resolve() returns the decision and unblocks requestApproval()
 *     · resolve() throws ApprovalNotFoundError on unknown (run, call)
 *     · pending() filters by run id
 *     · AbortSignal cancels a pending request
 *
 * Integration:
 *   - IterativeAgentRun with `tools.approvals: { shell.exec: always }`
 *     emits `tool.pending_approval`, suspends, and on resolve resumes
 *     with the dispatched tool result (approve) or a synthetic
 *     rejection (reject).
 */

import type {
  AgentSpec,
  CompletionRequest,
  Delta,
  IterationSpec,
  ModelDescriptor,
  RunEvent,
  TenantId,
  ToolRef,
  UsageRecord,
} from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import {
  ApprovalNotFoundError,
  approvalPolicyFor,
  InMemoryApprovalController,
} from '../src/approval-controller.js';
import { PlatformRuntime } from '../src/runtime.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
} from './mocks/index.js';

// ─── unit: approvalPolicyFor ───────────────────────────────────────

describe('approvalPolicyFor', () => {
  function spec(overrides: Record<string, 'never' | 'always' | 'protected_paths'>): AgentSpec {
    return {
      tools: { approvals: overrides },
    } as unknown as AgentSpec;
  }

  it('returns "never" when the spec has no overrides', () => {
    expect(approvalPolicyFor({ tools: {} } as AgentSpec, 'shell.exec')).toBe('never');
    expect(approvalPolicyFor({} as AgentSpec, 'shell.exec')).toBe('never');
  });

  it('returns "always" for an exact match', () => {
    expect(approvalPolicyFor(spec({ 'shell.exec': 'always' }), 'shell.exec')).toBe('always');
  });

  it('matches the bare name even when the call uses a server-prefixed form', () => {
    expect(approvalPolicyFor(spec({ 'shell.exec': 'always' }), 'aldo-shell.shell.exec')).toBe(
      'always',
    );
  });

  it('matches the server-prefixed name even when the call uses the bare form', () => {
    // Operator wrote the prefixed key; engine sees the prefixed call → match.
    expect(
      approvalPolicyFor(spec({ 'aldo-shell.shell.exec': 'always' }), 'aldo-shell.shell.exec'),
    ).toBe('always');
  });

  it('"protected_paths" collapses to "always" in v0', () => {
    expect(approvalPolicyFor(spec({ 'fs.write': 'protected_paths' }), 'fs.write')).toBe('always');
  });

  it('"never" is preserved (operator can opt OUT of a future global default)', () => {
    expect(approvalPolicyFor(spec({ 'shell.exec': 'never' }), 'shell.exec')).toBe('never');
  });
});

// ─── unit: InMemoryApprovalController ───────────────────────────────

describe('InMemoryApprovalController', () => {
  it('resolve() unblocks a pending requestApproval and returns the same decision', async () => {
    const ctrl = new InMemoryApprovalController();
    const p = ctrl.requestApproval({
      runId: 'r1',
      callId: 'c1',
      tool: 'shell.exec',
      args: { cmd: 'echo hi' },
      reason: null,
    });
    // Wait a tick so the request lands in the waiters map.
    await new Promise((r) => setImmediate(r));
    expect(ctrl.pending('r1')).toHaveLength(1);
    const decision = ctrl.resolve('r1', 'c1', { kind: 'approved', approver: 'aldo' });
    expect(decision.kind).toBe('approved');
    expect(decision.approver).toBe('aldo');
    const observed = await p;
    expect(observed.kind).toBe('approved');
    expect(observed.approver).toBe('aldo');
    expect(observed.at).toBe(decision.at);
    expect(ctrl.pending('r1')).toHaveLength(0);
  });

  it('resolve() throws ApprovalNotFoundError on an unknown (runId, callId)', () => {
    const ctrl = new InMemoryApprovalController();
    expect(() =>
      ctrl.resolve('r1', 'c1', { kind: 'rejected', approver: 'aldo', reason: 'no' }),
    ).toThrow(ApprovalNotFoundError);
  });

  it('reject decision flows through with reason intact', async () => {
    const ctrl = new InMemoryApprovalController();
    const p = ctrl.requestApproval({
      runId: 'r2',
      callId: 'c2',
      tool: 'shell.exec',
      args: {},
      reason: 'agent wants to delete /etc',
    });
    await new Promise((r) => setImmediate(r));
    ctrl.resolve('r2', 'c2', { kind: 'rejected', approver: 'aldo', reason: 'too risky' });
    const d = await p;
    expect(d.kind).toBe('rejected');
    if (d.kind === 'rejected') {
      expect(d.reason).toBe('too risky');
    }
  });

  it('pending() filters by runId', async () => {
    const ctrl = new InMemoryApprovalController();
    void ctrl.requestApproval({ runId: 'r1', callId: 'a', tool: 't', args: {}, reason: null });
    void ctrl.requestApproval({ runId: 'r2', callId: 'b', tool: 't', args: {}, reason: null });
    await new Promise((r) => setImmediate(r));
    expect(ctrl.pending('r1').map((p) => p.callId)).toEqual(['a']);
    expect(ctrl.pending('r2').map((p) => p.callId)).toEqual(['b']);
    expect(ctrl.pending()).toHaveLength(2);
  });

  it('AbortSignal cancels a pending request', async () => {
    const ctrl = new InMemoryApprovalController();
    const ac = new AbortController();
    const p = ctrl.requestApproval(
      { runId: 'r1', callId: 'c1', tool: 't', args: {}, reason: null },
      ac.signal,
    );
    await new Promise((r) => setImmediate(r));
    ac.abort();
    await expect(p).rejects.toThrow(/cancelled/i);
    expect(ctrl.pending('r1')).toHaveLength(0);
  });
});

// ─── integration: IterativeAgentRun + ApprovalController ───────────

const MODEL_DESC: ModelDescriptor = {
  id: 'mock',
  provider: 'mock',
  locality: 'local',
  provides: [],
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  privacyAllowed: ['public', 'internal', 'sensitive'],
  capabilityClass: 'reasoning-medium',
  effectiveContextTokens: 8192,
};

const usage = (over: Partial<UsageRecord> = {}): UsageRecord => ({
  provider: 'mock',
  model: 'mock-1',
  tokensIn: 10,
  tokensOut: 5,
  usd: 0,
  at: '2026-05-04T00:00:00Z',
  ...over,
});

function deltaWithToolCall(tool: string, callId: string, args: unknown = {}): Delta[] {
  return [
    { toolCall: { type: 'tool_call', tool, callId, args } },
    { end: { finishReason: 'tool_use', usage: usage(), model: MODEL_DESC } },
  ];
}

function deltaWithText(text: string): Delta[] {
  return [
    { textDelta: text },
    { end: { finishReason: 'stop', usage: usage(), model: MODEL_DESC } },
  ];
}

const ITERATION_BASE: IterationSpec = {
  maxCycles: 5,
  contextWindow: 16000,
  summaryStrategy: 'rolling-window',
  terminationConditions: [{ kind: 'text-includes', text: 'DONE' }],
};

describe('IterativeAgentRun — approval gate integration', () => {
  it('approves a gated tool call, then dispatches and continues the loop', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'gated',
        iteration: ITERATION_BASE,
        tools: {
          mcp: [{ server: 'aldo-shell', allow: ['shell.exec'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
          approvals: { 'shell.exec': 'always' },
        },
      }),
    );

    let call = 0;
    const gateway = new MockGateway(() => {
      call += 1;
      if (call === 1)
        return deltaWithToolCall('aldo-shell.shell.exec', 'c1', { cmd: 'echo hello' });
      return deltaWithText('DONE');
    });
    const toolHost = new MockToolHost(() => ({ exitCode: 0, stdout: 'hello' }));

    const approvalController = new InMemoryApprovalController();
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: 'tenant-app' as TenantId,
      approvalController,
    });

    // Approve as soon as the request appears.
    const approverP = (async () => {
      for (let i = 0; i < 50; i += 1) {
        const pending = approvalController.pending();
        if (pending.length > 0) {
          approvalController.resolve(pending[0]!.runId, pending[0]!.callId, {
            kind: 'approved',
            approver: 'test-approver',
          });
          return;
        }
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error('no approval request appeared within 250ms');
    })();

    const run = await rt.runAgent({ name: 'gated' }, 'go');
    const events: RunEvent[] = [];
    for await (const e of run.events()) events.push(e);
    // @ts-expect-error wait is on InternalAgentRun
    const r = await run.wait();
    await approverP;

    expect(r.ok).toBe(true);
    const pending = events.find((e) => e.type === 'tool.pending_approval');
    expect(pending).toBeDefined();
    expect((pending?.payload as { tool: string }).tool).toBe('aldo-shell.shell.exec');
    const resolved = events.find((e) => e.type === 'tool.approval_resolved');
    expect((resolved?.payload as { kind: string }).kind).toBe('approved');
    // The tool DID dispatch (tool host returned exitCode:0).
    const result = events.find((e) => e.type === 'tool_result');
    expect(
      (result?.payload as { result: { exitCode?: number } }).result.exitCode,
    ).toBe(0);
  });

  it('rejecting a gated tool call synthesizes a rejection tool_result; loop continues with isError', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'gated2',
        iteration: { ...ITERATION_BASE, maxCycles: 3, terminationConditions: [] },
        tools: {
          mcp: [{ server: 'aldo-shell', allow: ['shell.exec'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
          approvals: { 'shell.exec': 'always' },
        },
      }),
    );
    let call = 0;
    const gateway = new MockGateway(() => {
      call += 1;
      if (call === 1)
        return deltaWithToolCall('aldo-shell.shell.exec', 'c1', {
          cmd: 'rm -rf /etc',
          reason: 'I want to clean up',
        });
      return deltaWithText('giving up');
    });

    let toolDispatched = false;
    const toolHost = new MockToolHost(() => {
      toolDispatched = true;
      return { unreachable: true };
    });

    const approvalController = new InMemoryApprovalController();
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: 'tenant-app' as TenantId,
      approvalController,
    });

    const rejecterP = (async () => {
      for (let i = 0; i < 50; i += 1) {
        const pending = approvalController.pending();
        if (pending.length > 0) {
          approvalController.resolve(pending[0]!.runId, pending[0]!.callId, {
            kind: 'rejected',
            approver: 'test-approver',
            reason: 'absolutely not',
          });
          return;
        }
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error('no approval request appeared within 250ms');
    })();

    const run = await rt.runAgent({ name: 'gated2' }, 'go');
    const events: RunEvent[] = [];
    for await (const e of run.events()) events.push(e);
    // @ts-expect-error wait is on InternalAgentRun
    await run.wait();
    await rejecterP;

    expect(toolDispatched).toBe(false);
    const resolved = events.find((e) => e.type === 'tool.approval_resolved');
    expect((resolved?.payload as { kind: string }).kind).toBe('rejected');
    // The synthesised tool_result carries `rejected: true` + isError.
    const result = events.find((e) => e.type === 'tool_result');
    expect((result?.payload as { isError: boolean }).isError).toBe(true);
    expect(
      (result?.payload as { result: { rejected?: boolean; reason?: string } }).result.rejected,
    ).toBe(true);
    expect(
      (result?.payload as { result: { rejected?: boolean; reason?: string } }).result.reason,
    ).toBe('absolutely not');
    // Surfaced reason from args is on the pending event.
    const pending = events.find((e) => e.type === 'tool.pending_approval');
    expect((pending?.payload as { reason: string }).reason).toBe('I want to clean up');
  });

  it('iterative run with NO approvals declared runs unchanged (regression check)', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'unchanged',
        iteration: {
          ...ITERATION_BASE,
          terminationConditions: [{ kind: 'text-includes', text: 'OK' }],
        },
      }),
    );
    const gateway = new MockGateway(() => deltaWithText('OK'));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: 'tenant-app' as TenantId,
      approvalController: new InMemoryApprovalController(),
    });
    const run = await rt.runAgent({ name: 'unchanged' }, 'go');
    const events: RunEvent[] = [];
    for await (const e of run.events()) events.push(e);
    // @ts-expect-error wait is on InternalAgentRun
    const r = await run.wait();
    expect(r.ok).toBe(true);
    expect(events.find((e) => e.type === 'tool.pending_approval')).toBeUndefined();
  });

  it('runtime without approvalController fails-closed: gated tool call gets a synthetic rejection', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'no-controller',
        iteration: { ...ITERATION_BASE, maxCycles: 2, terminationConditions: [] },
        tools: {
          mcp: [{ server: 'aldo-shell', allow: ['shell.exec'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
          approvals: { 'shell.exec': 'always' },
        },
      }),
    );
    let call = 0;
    const gateway = new MockGateway(() => {
      call += 1;
      if (call === 1) return deltaWithToolCall('aldo-shell.shell.exec', 'c1');
      return deltaWithText('never reaches here');
    });
    let toolDispatched = false;
    const toolHost = new MockToolHost(() => {
      toolDispatched = true;
      return {};
    });
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: 'tenant-app' as TenantId,
      // NO approvalController.
    });
    const run = await rt.runAgent({ name: 'no-controller' }, 'go');
    const events: RunEvent[] = [];
    for await (const e of run.events()) events.push(e);
    // @ts-expect-error wait is on InternalAgentRun
    await run.wait();
    expect(toolDispatched).toBe(false);
    const result = events.find((e) => e.type === 'tool_result');
    expect((result?.payload as { isError: boolean }).isError).toBe(true);
    expect(
      (result?.payload as { result: { reason?: string } }).result.reason,
    ).toContain('no approval controller');
  });
});
