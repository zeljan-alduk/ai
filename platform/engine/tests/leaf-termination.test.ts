/**
 * Wave-MVP follow-up — leaf-only declarative termination.
 *
 * Mirrors `platform/orchestrator/tests/termination.test.ts` for the
 * single-agent (LeafAgentRun) case. Composite-level termination still
 * lives in the orchestrator and is unaffected.
 *
 * Coverage:
 *   - default-no-termination path is unchanged (no `run.terminated_by`)
 *   - maxTurns      — caps the per-turn loop after N model calls
 *   - maxUsd        — caps when cumulative per-turn USD crosses the cap
 *   - textMention   — case-insensitive substring on assistant text
 *   - successRoles  — never fires for a leaf run (composite-only)
 *
 * The fixtures use the existing `MockGateway` + a tiny scripted
 * sequence of completions; tool dispatch isn't exercised here because
 * the termination tracker runs once per model-call turn regardless.
 */

import type { AgentRef, AgentSpec, Delta, RunEvent, TenantId } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { PlatformRuntime } from '../src/runtime.js';
import { MockGateway, MockRegistry, MockToolHost, MockTracer, makeSpec } from './mocks/index.js';

const TENANT = 'tenant-a' as TenantId;

/**
 * Build a "tool_use" continuation delta that asks the model to call
 * an absent tool — but since the spec has no tools registered, the
 * runtime treats `tool_use` without tool calls as `stop`. So we use
 * a constant text-then-stop completion per turn instead, and arrange
 * for the loop to run multiple turns by feeding a follow-up message
 * via `send()` from the caller.
 *
 * Simpler approach: drive multi-turn purely through the tool-result
 * loop. We script the gateway to emit a tool_call on turn 0 and a
 * plain text-stop on turn 1+. With a stub tool host that always
 * returns a result, the engine loops back for another turn.
 */
function multiTurnGateway(
  perTurn: (turnIdx: number) => { text?: string; toolCallId?: string; usd?: number },
): MockGateway {
  return new MockGateway((_req, _ctx, callIndex) => {
    const t = perTurn(callIndex);
    const deltas: Delta[] = [];
    if (t.text !== undefined) deltas.push({ textDelta: t.text });
    if (t.toolCallId !== undefined) {
      deltas.push({
        toolCall: {
          type: 'tool_call',
          callId: t.toolCallId,
          tool: 'echo',
          args: {},
        },
      });
    }
    deltas.push({
      end: {
        finishReason: t.toolCallId !== undefined ? 'tool_use' : 'stop',
        usage: {
          provider: 'mock',
          model: 'm',
          tokensIn: 1,
          tokensOut: Math.max(1, t.text?.length ?? 1),
          usd: t.usd ?? 0,
          at: new Date().toISOString(),
        },
        model: {
          id: 'm',
          provider: 'mock',
          locality: 'local',
          provides: [],
          cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
          privacyAllowed: ['public', 'internal', 'sensitive'],
          capabilityClass: 'reasoning-medium',
          effectiveContextTokens: 8192,
        },
      },
    });
    return deltas;
  });
}

/**
 * Stub native tool the spec advertises so the model can request it.
 * The mock tool host echoes the args back; the engine appends the
 * tool result to the message list and starts the next turn.
 */
function withEchoTool(spec: AgentSpec): AgentSpec {
  return {
    ...spec,
    tools: {
      mcp: [],
      native: [{ ref: 'echo' }],
      permissions: { network: 'none', filesystem: 'none' },
    },
  } as AgentSpec;
}

async function collectEvents(run: {
  events: () => AsyncIterable<RunEvent>;
  wait: () => Promise<unknown>;
}): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  const iter = run.events()[Symbol.asyncIterator]();
  await Promise.race([
    (async () => {
      while (true) {
        const r = await iter.next();
        if (r.done) return;
        out.push(r.value);
      }
    })(),
    run.wait().then(async () => {
      // Drain any buffered events after the run settles.
      while (true) {
        const r = await iter.next();
        if (r.done) return;
        out.push(r.value);
      }
    }),
  ]);
  return out;
}

function buildRuntime(spec: AgentSpec, gateway: MockGateway): PlatformRuntime {
  const registry = new MockRegistry();
  registry.add(spec);
  return new PlatformRuntime({
    modelGateway: gateway,
    toolHost: new MockToolHost(),
    registry,
    tracer: new MockTracer(),
    tenant: TENANT,
  });
}

