/**
 * Sweep runner.
 *
 * Given an `EvalSuite`, a list of opaque `provider.model` strings, and a
 * factory that builds a Runtime + AgentRegistry pinned to a single model,
 * the runner produces one `SweepCellResult` per (case, model) cell plus a
 * `byModel` aggregate (passed / total / usd).
 *
 * LLM-agnostic: the runner never branches on a provider name. The
 * `RuntimeFactory` receives the opaque model string; whoever wires the
 * factory (the CLI in our case) is responsible for translating that string
 * into a gateway routing decision. The runner simply records it on each
 * cell so the report is reproducible.
 *
 * Concurrency: cells inside a single (model) column run sequentially to
 * keep token budgets predictable; columns themselves run in parallel
 * (`Promise.all` over models). Tests can pass `concurrency: 'serial'` to
 * make event ordering deterministic.
 */

import { randomUUID } from 'node:crypto';
import type {
  EvalCase,
  EvalSuite,
  Sweep,
  SweepCellResult,
  SweepStatus,
} from '@aldo-ai/api-contract';
import type {
  AgentRef,
  AgentRegistry,
  ModelGateway,
  RunEvent,
  Runtime,
  UsageRecord,
} from '@aldo-ai/types';
import { evaluate } from './evaluators/index.js';
import { type SweepStore, InMemorySweepStore } from './sweep-store.js';

export interface RuntimePerModel {
  readonly runtime: Runtime;
  readonly agentRegistry: AgentRegistry;
  /**
   * The gateway used by the rubric judge. Defaults to the same gateway
   * the runtime is wired to — exposing it explicitly lets sweeps point
   * the judge at a different model class without re-wiring the runtime.
   */
  readonly judgeGateway?: ModelGateway;
  readonly tenant?: string;
}

/** Factory: given an opaque `provider.model` string, return a runtime bundle. */
export type RuntimeFactory = (model: string) => RuntimePerModel | Promise<RuntimePerModel>;

