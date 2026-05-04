/**
 * MISSING_PIECES §9 / Phase A+B — runtime selector for iterative leaf agents.
 *
 * Phase A introduced the dispatch + a typed sentinel; Phase B replaced
 * the sentinel with a real `IterativeAgentRun`. This test now asserts
 * the runtime constructs the iterative loop for a spec carrying an
 * `iteration` block AND that pre-§9 leaf specs still flow through
 * `LeafAgentRun` unchanged. The deeper loop semantics (cycles,
 * termination conditions, parallel tools) are exercised in
 * `iterative-run.test.ts`.
 */

import type { AgentRef, IterationSpec, TenantId } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { PlatformRuntime } from '../src/runtime.js';
import { IterativeAgentRun } from '../src/iterative-run.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
  textCompletion,
} from './mocks/index.js';

const TENANT = 'tenant-it' as TenantId;

const ITERATION: IterationSpec = {
  maxCycles: 5,
  contextWindow: 16000,
  summaryStrategy: 'rolling-window',
  terminationConditions: [{ kind: 'text-includes', text: '<task-complete>' }],
};

describe('PlatformRuntime — MISSING_PIECES §9 iterative dispatch', () => {
  it('runAgent on a spec WITH an iteration block constructs an IterativeAgentRun', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'looper', iteration: ITERATION }));
    const gateway = new MockGateway(() => textCompletion('done <task-complete>'));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const ref: AgentRef = { name: 'looper' };
    const run = await rt.runAgent(ref, 'go');
    expect(run).toBeInstanceOf(IterativeAgentRun);
    // @ts-expect-error wait is on InternalAgentRun
    const { ok, output } = await run.wait();
    expect(ok).toBe(true);
    expect(output).toContain('<task-complete>');
    expect(gateway.calls).toBe(1);
  });

  it('runAgent on a spec WITHOUT an iteration block still routes to LeafAgentRun', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'plain' }));
    const gateway = new MockGateway(() => textCompletion('hello'));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = await rt.runAgent({ name: 'plain' }, { msg: 'hi' });
    expect(run).not.toBeInstanceOf(IterativeAgentRun);
    // @ts-expect-error wait is on InternalAgentRun
    const { ok, output } = await run.wait();
    expect(ok).toBe(true);
    expect(output).toBe('hello');
  });
});
