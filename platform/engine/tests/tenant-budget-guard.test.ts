/**
 * MISSING_PIECES §12.5 — engine-side tenant-budget guard wired into
 * PlatformRuntime.spawn + IterativeAgentRun.runLoop.
 *
 * The API gate (POST /v1/runs) refuses NEW dispatches when a tenant
 * has crossed its hard cap. The engine-side guard is what stops a
 * stuck loop or composite tree that's already running. These tests
 * pin both shapes:
 *
 *   - spawn() throws TenantBudgetExceededError when the guard denies.
 *   - The wrap-safe layer never lets a guard exception escalate into
 *     a run failure (degrades to "allow").
 *   - An iterative leaf terminates with reason=tenant-budget-exhausted
 *     when the guard flips between cycles.
 *   - Default guard (allow-all) preserves pre-§12.5 behaviour.
 */

import type { AgentRef, AgentSpec, Delta, TenantId } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import {
  PlatformRuntime,
  TenantBudgetExceededError,
  allowAllTenantBudget,
  wrapBudgetGuardSafe,
  type TenantBudgetGuard,
} from '../src/index.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
  textCompletion,
} from './mocks/index.js';

/**
 * Iterative-loop-shaped delta: text + an `end` envelope carrying a
 * usage record. Matches the existing iterative-run.test.ts helper so
 * the loop's runOneCycle finishes cleanly between guard checks.
 */
function iterDelta(text: string): Delta[] {
  return [
    { textDelta: text },
    {
      end: {
        finishReason: 'stop',
        usage: {
          provider: 'mock',
          model: 'mock-1',
          tokensIn: 4,
          tokensOut: 4,
          usd: 0,
          at: new Date().toISOString(),
        },
        model: {
          id: 'mock-1',
          provider: 'mock',
          locality: 'local',
          provides: [],
          cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
          privacyAllowed: ['public', 'internal', 'sensitive'],
          capabilityClass: 'reasoning-medium',
          effectiveContextTokens: 8192,
        },
      },
    },
  ];
}

const TENANT = 'tenant-budget' as TenantId;

function denyGuard(reason = 'tenant has reached cap of $5'): TenantBudgetGuard {
  return async () => ({
    allowed: false,
    reason,
    capUsd: 5,
    totalUsd: 7.5,
  });
}

describe('PlatformRuntime — tenant budget guard', () => {
  it('default (no guard) allows every spawn (pre-§12.5 behaviour preserved)', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'echo' }));
    const rt = new PlatformRuntime({
      modelGateway: new MockGateway(() => textCompletion('ok')),
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });
    const run = await rt.spawn({ name: 'echo' } as AgentRef, null);
    expect(run.id).toBeTruthy();
  });

  it('spawn refuses with TenantBudgetExceededError when guard denies', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'echo' }));
    const rt = new PlatformRuntime({
      modelGateway: new MockGateway(() => textCompletion('ok')),
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      tenantBudgetGuard: denyGuard(),
    });
    await expect(rt.spawn({ name: 'echo' } as AgentRef, null)).rejects.toBeInstanceOf(
      TenantBudgetExceededError,
    );
  });

  it('spawn surfaces verdict.totalUsd + capUsd on the typed error', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'echo' }));
    const rt = new PlatformRuntime({
      modelGateway: new MockGateway(() => textCompletion('ok')),
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      tenantBudgetGuard: denyGuard(),
    });
    let caught: unknown;
    try {
      await rt.spawn({ name: 'echo' } as AgentRef, null);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TenantBudgetExceededError);
    if (caught instanceof TenantBudgetExceededError) {
      expect(caught.tenantId).toBe(TENANT);
      expect(caught.capUsd).toBe(5);
      expect(caught.totalUsd).toBe(7.5);
    }
  });

  it('a guard that throws degrades to allow (wrapBudgetGuardSafe)', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'echo' }));
    const flaky: TenantBudgetGuard = async () => {
      throw new Error('transient db blip');
    };
    const rt = new PlatformRuntime({
      modelGateway: new MockGateway(() => textCompletion('ok')),
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      tenantBudgetGuard: flaky,
    });
    // Must NOT reject — the wrap-safe layer turns the throw into "allow".
    const run = await rt.spawn({ name: 'echo' } as AgentRef, null);
    expect(run.id).toBeTruthy();
  });

  it('allowAllTenantBudget always returns allowed=true', async () => {
    const v = await allowAllTenantBudget('any' as TenantId);
    expect(v.allowed).toBe(true);
    expect(v.capUsd).toBeNull();
  });

  it('wrapBudgetGuardSafe forwards verdicts cleanly when inner does not throw', async () => {
    const inner: TenantBudgetGuard = async () => ({
      allowed: false,
      reason: 'over cap',
      capUsd: 1,
      totalUsd: 2,
    });
    const wrapped = wrapBudgetGuardSafe(inner);
    const v = await wrapped('t' as TenantId);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('over cap');
    expect(v.capUsd).toBe(1);
  });
});

