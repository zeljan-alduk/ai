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
import type {
  AgentRef,
  AgentSpec,
  RunEvent,
  RunId,
  TenantId,
  UsageRecord,
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
  /** `'stub'` (default) — synthesised outputs; `'live'` — real engine adapter (NYI). */
  readonly mode?: 'stub' | 'live';
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
  readonly mode: 'stub' | 'live';
  readonly brief: string;
  readonly events: ReadonlyArray<RunEventCapture>;
  readonly spawns: ReadonlyArray<SpawnRecord>;
  readonly orchestration: OrchestrationResult;
  readonly loadedSpecs: ReadonlyArray<string>;
  readonly missingSpecs: ReadonlyArray<{ agent: string; error: string }>;
  readonly postMortem: string;
}

export interface RunEventCapture {
  readonly type: RunEvent['type'];
  readonly payload: unknown;
}

export async function runDryRun(opts: DryRunOpts = {}): Promise<DryRunResult> {
  const mode: 'stub' | 'live' = opts.mode ?? 'stub';
  if (mode === 'live') {
    throw new Error(
      'agency-dry-run: live mode requires a full EngineRuntimeAdapter and frontier credentials; not yet wired',
    );
  }
  const brief = opts.brief ?? HEALTHZ_DB_BRIEF;

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

function failure(
  mode: 'stub' | 'live',
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
  mode: 'stub' | 'live';
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
  const spawnLines = args.spawns.map(
    (s, i) =>
      `${i + 1}. **${s.agent}** → ${typeof s.output === 'object' ? Object.keys(s.output as object).join(', ') : String(s.output).slice(0, 60)} (${s.durationMs} ms)`,
  );
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
      ? '_Stub mode: outputs are synthesised. Re-run with mode: "live" against a real EngineRuntimeAdapter for the production dry-run._'
      : '',
  ];
  return lines.filter((l) => l !== '').join('\n');
}
