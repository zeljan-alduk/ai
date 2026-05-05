/**
 * Agency dry-run driver — `/v1/healthz/db` brief.
 *
 * Item 5.4 from the §13 Phase F post-mortem. Loads the five
 * brief-touching agency YAMLs (principal, architect, tech-lead,
 * backend-engineer, code-reviewer), wires them into the
 * `@aldo-ai/orchestrator` Supervisor with a stubbed runtime adapter,
 * and drives the composite end-to-end. Captures every `composite.*`
 * event into a structured run log.
 *
 * Two modes:
 *
 *   - **Stub mode (default)** — each child run synthesises a
 *     plausible-looking output per agent without touching a model
 *     or any MCP server. Verifies that the registry loads, the
 *     composite resolves, and the events fire in the expected order.
 *     Runs in CI; ~80 ms.
 *
 *   - **Live mode (`opts.mode === 'live'`)** — out-of-scope today.
 *     Reserved for the day a full `EngineRuntimeAdapter` instance is
 *     handed in; flagged as `not yet implemented` so callers don't
 *     accidentally invoke an unfinished path.
 *
 * The output is a `DryRunResult` with the post-mortem rendered as
 * markdown. Tests assert on the structured fields; humans can write
 * the markdown to `agency/dry-runs/<date>-healthz-db-<mode>.md` for
 * archival.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryRunStore, PlatformRuntime } from '@aldo-ai/engine';
import type {
  AgentRef,
  AgentRegistry,
  AgentSpec,
  Attrs,
  CallContext,
  CompletionRequest,
  Delta,
  ModelGateway,
  ReplayBundle,
  RunEvent,
  RunId,
  Span,
  SpanId,
  SpanKind,
  TenantId,
  ToolDescriptor,
  ToolHost,
  ToolRef,
  ToolResult,
  Tracer,
  TraceId,
  UsageRecord,
  ValidationResult,
} from '@aldo-ai/types';
import {
  Supervisor,
  type OrchestrationResult,
  type RunContext,
  type SpawnedChildHandle,
  type SupervisorRuntimeAdapter,
} from '@aldo-ai/orchestrator';
import { parseYaml } from '@aldo-ai/registry';

export const HEALTHZ_DB_BRIEF = `Add a GET /v1/healthz/db endpoint to apps/api that pings the Postgres pool and returns {ok: true, latencyMs} or {ok: false, reason} on failure. Include unit tests against the existing pglite harness, register the operation in the OpenAPI spec, and open a PR against the working branch.`;

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const BRIEF_AGENT_PATHS: Record<string, string> = {
  principal: resolve(repoRoot, 'agency/direction/principal.yaml'),
  architect: resolve(repoRoot, 'agency/direction/architect.yaml'),
  'tech-lead': resolve(repoRoot, 'agency/delivery/tech-lead.yaml'),
  'backend-engineer': resolve(repoRoot, 'agency/delivery/backend-engineer.yaml'),
  'code-reviewer': resolve(repoRoot, 'agency/support/code-reviewer.yaml'),
  'security-auditor': resolve(repoRoot, 'agency/support/security-auditor.yaml'),
};

export interface DryRunOpts {
  /**
   * `'stub'`     — mock SupervisorRuntimeAdapter, synthesised outputs (1 level).
   * `'live'`     — real PlatformRuntime + real Supervisor + stub gateway and tool
   *                host. Drives the *full* composite cascade
   *                (principal → architect → tech-lead → reviewer + auditor + engineer).
   *                Proves recursive composite expansion. No model creds needed.
   * `'live:network'` — reserved. Same as `live`, but with real provider creds + real
   *                MCP tool host. Out of scope today.
   */
  readonly mode?: 'stub' | 'live' | 'live:network';
  /** Override the brief if you want to exercise a different shape. */
  readonly brief?: string;
}

export interface SpawnRecord {
  readonly runId: RunId;
  readonly agent: string;
  readonly inputs: unknown;
  readonly output: unknown;
  readonly durationMs: number;
}