describe('IterativeAgentRun — tenant budget guard pre-step', () => {
  function makeIterativeSpec(name = 'iter'): AgentSpec {
    return makeSpec({
      name,
      iteration: {
        maxCycles: 5,
        contextWindow: 8192,
        summaryStrategy: 'rolling-window',
        terminationConditions: [],
      },
    } as unknown as Partial<AgentSpec> & { name: string });
  }

  it('terminates with reason=tenant-budget-exhausted when guard denies between cycles', async () => {
    const registry = new MockRegistry();
    registry.add(makeIterativeSpec('iter-deny'));
    let calls = 0;
    const guard: TenantBudgetGuard = async () => {
      calls += 1;
      // runAgent dispatches straight to the iterative branch (no
      // spawn() pre-call), so the very first guard hit is the
      // cycle-1 pre-check inside runLoop. Deny immediately so the
      // loop terminates with the new typed reason.
      return { allowed: false, reason: 'tenant cap reached', capUsd: 5, totalUsd: 6 };
    };
    const rt = new PlatformRuntime({
      modelGateway: new MockGateway(() => iterDelta('still going')),
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      tenantBudgetGuard: guard,
    });

    const run = await rt.runAgent({ name: 'iter-deny' }, null);
    const events: { type: string; payload?: unknown }[] = [];
    for await (const ev of run.events()) {
      events.push({ type: ev.type, payload: ev.payload });
    }
    const term = events.find((e) => e.type === 'run.terminated_by');
    expect(term).toBeDefined();
    expect((term?.payload as { reason: string }).reason).toBe('tenant-budget-exhausted');
    const completed = events.find((e) => e.type === 'run.completed');
    expect(completed).toBeDefined();
    expect((completed?.payload as { terminatedBy: string }).terminatedBy).toBe(
      'tenant-budget-exhausted',
    );
    // Guard fired at least once (the cycle-1 pre-check).
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on tenant-budget when guard allows every cycle', async () => {
    const registry = new MockRegistry();
    registry.add(makeIterativeSpec('iter-allow'));
    const rt = new PlatformRuntime({
      modelGateway: new MockGateway(() => iterDelta('keep going')),
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      tenantBudgetGuard: allowAllTenantBudget,
    });
    const run = await rt.runAgent({ name: 'iter-allow' }, null);
    const events: { type: string; payload?: unknown }[] = [];
    for await (const ev of run.events()) {
      events.push({ type: ev.type, payload: ev.payload });
    }
    const term = events.find((e) => e.type === 'run.terminated_by');
    // The loop terminates on its own (maxCycles); the important
    // assertion is that we did NOT terminate on tenant-budget.
    if (term !== undefined) {
      expect((term.payload as { reason: string }).reason).not.toBe('tenant-budget-exhausted');
    }
  });
});