export interface SweepOptions {
  readonly suite: EvalSuite;
  readonly models: readonly string[];
  /** Resolves an agent name -> agent version. Defaults to suite.agent + 'latest'. */
  readonly agentVersion?: string;
  readonly factory: RuntimeFactory;
  /** Optional persistent store; defaults to in-memory. */
  readonly store?: SweepStore;
  /** Default 'parallel' across models; 'serial' linearises everything. */
  readonly concurrency?: 'serial' | 'parallel';
  /**
   * Optional clock + id source for deterministic tests. The runner uses
   * Date.now() and randomUUID() by default.
   */
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface SweepResult {
  readonly sweep: Sweep;
}

export async function runSweep(opts: SweepOptions): Promise<SweepResult> {
  const store = opts.store ?? new InMemorySweepStore();
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? (() => randomUUID());
  const concurrency = opts.concurrency ?? 'parallel';

  const sweepId = newId();
  const startedAt = now().toISOString();
  const initial: Sweep = {
    id: sweepId,
    suiteName: opts.suite.name,
    suiteVersion: opts.suite.version,
    agentName: opts.suite.agent,
    agentVersion: opts.agentVersion ?? 'latest',
    models: [...opts.models],
    status: 'running' satisfies SweepStatus,
    startedAt,
    endedAt: null,
    byModel: {},
    cells: [],
  };
  await store.create(initial);

  let cells: SweepCellResult[] = [];
  try {
    if (concurrency === 'serial') {
      for (const model of opts.models) {
        const col = await runColumn(model, opts);
        cells = cells.concat(col);
      }
    } else {
      const columns = await Promise.all(opts.models.map((m) => runColumn(m, opts)));
      cells = columns.flat();
    }
  } catch (e) {
    const final: Sweep = {
      ...initial,
      status: 'failed',
      endedAt: now().toISOString(),
      cells,
      byModel: aggregate(cells),
    };
    await store.update(final);
    throw e;
  }

  const final: Sweep = {
    ...initial,
    status: 'completed',
    endedAt: now().toISOString(),
    cells,
    byModel: aggregate(cells),
  };
  await store.update(final);
  return { sweep: final };
}

/** Execute every case for a single model column. */
async function runColumn(model: string, opts: SweepOptions): Promise<SweepCellResult[]> {
  const out: SweepCellResult[] = [];
  const bundle = await opts.factory(model);
  for (const c of opts.suite.cases) {
    out.push(await runCell(c, model, opts.suite, bundle));
  }
  return out;
}

/** Execute one (case, model) cell. */
async function runCell(
  c: EvalCase,
  model: string,
  suite: EvalSuite,
  bundle: RuntimePerModel,
): Promise<SweepCellResult> {
  const startedAt = Date.now();
  const ref: AgentRef = { name: suite.agent };

  let output = '';
  let usd = 0;
  let invocationError: string | null = null;
  try {
    const run = await bundle.runtime.spawn(ref, c.input);
    for await (const ev of run.events()) {
      if (isAssistantTextMessage(ev)) {
        output += extractAssistantText(ev);
      }
      if (ev.type === 'run.completed') {
        const p = ev.payload as { output?: unknown };
        if (typeof p.output === 'string' && p.output.length > 0) {
          output = p.output;
        }
      }
      const u = extractUsage(ev);
      if (u !== undefined) usd += u.usd;
      if (ev.type === 'error') {
        const p = ev.payload as { message?: string; reason?: string };
        invocationError = p.message ?? p.reason ?? 'unknown error';
      }
    }
  } catch (e) {
    invocationError = e instanceof Error ? e.message : String(e);
  }

  const durationMs = Date.now() - startedAt;

  if (invocationError !== null) {
    return {
      caseId: c.id,
      model,
      passed: false,
      score: 0,
      output,
      detail: { error: invocationError },
      costUsd: usd,
      durationMs,
    };
  }

  const evalResult = await evaluate(output, c.expect, {
    ...(bundle.judgeGateway !== undefined ? { judgeGateway: bundle.judgeGateway } : {}),
    ...(bundle.tenant !== undefined ? { tenant: bundle.tenant } : {}),
  });

  return {
    caseId: c.id,
    model,
    passed: evalResult.passed,
    score: evalResult.score,
    output,
    ...(evalResult.detail !== undefined ? { detail: evalResult.detail } : {}),
    costUsd: usd,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// helpers

function isAssistantTextMessage(ev: RunEvent): boolean {
  if (ev.type !== 'message') return false;
  const m = ev.payload as { role?: string };
  return m.role === 'assistant';
}

function extractAssistantText(ev: RunEvent): string {
  const m = ev.payload as {
    content?: ReadonlyArray<{ type?: string; text?: string }>;
  };
  if (!Array.isArray(m.content)) return '';
  let s = '';
  for (const part of m.content) {
    if (part.type === 'text' && typeof part.text === 'string') s += part.text;
  }
  return s;
}

function extractUsage(ev: RunEvent): UsageRecord | undefined {
  const p = ev.payload as { usage?: UsageRecord } | undefined;
  if (!p) return undefined;
  if (p.usage && typeof p.usage.usd === 'number') return p.usage;
  return undefined;
}

/** Compute per-model {passed,total,usd} from the cell list. */
export function aggregate(
  cells: readonly SweepCellResult[],
): Record<string, { passed: number; total: number; usd: number }> {
  const out: Record<string, { passed: number; total: number; usd: number }> = {};
  for (const c of cells) {
    const slot = out[c.model] ?? { passed: 0, total: 0, usd: 0 };
    slot.total += 1;
    if (c.passed) slot.passed += 1;
    slot.usd += c.costUsd;
    out[c.model] = slot;
  }
  return out;
}

/**
 * Compute the weighted-pass ratio for a single model: sum of `weight * (passed?1:0)`
 * divided by sum of weights. Rated against `suite.passThreshold` to decide green.
 */
export function weightedPassRatio(
  suite: EvalSuite,
  cells: readonly SweepCellResult[],
  model: string,
): number {
  const byCaseId = new Map(suite.cases.map((c) => [c.id, c]));
  let num = 0;
  let den = 0;
  for (const cell of cells) {
    if (cell.model !== model) continue;
    const c = byCaseId.get(cell.caseId);
    const w = c?.weight ?? 1;
    den += w;
    if (cell.passed) num += w;
  }
  if (den === 0) return 0;
  return num / den;
}