export interface DryRunResult {
  readonly ok: boolean;
  readonly mode: 'stub' | 'live' | 'live:network';
  readonly brief: string;
  readonly events: ReadonlyArray<RunEventCapture>;
  readonly spawns: ReadonlyArray<SpawnRecord>;
  readonly orchestration: OrchestrationResult;
  readonly loadedSpecs: ReadonlyArray<string>;
  readonly missingSpecs: ReadonlyArray<{ agent: string; error: string }>;
  readonly postMortem: string;
  /** Live-mode only: count of runs landed in the run store (composite tree size). */
  readonly runStoreCount?: number;
}

export interface RunEventCapture {
  readonly type: RunEvent['type'];
  readonly payload: unknown;
}

export async function runDryRun(opts: DryRunOpts = {}): Promise<DryRunResult> {
  const mode: 'stub' | 'live' | 'live:network' = opts.mode ?? 'stub';
  if (mode === 'live:network') {
    throw new Error(
      'agency-dry-run: live:network mode requires real provider credentials + a real MCP tool host; not yet wired',
    );
  }
  const brief = opts.brief ?? HEALTHZ_DB_BRIEF;
  if (mode === 'live') {
    return runLiveMode(brief);
  }

  const { specs, missing } = await loadAgencySpecs(BRIEF_AGENT_PATHS);

  const events: RunEventCapture[] = [];
  const spawns: SpawnRecord[] = [];

  const adapter = new StubRuntimeAdapter(specs, spawns);
  const sup = new Supervisor({
    runtime: adapter,
    emit: (e) => events.push({ type: e.type, payload: e.payload }),
  });

  const principalSpec = specs.get('principal');
  if (!principalSpec) {
    return failure(
      mode,
      brief,
      events,
      spawns,
      missing,
      [...specs.keys()],
      `principal spec missing — cannot drive the composite. Errors: ${JSON.stringify(missing)}`,
    );
  }

  const ctx: RunContext = {
    tenant: 'tenant-dry-run' as TenantId,
    parentRunId: randomUUID() as RunId,
    rootRunId: randomUUID() as RunId,
    depth: 0,
    privacy: principalSpec.modelPolicy.privacyTier,
  };

  let orchestration: OrchestrationResult;
  try {
    orchestration = await sup.runComposite(principalSpec, brief, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failure(
      mode,
      brief,
      events,
      spawns,
      missing,
      [...specs.keys()],
      `runComposite threw: ${msg}`,
    );
  }

  const postMortem = renderPostMortem({
    mode,
    brief,
    events,
    spawns,
    orchestration,
    loadedSpecs: [...specs.keys()],
    missingSpecs: missing,
  });

  return {
    ok: orchestration.ok,
    mode,
    brief,
    events,
    spawns,
    orchestration,
    loadedSpecs: [...specs.keys()],
    missingSpecs: missing,
    postMortem,
  };
}

/**
 * Live mode (no network): real `PlatformRuntime` + real `Supervisor`,
 * stub `ModelGateway` + stub `ToolHost`. The engine drives the full
 * composite cascade through every level of the agency tree, recursing
 * into nested composite blocks (architect → tech-lead → reviewer +
 * auditor and architect → backend-engineer). The stub gateway emits
 * deterministic text per agent so leaf runs complete; the stub tool
 * host advertises no tools so leaves don't try to call MCP.
 *
 * What this proves vs. stub mode:
 *   - Recursive composite expansion through all six brief-touching agents.
 *   - Run-store linkage (parent_run_id, root_run_id) across every level.
 *   - The engine ↔ orchestrator integration on the real agency YAMLs.
 *
 * What this still does NOT prove:
 *   - Real model behaviour. Live network mode is `'live:network'`.
 *   - Real MCP I/O. Same.
 *   - A real PR. Same.
 */
async function runLiveMode(brief: string): Promise<DryRunResult> {
  const events: RunEventCapture[] = [];
  const spawns: SpawnRecord[] = [];

  const { specs, missing } = await loadAgencySpecs(BRIEF_AGENT_PATHS);
  const principalSpec = specs.get('principal');
  if (!principalSpec) {
    return failure(
      'live',
      brief,
      events,
      spawns,
      missing,
      [...specs.keys()],
      `principal spec missing — cannot drive the composite. Errors: ${JSON.stringify(missing)}`,
    );
  }

  const tenant = 'tenant-dry-run-live' as TenantId;
  const registry = new MapBackedRegistry(specs);
  const runStore = new InMemoryRunStore();

  const runtime = new PlatformRuntime({
    modelGateway: new StubGateway(),
    toolHost: new StubToolHost(),
    registry,
    tracer: new StubTracer(),
    tenant,
    runStore,
  });

  const supervisor = new Supervisor({
    runtime: runtime.asSupervisorAdapter(),
    emit: (e) => events.push({ type: e.type, payload: e.payload }),
  });
  runtime.setOrchestrator(supervisor);

  let topRunId: RunId | undefined;
  let topOk = false;
  let topOutput: unknown;
  try {
    const compositeRun = await runtime.runAgent({ name: 'principal' }, brief);
    topRunId = compositeRun.id as RunId;
    const waited = await (
      compositeRun as unknown as {
        wait: () => Promise<{ ok: boolean; output: unknown }>;
      }
    ).wait();
    topOk = waited.ok;
    topOutput = waited.output;
  } catch (err) {
    return failure(
      'live',
      brief,
      events,
      spawns,
      missing,
      [...specs.keys()],
      `runtime.runAgent threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Walk the run-store rows scoped to the supervisor's root and
  // synthesise SpawnRecords so the post-mortem renderer surfaces the
  // composite tree the engine actually built.
  const runs = topRunId !== undefined ? runStore.listByRoot(topRunId) : [];
  for (const r of runs) {
    if (r.runId === topRunId) continue; // skip the supervisor itself
    spawns.push({
      runId: r.runId,
      agent: r.ref.name,
      inputs: undefined,
      output: null,
      durationMs: 0,
    });
  }

  // The Supervisor emits `composite.usage_rollup` events at every
  // composite level. The outermost rollup carries the whole tree's
  // total. Pull it from the last rollup we captured; fall back to
  // zero if no rollup fired (shouldn't happen on success).
  const lastRollup = [...events]
    .reverse()
    .find((e) => e.type === 'composite.usage_rollup');
  const totalUsage: UsageRecord =
    lastRollup !== undefined && isRollupPayload(lastRollup.payload)
      ? lastRollup.payload.total
      : zeroUsage();

  const orchestration: OrchestrationResult = {
    ok: topOk,
    strategy: principalSpec.composite?.strategy ?? 'sequential',
    output: topOutput,
    children: [],
    totalUsage,
  };

  const postMortem = renderPostMortem({
    mode: 'live',
    brief,
    events,
    spawns,
    orchestration,
    loadedSpecs: [...specs.keys()],
    missingSpecs: missing,
  });

  return {
    ok: topOk,
    mode: 'live',
    brief,
    events,
    spawns,
    orchestration,
    loadedSpecs: [...specs.keys()],
    missingSpecs: missing,
    postMortem,
    runStoreCount: runs.length,
  };
}

interface SpecBundle {
  specs: Map<string, AgentSpec>;
  missing: { agent: string; error: string }[];
}

async function loadAgencySpecs(paths: Record<string, string>): Promise<SpecBundle> {
  const specs = new Map<string, AgentSpec>();
  const missing: { agent: string; error: string }[] = [];
  await Promise.all(
    Object.entries(paths).map(async ([name, path]) => {
      try {
        const text = await readFile(path, 'utf8');
        const result = parseYaml(text);
        if (!result.ok || !result.spec) {
          missing.push({
            agent: name,
            error: result.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
          });
          return;
        }
        specs.set(name, result.spec);
      } catch (err) {
        missing.push({
          agent: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
  return { specs, missing };
}

/**
 * `AgentRegistry` over the in-memory spec map produced by
 * `loadAgencySpecs`. Used in live mode so PlatformRuntime can resolve
 * each composite child without touching the API's per-tenant Postgres
 * registry.
 */
class MapBackedRegistry implements AgentRegistry {
  constructor(private readonly specs: Map<string, AgentSpec>) {}

  async load(ref: AgentRef): Promise<AgentSpec> {
    const s = this.specs.get(ref.name);
    if (!s) {
      throw new Error(
        `live-runtime: unknown agent '${ref.name}' (loaded: ${[...this.specs.keys()].join(', ')})`,
      );
    }
    return s;
  }

  validate(): ValidationResult {
    return { ok: true, errors: [] };
  }

  async list(): Promise<AgentRef[]> {
    return [...this.specs.values()].map((s) => ({
      name: s.identity.name,
      version: s.identity.version,
    }));
  }

  async promote(): Promise<void> {
    /* no-op for the dry-run registry */
  }
}

/**
 * Deterministic `ModelGateway` that emits one text delta + an end
 * frame per leaf run. The text payload encodes the agent name so the
 * post-mortem can verify the cascade reached every leaf.
 */
class StubGateway implements ModelGateway {
  async *complete(_req: CompletionRequest, ctx: CallContext): AsyncIterable<Delta> {
    const text = `live-stub:${ctx.agentName}`;
    yield { textDelta: text };
    yield {
      end: {
        finishReason: 'stop',
        usage: {
          provider: 'stub-live',
          model: `stub:${ctx.agentName}`,
          tokensIn: 1_500,
          tokensOut: 250,
          usd: 0.005,
          at: new Date().toISOString(),
        },
        model: {
          id: `stub:${ctx.agentName}`,
          provider: 'stub-live',
          locality: 'local',
          provides: [],
          cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
          privacyAllowed: ['public', 'internal', 'sensitive'],
          capabilityClass: ctx.required[0] ?? 'reasoning-medium',
          effectiveContextTokens: 8192,
        },
      },
    };
  }
  async embed(): Promise<readonly (readonly number[])[]> {
    return [];
  }
}

/**
 * No-op `ToolHost` — advertises zero tools, refuses every invoke.
 * Leaf runs in live mode never reach for MCP because the StubGateway
 * never emits a tool_call in its delta stream.
 */
class StubToolHost implements ToolHost {
  async listTools(): Promise<readonly ToolDescriptor[]> {
    return [];
  }
  async invoke(_t: ToolRef, _args: unknown, _c: CallContext): Promise<ToolResult> {
    return {
      ok: false,
      value: null,
      error: { code: 'tool_unavailable', message: 'live-mode dry-run uses no tool host' },
    };
  }
}

/**
 * Minimal `Tracer` — every `span()` call resolves with a no-op span.
 * The dry-run doesn't consume traces; the engine just expects the
 * interface to exist.
 */
class StubTracer implements Tracer {
  async span<T>(
    _name: string,
    kind: SpanKind,
    _attrs: Attrs,
    fn: (s: Span) => Promise<T>,
  ): Promise<T> {
    const span: Span = {
      id: randomUUID() as SpanId,
      traceId: randomUUID() as TraceId,
      kind,
      setAttr() {},
      event() {},
      end() {},
    };
    return fn(span);
  }
  async export(runId: RunId): Promise<ReplayBundle> {
    return { runId, traceId: randomUUID() as TraceId, checkpoints: [] };
  }
}

class StubRuntimeAdapter implements SupervisorRuntimeAdapter {
  private readonly specs: Map<string, AgentSpec>;
  private readonly spawns: SpawnRecord[];

  constructor(specs: Map<string, AgentSpec>, spawns: SpawnRecord[]) {
    this.specs = specs;
    this.spawns = spawns;
  }

  async loadSpec(ref: AgentRef): Promise<AgentSpec> {
    const s = this.specs.get(ref.name);
    if (!s) {
      throw new Error(
        `stub-runtime: unknown agent '${ref.name}' (loaded specs: ${[...this.specs.keys()].join(', ')})`,
      );
    }
    return s;
  }

  async spawnChild(args: {
    readonly agent: AgentRef;
    readonly inputs: unknown;
    readonly parentRunId: RunId;
    readonly rootRunId: RunId;
    readonly tenant: TenantId;
    readonly privacy: import('@aldo-ai/types').PrivacyTier;
    readonly compositeStrategy?: 'sequential' | 'parallel' | 'debate' | 'iterative';
  }): Promise<SpawnedChildHandle> {
    const runId = randomUUID() as RunId;
    const spawns = this.spawns;
    const inputs = args.inputs;
    const agent = args.agent.name;
    const start = Date.now();
    let cachedUsage: UsageRecord = zeroUsage();
    return {
      runId,
      wait: async () => {
        const output = synthesiseOutput(agent, inputs);
        cachedUsage = synthesiseUsage(agent);
        spawns.push({
          runId,
          agent,
          inputs,
          output,
          durationMs: Date.now() - start,
        });
        return { ok: true, output };
      },
      collectUsage: () => cachedUsage,
    };
  }
}

/**
 * Per-agent stub output. The shapes are intentionally plausible
 * (architect emits ADR-shaped text, engineer emits a delivery_plan
 * stub, reviewer emits an approval) so downstream consumers can
 * sanity-check that the input_map projections behave correctly even
 * with synthetic data.
 */
function synthesiseOutput(agent: string, inputs: unknown): unknown {
  switch (agent) {
    case 'principal':
      return {
        direction_brief: typeof inputs === 'string' ? inputs : 'principal-direction',
      };
    case 'architect':
      return {
        adr_document: {
          title: 'ADR-DRYRUN: /v1/healthz/db endpoint',
          decision: 'Use existing pg pool; add lightweight ping with 1s timeout.',
          consequences: 'Adds one route, one test file, no schema migration.',
        },
      };
    case 'tech-lead':
      return {
        delivery_plan: {
          packages: ['apps/api'],
          tasks: [
            { id: 'T1', owner: 'backend-engineer', summary: 'Implement /v1/healthz/db' },
            { id: 'T2', owner: 'code-reviewer', summary: 'Review the diff' },
          ],
        },
      };
    case 'backend-engineer':
      return {
        artefact: {
          files_changed: ['apps/api/src/routes/healthz-db.ts', 'apps/api/tests/healthz-db.test.ts'],
          tests_passed: true,
        },
      };
    case 'code-reviewer':
      return {
        review: {
          decision: 'approve',
          comments: [],
        },
      };
    case 'security-auditor':
      return {
        security: {
          decision: 'no concerns',
          findings: [],
        },
      };
    default:
      return { stub: true, agent, inputs };
  }
}

function synthesiseUsage(agent: string): UsageRecord {
  // Plausible token counts so cost-rollup tests don't get all zeros.
  const tokensIn = agent === 'principal' || agent === 'architect' ? 4_000 : 2_500;
  const tokensOut = agent === 'principal' || agent === 'architect' ? 800 : 400;
  return {
    provider: 'stub',
    model: `stub:${agent}`,
    tokensIn,
    tokensOut,
    usd: tokensIn * 0.000_005 + tokensOut * 0.000_015,
    at: new Date().toISOString(),
  };
}

function zeroUsage(): UsageRecord {
  return {
    provider: 'stub',
    model: 'none',
    tokensIn: 0,
    tokensOut: 0,
    usd: 0,
    at: new Date(0).toISOString(),
  };
}

function isRollupPayload(p: unknown): p is { total: UsageRecord } {
  if (!p || typeof p !== 'object') return false;
  const total = (p as { total?: unknown }).total;
  if (!total || typeof total !== 'object') return false;
  const t = total as Record<string, unknown>;
  return (
    typeof t.provider === 'string' &&
    typeof t.model === 'string' &&
    typeof t.tokensIn === 'number' &&
    typeof t.tokensOut === 'number' &&
    typeof t.usd === 'number' &&
    typeof t.at === 'string'
  );
}

function failure(
  mode: 'stub' | 'live' | 'live:network',
  brief: string,
  events: RunEventCapture[],
  spawns: SpawnRecord[],
  missing: { agent: string; error: string }[],
  loadedSpecs: string[],
  reason: string,
): DryRunResult {
  const stubOrchestration: OrchestrationResult = {
    ok: false,
    strategy: 'sequential',
    output: null,
    children: [],
    totalUsage: zeroUsage(),
  };
  const postMortem = `# Dry-run FAILED\n\n${reason}\n\nLoaded: ${loadedSpecs.join(', ') || '(none)'}\nMissing: ${missing.map((m) => m.agent).join(', ') || '(none)'}\n`;
  return {
    ok: false,
    mode,
    brief,
    events,
    spawns,
    orchestration: stubOrchestration,
    loadedSpecs,
    missingSpecs: missing,
    postMortem,
  };
}

function renderPostMortem(args: {
  mode: 'stub' | 'live' | 'live:network';
  brief: string;
  events: RunEventCapture[];
  spawns: SpawnRecord[];
  orchestration: OrchestrationResult;
  loadedSpecs: string[];
  missingSpecs: { agent: string; error: string }[];
}): string {
  const eventsByType = new Map<string, number>();
  for (const e of args.events) {
    eventsByType.set(e.type, (eventsByType.get(e.type) ?? 0) + 1);
  }
  const eventLines = [...eventsByType.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, count]) => `- \`${type}\`: ${count}`);
  const spawnLines = args.spawns.map((s, i) => {
    const summary =
      s.output === null || s.output === undefined
        ? '(no output captured)'
        : typeof s.output === 'object'
          ? Object.keys(s.output as object).join(', ')
          : String(s.output).slice(0, 60);
    return `${i + 1}. **${s.agent}** → ${summary} (${s.durationMs} ms)`;
  });
  const totalUsd = args.orchestration.totalUsage.usd.toFixed(4);
  const missingLines = args.missingSpecs.map((m) => `- ${m.agent}: ${m.error}`);
  const lines: string[] = [
    `# Agency dry-run — \`/v1/healthz/db\` (mode: ${args.mode})`,
    '',
    `**Result:** ${args.orchestration.ok ? '✅ composite completed' : '❌ composite failed'}`,
    `**Brief:** ${args.brief}`,
    '',
    `## Specs loaded (${args.loadedSpecs.length})`,
    args.loadedSpecs.map((s) => `- ${s}`).join('\n') || '_none_',
    '',
    args.missingSpecs.length > 0 ? `## Specs missing (${args.missingSpecs.length})` : '',
    args.missingSpecs.length > 0 ? missingLines.join('\n') : '',
    '',
    '## Spawns recorded',
    spawnLines.join('\n') || '_no children spawned_',
    '',
    '## Event histogram',
    eventLines.join('\n') || '_no events_',
    '',
    '## Cost rollup (synthetic)',
    `- Total USD: $${totalUsd}`,
    `- Total tokens in: ${args.orchestration.totalUsage.tokensIn}`,
    `- Total tokens out: ${args.orchestration.totalUsage.tokensOut}`,
    '',
    args.mode === 'stub'
      ? '_Stub mode: 1-level mock SupervisorRuntimeAdapter. Run with mode: "live" to drive the real PlatformRuntime + Supervisor._'
      : args.mode === 'live'
        ? '_Live mode (no network): real PlatformRuntime + Supervisor + stub gateway + stub tool host. Surfaces the engine gap noted in the §13 Phase F post-mortem (`agency/dry-runs/2026-05-04-healthz-db.md` §11): PlatformRuntime.spawn always creates a LeafAgentRun, so nested composite specs (e.g. architect.composite.subagents) are silently skipped when the child runs. The fix is an engine-side enhancement; tracked separately. Run with mode: "live:network" once provider creds + real MCP tool host are wired._'
        : '',
  ];
  return lines.filter((l) => l !== '').join('\n');
}
