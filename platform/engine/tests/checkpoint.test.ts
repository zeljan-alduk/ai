import { describe, expect, it } from 'vitest';
import type { RunOverrides, TenantId } from '@meridian/types';
import type { InternalAgentRun } from '../src/agent-run.js';
import { PlatformRuntime } from '../src/runtime.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
  textCompletion,
} from './mocks/index.js';

const TENANT = 'tenant-a' as TenantId;

describe('checkpoint + resume', () => {
  it('resumes a run with a model override and produces a distinguishable trace', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'worker' }));

    const overridesSeen: (RunOverrides | undefined)[] = [];
    const gateway = new MockGateway((_req, ctx) => {
      // The engine stashes overrides into the ctx at a future date; for v0 the
      // override is carried by the AgentRun and visible in the ctx.agentName
      // taint — we verify this differently, via checkpoint.overrides below.
      void ctx;
      return textCompletion(`reply-${overridesSeen.length}`);
    });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = (await rt.spawn({ name: 'worker' }, 'hello')) as InternalAgentRun;
    const cpId = await run.checkpoint();

    // First run completes.
    const first = await run.wait();
    expect(first.ok).toBe(true);
    expect(first.output).toBe('reply-0');

    // Resume with a model override — engine must capture it in the new
    // run's checkpoints for deterministic replay.
    const override: RunOverrides = { capabilityClass: 'reasoning-large', model: 'big-1' };
    overridesSeen.push(override);
    const resumed = (await run.resume(cpId, override)) as InternalAgentRun;
    expect(resumed.id).not.toBe(run.id);
    const second = await resumed.wait();
    expect(second.ok).toBe(true);
    // A different text came back because the scripted gateway advanced.
    expect(second.output).not.toBe(first.output);

    // The checkpointer has entries for the resumed run; the most recent 'pre'
    // checkpoint carries the override record.
    const cps = await rt.getCheckpointer().listByRun(resumed.id);
    expect(cps.length).toBeGreaterThan(0);
    const withOverride = cps.find((c) => c.overrides?.model === 'big-1');
    expect(withOverride).toBeDefined();
  });
});
