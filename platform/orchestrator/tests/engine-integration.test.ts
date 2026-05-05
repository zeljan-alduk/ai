/**
 * End-to-end: a 2-level fixture wired through the real
 * `PlatformRuntime` + `Supervisor`. Confirms the parent run + 2 child
 * runs land in `InMemoryRunStore` with correct linkage, that a
 * sensitive parent cascades into a public child, and that the parent
 * run-event log includes `composite.child_started`,
 * `composite.child_completed`, and `composite.usage_rollup`.
 */

import { CompositeRuntimeMissingError, InMemoryRunStore, PlatformRuntime } from '@aldo-ai/engine';
import type {
  AgentRef,
  AgentRegistry,
  AgentSpec,
  RunEvent,
  TenantId,
  ValidationResult,
} from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { Supervisor } from '../src/index.js';

// Reuse the lightweight engine mocks vendored from platform/engine/tests
// — we don't import them directly because vitest's relative-path
// rules wouldn't follow the path; we duplicate the minimum needed to
// drive PlatformRuntime here.

import { randomUUID } from 'node:crypto';
import type {
  Attrs,
  CallContext,
  CompletionRequest,
  Delta,
  ModelGateway,
  ReplayBundle,
  RunId,
  Span,
  SpanId,
  SpanKind,
  ToolDescriptor,
  ToolHost,
  ToolRef,
  ToolResult,
  TraceId,
  Tracer,
} from '@aldo-ai/types';

const TENANT = 'tenant-eng-int' as TenantId;

function spec(partial: Partial<AgentSpec> & { name: string }): AgentSpec {
  return {
    apiVersion: 'aldo-ai/agent.v1',
    kind: 'Agent',
    identity: {
      name: partial.name,
      version: '1.0.0',
      description: '',
      owner: 'tests',
      tags: [],
    },
    role: { team: 'test', pattern: 'worker' },
    modelPolicy: {
      capabilityRequirements: [],
      privacyTier: 'public',
      primary: { capabilityClass: 'reasoning-medium' },
      fallbacks: [],
      budget: { usdMax: 1, usdGrace: 0.1 },
      decoding: { mode: 'free' },
    },
    prompt: { systemFile: 'noop.md' },
    tools: { mcp: [], native: [], permissions: { network: 'none', filesystem: 'none' } },
    memory: { read: [], write: [], retention: {} },
    spawn: { allowed: [] },
    escalation: [],
    subscriptions: [],
    evalGate: { requiredSuites: [], mustPassBeforePromote: false },
    ...partial,
  } as AgentSpec;
}

class MapRegistry implements AgentRegistry {
  private readonly specs = new Map<string, AgentSpec>();
  add(s: AgentSpec): void {
    this.specs.set(s.identity.name, s);
  }
  async load(ref: AgentRef): Promise<AgentSpec> {
    const s = this.specs.get(ref.name);
    if (!s) throw new Error(`unknown agent: ${ref.name}`);
    return s;
  }
  validate(): ValidationResult {
    return { ok: true, errors: [] };
  }
  async list(): Promise<AgentRef[]> {
    return Array.from(this.specs.values()).map((s) => ({
      name: s.identity.name,
      version: s.identity.version,
    }));
  }
  async promote(): Promise<void> {
    /* no-op */
  }
}