describe('LeafAgentRun declarative termination (wave-MVP follow-up)', () => {
  it('does NOT fire when the spec has no termination block', async () => {
    const gateway = multiTurnGateway(() => ({ text: 'hello' }));
    const spec = makeSpec({ name: 'plain' });
    const rt = buildRuntime(spec, gateway);
    const ref: AgentRef = { name: 'plain' };
    const run = await rt.spawn(ref, 'go');
    // @ts-expect-error wait/events on InternalAgentRun
    const events = await collectEvents(run);
    // @ts-expect-error wait on InternalAgentRun
    const { ok } = await run.wait();
    expect(ok).toBe(true);
    expect(events.find((e) => e.type === 'run.terminated_by')).toBeUndefined();
  });

  it('maxTurns short-circuits the per-turn loop after N completions', async () => {
    // Turn 0: tool_call → loops. Turn 1: tool_call → loops. Turn 2: text-stop.
    // maxTurns:2 should fire on turn 1 and end with ok:true.
    const gateway = multiTurnGateway((idx) =>
      idx < 2 ? { toolCallId: `c-${idx}` } : { text: 'done' },
    );
    const spec = withEchoTool(
      makeSpec({
        name: 't-max-turns',
        spawn: { allowed: [] },
        termination: { maxTurns: 2 },
      }),
    );
    const rt = buildRuntime(spec, gateway);
    const run = await rt.spawn({ name: 't-max-turns' }, 'go');
    // @ts-expect-error wait/events on InternalAgentRun
    const events = await collectEvents(run);
    // @ts-expect-error wait on InternalAgentRun
    const { ok } = await run.wait();
    expect(ok).toBe(true);
    const term = events.find((e) => e.type === 'run.terminated_by');
    expect(term).toBeDefined();
    const payload = term?.payload as { reason: string; detail: { turns: number; limit: number } };
    expect(payload.reason).toBe('maxTurns');
    expect(payload.detail).toMatchObject({ turns: 2, limit: 2 });
  });

  it('maxUsd short-circuits when cumulative per-turn USD crosses the cap', async () => {
    // Each turn reports usd=0.4; cap=1.0 fires after the 3rd turn.
    const gateway = multiTurnGateway((idx) =>
      idx < 4 ? { toolCallId: `c-${idx}`, usd: 0.4 } : { text: 'done', usd: 0.4 },
    );
    const spec = withEchoTool(
      makeSpec({
        name: 't-max-usd',
        termination: { maxUsd: 1.0 },
      }),
    );
    const rt = buildRuntime(spec, gateway);
    const run = await rt.spawn({ name: 't-max-usd' }, 'go');
    // @ts-expect-error wait/events on InternalAgentRun
    const events = await collectEvents(run);
    // @ts-expect-error wait on InternalAgentRun
    const { ok } = await run.wait();
    expect(ok).toBe(true);
    const term = events.find((e) => e.type === 'run.terminated_by');
    expect(term).toBeDefined();
    const payload = term?.payload as { reason: string; detail: { usd: number; cap: number } };
    expect(payload.reason).toBe('maxUsd');
    expect(payload.detail.cap).toBe(1.0);
    expect(payload.detail.usd).toBeGreaterThanOrEqual(1.0);
  });

  it('textMention fires (case-insensitive) on assistant text', async () => {
    // Turn 0 emits text without the sentinel + tool_call. Turn 1 emits
    // text containing TERMINATE (uppercased — match must be CI).
    const gateway = multiTurnGateway((idx) =>
      idx === 0
        ? { text: 'still working', toolCallId: 'c-0' }
        : { text: 'all done — please TERMINATE now' },
    );
    const spec = withEchoTool(
      makeSpec({
        name: 't-text',
        termination: { textMention: 'terminate' },
      }),
    );
    const rt = buildRuntime(spec, gateway);
    const run = await rt.spawn({ name: 't-text' }, 'go');
    // @ts-expect-error wait/events on InternalAgentRun
    const events = await collectEvents(run);
    // @ts-expect-error wait on InternalAgentRun
    const { ok } = await run.wait();
    expect(ok).toBe(true);
    const term = events.find((e) => e.type === 'run.terminated_by');
    expect(term).toBeDefined();
    const payload = term?.payload as { reason: string; detail: { trigger: string } };
    expect(payload.reason).toBe('textMention');
    expect(payload.detail.trigger).toBe('terminate');
  });

  it('successRoles is a no-op for a leaf run (composite-only)', async () => {
    // Even with a successRoles config, a leaf run never fires it; the
    // run completes through the normal stop path.
    const gateway = multiTurnGateway(() => ({ text: 'plain stop' }));
    const spec = makeSpec({
      name: 't-roles',
      termination: { successRoles: ['judge'] },
    });
    const rt = buildRuntime(spec, gateway);
    const run = await rt.spawn({ name: 't-roles' }, 'go');
    // @ts-expect-error wait/events on InternalAgentRun
    const events = await collectEvents(run);
    // @ts-expect-error wait on InternalAgentRun
    const { ok, output } = await run.wait();
    expect(ok).toBe(true);
    expect(output).toBe('plain stop');
    expect(events.find((e) => e.type === 'run.terminated_by')).toBeUndefined();
  });

  it('emits run.completed alongside run.terminated_by (terminatedBy stamped)', async () => {
    const gateway = multiTurnGateway((idx) =>
      idx < 1 ? { toolCallId: `c-${idx}` } : { text: 'done' },
    );
    const spec = withEchoTool(
      makeSpec({
        name: 't-complete',
        termination: { maxTurns: 1 },
      }),
    );
    const rt = buildRuntime(spec, gateway);
    const run = await rt.spawn({ name: 't-complete' }, 'go');
    // @ts-expect-error wait/events on InternalAgentRun
    const events = await collectEvents(run);
    // @ts-expect-error wait on InternalAgentRun
    const { ok } = await run.wait();
    expect(ok).toBe(true);
    const completed = events.find((e) => e.type === 'run.completed');
    expect(completed).toBeDefined();
    const payload = completed?.payload as { terminatedBy?: string };
    expect(payload.terminatedBy).toBe('maxTurns');
  });
});