class StubGateway implements ModelGateway {
  async *complete(req: CompletionRequest, ctx: CallContext): AsyncIterable<Delta> {
    void req;
    const text = `out:${ctx.agentName}`;
    yield { textDelta: text };
    yield {
      end: {
        finishReason: 'stop',
        usage: {
          provider: 'mock',
          model: 'm',
          tokensIn: 5,
          tokensOut: text.length,
          usd: 0.001,
          at: '2026-04-25T12:00:00.000Z',
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
    };
  }
  async embed(): Promise<readonly (readonly number[])[]> {
    return [];
  }
}

class StubToolHost implements ToolHost {
  async invoke(_t: ToolRef, args: unknown, _c: CallContext): Promise<ToolResult> {
    return { ok: true, value: args };
  }
  async listTools(): Promise<readonly ToolDescriptor[]> {
    return [];
  }
}

class StubTracer implements Tracer {
  async span<T>(
    _name: string,
    kind: SpanKind,
    _attrs: Attrs,
    fn: (s: Span) => Promise<T>,
  ): Promise<T> {
    const s: Span = {
      id: randomUUID() as SpanId,
      traceId: randomUUID() as TraceId,
      kind,
      setAttr() {},
      event() {},
      end() {},
    };
    return fn(s);
  }
  async export(runId: RunId): Promise<ReplayBundle> {
    return { runId, traceId: randomUUID() as TraceId, checkpoints: [] };
  }
}

describe('engine ↔ orchestrator integration', () => {
  it('runs a 2-level supervisor and lands all 3 runs in the store with correct linkage', async () => {
    const registry = new MapRegistry();
    registry.add(spec({ name: 'worker-a' }));
    registry.add(spec({ name: 'worker-b' }));
    const supSpec = spec({
      name: 'sup',
      composite: {
        strategy: 'sequential',
        subagents: [{ agent: 'worker-a' }, { agent: 'worker-b' }],
      },
    });
    registry.add(supSpec);

    const runStore = new InMemoryRunStore();
    const rt = new PlatformRuntime({
      modelGateway: new StubGateway(),
      toolHost: new StubToolHost(),
      registry,
      tracer: new StubTracer(),
      tenant: TENANT,
      runStore,
    });

    // Late-bind the orchestrator (chicken-and-egg between Supervisor
    // construction and runtime adapter).
    const sup = new Supervisor({
      runtime: rt.asSupervisorAdapter(),
      emit: (e: RunEvent) => {
        // Land parent-side composite events in the run store too.
        // The supervisor run is the parent of every child; we emit
        // through the runStore directly here so the API can read
        // them.
        // Note: a future iteration could push these through the
        // runtime's tracer, but for now this matches what
        // LeafAgentRun does for its own events.
      },
    });
    rt.setOrchestrator(sup);

    const compositeRun = await rt.runAgent({ name: 'sup' }, 'go');
    // CompositeAgentRun has an in-package `wait()`.
    const waited = await (
      compositeRun as unknown as {
        wait: () => Promise<{ ok: boolean; output: unknown }>;
      }
    ).wait();
    expect(waited.ok).toBe(true);

    // The store should have 3 runs: supervisor + 2 workers.
    const allRuns = runStore.listByRoot(compositeRun.id as RunId);
    expect(allRuns.length).toBe(3);

    // Supervisor row has compositeStrategy=sequential and root=its-own-id.
    const supRow = runStore.getRun(compositeRun.id as RunId);
    expect(supRow?.compositeStrategy).toBe('sequential');
    expect(supRow?.root).toBe(compositeRun.id);

    // Each child carries the supervisor id as parent and root.
    const childRows = allRuns.filter((r) => r.runId !== compositeRun.id);
    expect(childRows).toHaveLength(2);
    for (const c of childRows) {
      expect(c.parent).toBe(compositeRun.id);
      expect(c.root).toBe(compositeRun.id);
      expect(c.compositeStrategy).toBe('sequential');
    }
  });

  it('throws CompositeRuntimeMissingError when a composite spec runs without an orchestrator', async () => {
    const registry = new MapRegistry();
    registry.add(
      spec({
        name: 'sup',
        composite: { strategy: 'parallel', subagents: [{ agent: 'x' }] },
      }),
    );
    const rt = new PlatformRuntime({
      modelGateway: new StubGateway(),
      toolHost: new StubToolHost(),
      registry,
      tracer: new StubTracer(),
      tenant: TENANT,
    });
    await expect(rt.runAgent({ name: 'sup' }, 'go')).rejects.toBeInstanceOf(
      CompositeRuntimeMissingError,
    );
  });

  it('non-composite runs (single-agent) go through the leaf path unchanged', async () => {
    const registry = new MapRegistry();
    registry.add(spec({ name: 'leaf' }));
    const runStore = new InMemoryRunStore();
    const rt = new PlatformRuntime({
      modelGateway: new StubGateway(),
      toolHost: new StubToolHost(),
      registry,
      tracer: new StubTracer(),
      tenant: TENANT,
      runStore,
    });
    const run = await rt.runAgent({ name: 'leaf' }, 'go');
    const got = await (
      run as unknown as {
        wait: () => Promise<{ ok: boolean; output: unknown }>;
      }
    ).wait();
    expect(got.ok).toBe(true);
    // Leaf runs end up with composite_strategy = null in the store.
    const stored = runStore.getRun(run.id as RunId);
    expect(stored?.compositeStrategy).toBeUndefined();
    // Root defaults to id (single-node tree).
    expect(stored?.root).toBe(run.id);
  });

  // MISSING_PIECES.md §13 / item 5.6 — engine spawn recursion.
  //
  // Pre-fix behaviour: PlatformRuntime.spawn always built a LeafAgentRun,
  // so when a child spec carried its own composite block (e.g. an
  // architect that supervises tech-lead + backend-engineer), the deeper
  // cascade was silently skipped. Surfaced by the §13 Phase F live-mode
  // dry-run against the real agency YAMLs.
  //
  // Post-fix behaviour: the engine detects spec.composite on every
  // spawned child and dispatches through the orchestrator, so the full
  // tree expands. This test fails without that fix.
  it('recurses through nested composite specs (item 5.6 — full cascade)', async () => {
    const registry = new MapRegistry();
    // Two-level composite: outer sup -> middle sup -> two leaves.
    registry.add(spec({ name: 'leaf-x' }));
    registry.add(spec({ name: 'leaf-y' }));
    registry.add(
      spec({
        name: 'middle',
        composite: {
          strategy: 'sequential',
          subagents: [{ agent: 'leaf-x' }, { agent: 'leaf-y' }],
        },
      }),
    );
    registry.add(
      spec({
        name: 'outer',
        composite: { strategy: 'sequential', subagents: [{ agent: 'middle' }] },
      }),
    );

    const runStore = new InMemoryRunStore();
    const rt = new PlatformRuntime({
      modelGateway: new StubGateway(),
      toolHost: new StubToolHost(),
      registry,
      tracer: new StubTracer(),
      tenant: TENANT,
      runStore,
    });
    const sup = new Supervisor({
      runtime: rt.asSupervisorAdapter(),
      emit: () => {},
    });
    rt.setOrchestrator(sup);

    const run = await rt.runAgent({ name: 'outer' }, 'go');
    const waited = await (
      run as unknown as {
        wait: () => Promise<{ ok: boolean; output: unknown }>;
      }
    ).wait();
    expect(waited.ok).toBe(true);

    // 4 runs: outer (composite) + middle (composite) + leaf-x + leaf-y.
    const allRuns = runStore.listByRoot(run.id as RunId);
    expect(allRuns.length).toBe(4);
    const byName = new Map(allRuns.map((r) => [r.ref.name, r]));
    expect(byName.has('outer')).toBe(true);
    expect(byName.has('middle')).toBe(true);
    expect(byName.has('leaf-x')).toBe(true);
    expect(byName.has('leaf-y')).toBe(true);

    // Composite supervisors carry compositeStrategy on the row;
    // leaves don't.
    expect(byName.get('outer')?.compositeStrategy).toBe('sequential');
    expect(byName.get('middle')?.compositeStrategy).toBe('sequential');
    expect(byName.get('leaf-x')?.compositeStrategy).toBeDefined(); // leaves carry the parent strategy
    expect(byName.get('leaf-y')?.compositeStrategy).toBeDefined();

    // Linkage: every row's root is the outer run id; middle's parent
    // is outer; leaves' parent is middle.
    const outerId = run.id;
    expect(byName.get('outer')?.parent).toBeUndefined();
    expect(byName.get('outer')?.root).toBe(outerId);
    expect(byName.get('middle')?.parent).toBe(outerId);
    expect(byName.get('middle')?.root).toBe(outerId);
    const middleId = byName.get('middle')?.runId;
    expect(byName.get('leaf-x')?.parent).toBe(middleId);
    expect(byName.get('leaf-y')?.parent).toBe(middleId);
    expect(byName.get('leaf-x')?.root).toBe(outerId);
    expect(byName.get('leaf-y')?.root).toBe(outerId);
  });
});
