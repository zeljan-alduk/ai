/**
 * `/v1/eval/playground/*` — Wave-3 (Tier-3.1) evaluator scorer playground.
 *
 * Closes the Braintrust playground / LangSmith evaluators-as-product
 * gap: pick one evaluator + one dataset (+ optional sample size), hit
 * Run, watch per-row scores stream in alongside aggregate stats. The
 * playground does NOT persist to the suite store — it's evaluator
 * development, not suite execution. Runs live in an in-process map and
 * are GC'd after a short TTL so a long-lived API process doesn't grow
 * unbounded. A future "Save as suite" promotion endpoint converts a
 * playground session into a permanent suite + sweep.
 *
 * Endpoints:
 *   POST /v1/eval/playground/run                — start a transient run
 *   GET  /v1/eval/playground/runs/:id           — poll status + rows + aggregate
 *
 * Live updates use the same polling shape as `/eval/sweeps/[id]` —
 * GET `/v1/eval/playground/runs/:id` returns the full snapshot every
 * 1.5s on the client until status flips to terminal. We deliberately
 * do NOT add an SSE channel for v0; the existing pattern is what the
 * runs/timeline + sweep-view ship today.
 *
 * LLM-agnostic: only `llm_judge` evaluator kinds touch a model, and
 * they go through the gateway (capability-class string only) the same
 * way the existing /v1/evaluators/:id/test path does.
 *
 * Re-uses the existing evaluator runner (`runStoredEvaluator` from
 * `@aldo-ai/eval`) — no scoring logic is duplicated here.
 */

import { randomUUID } from 'node:crypto';
import {
  GetPlaygroundRunResponse,
  type PlaygroundAggregate,
  type PlaygroundRun,
  type PlaygroundRunStatus,
  type PlaygroundScoredRow,
  StartPlaygroundRunRequest,
  StartPlaygroundRunResponse,
} from '@aldo-ai/api-contract';
import { type EvaluatorContext, runStoredEvaluator } from '@aldo-ai/eval';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth, requireRole } from '../auth/middleware.js';
import { type EvaluatorRow, getEvaluatorById } from '../datasets/evaluators-store.js';
import { type DatasetExampleRow, getDatasetById, listExamples } from '../datasets/store.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';
import type { JudgeGateway } from './evaluators.js';

// ---------------------------------------------------------------------------
// In-process run store
// ---------------------------------------------------------------------------

interface StoredRun {
  readonly tenantId: string;
  run: PlaygroundRun;
}

/**
 * Module-scoped registry. Process-local, per-tenant scoped on read.
 * GC'd on a 30-minute TTL after status reaches terminal — long enough
 * for the UI to load the final snapshot, short enough to not grow
 * unbounded. Tests inject a custom store via the deps seam below.
 */
export interface PlaygroundRunStore {
  put(id: string, run: StoredRun): void;
  patch(id: string, fn: (existing: StoredRun) => StoredRun): boolean;
  get(id: string, tenantId: string): PlaygroundRun | null;
}

class InMemoryPlaygroundRunStore implements PlaygroundRunStore {
  private readonly runs = new Map<string, StoredRun>();
  private readonly retentionMs: number;

  constructor(retentionMs = 30 * 60 * 1000) {
    this.retentionMs = retentionMs;
  }

  put(id: string, run: StoredRun): void {
    this.runs.set(id, run);
    this.scheduleSweep();
  }

  patch(id: string, fn: (existing: StoredRun) => StoredRun): boolean {
    const cur = this.runs.get(id);
    if (cur === undefined) return false;
    this.runs.set(id, fn(cur));
    return true;
  }

  get(id: string, tenantId: string): PlaygroundRun | null {
    const cur = this.runs.get(id);
    if (cur === undefined) return null;
    if (cur.tenantId !== tenantId) return null;
    return cur.run;
  }

  private scheduleSweep(): void {
    // Best-effort retention sweep on each put. Runs in O(n) over all
    // stored runs; n is bounded by the rate-limiter on the playground
    // route so this is fine for v0. unref() so a stale timer never
    // pins the process alive at shutdown.
    const t = setTimeout(() => {
      const cutoff = Date.now() - this.retentionMs;
      // Materialise to an array so the iterator works under tsconfig's
      // ES2015 target (the api package's target setting blocks bare
      // Map iteration in `for…of`).
      const entries = Array.from(this.runs.entries());
      for (const [id, sr] of entries) {
        const ended = sr.run.endedAt;
        if (ended === null) continue;
        const endedMs = Date.parse(ended);
        if (Number.isFinite(endedMs) && endedMs < cutoff) {
          this.runs.delete(id);
        }
      }
    }, this.retentionMs).unref?.();
    void t;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const RunIdParam = z.object({ id: z.string().min(1) });

export interface PlaygroundRouteOptions {
  /** Override the in-process run store (tests use a deterministic stub). */
  readonly store?: PlaygroundRunStore;
  /**
   * Schedules `fn` to run after the current task. Default is a
   * microtask so the route returns before the runner starts; tests
   * override to await synchronously so assertions don't race.
   */
  readonly scheduleScore?: (fn: () => Promise<void>) => void;
  /** Injectable clock for deterministic timestamps in tests. */
  readonly now?: () => Date;
  /**
   * Override the example sampler. Default uses Math.random; tests pass
   * a seeded shuffle so the sample-size code path is deterministic.
   */
  readonly sampler?: <T>(rows: readonly T[], k: number) => T[];
}

export function evalPlaygroundRoutes(deps: Deps, opts: PlaygroundRouteOptions = {}): Hono {
  const app = new Hono();
  const store = opts.store ?? new InMemoryPlaygroundRunStore();
  const scheduleScore =
    opts.scheduleScore ??
    ((fn) => {
      queueMicrotask(() => {
        void fn();
      });
    });
  const now = opts.now ?? (() => new Date());
  const sampler = opts.sampler ?? defaultRandomSample;

  // --------------------------------------------------------------- POST run
  app.post('/v1/eval/playground/run', async (c) => {
    requireRole(c, 'member');
    const json = await readJsonBody(c);
    const parsed = StartPlaygroundRunRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid playground run request', parsed.error.issues);
    }
    const auth = getAuth(c);

    // Resolve the evaluator + dataset up-front — fail fast if either
    // is missing so the caller doesn't get a transient run id for
    // something that will immediately error.
    const evaluator = await getEvaluatorById(deps.db, {
      id: parsed.data.evaluatorId,
      tenantId: auth.tenantId,
    });
    if (evaluator === null) {
      throw notFound(`evaluator not found: ${parsed.data.evaluatorId}`);
    }
    const dataset = await getDatasetById(deps.db, {
      id: parsed.data.datasetId,
      tenantId: auth.tenantId,
    });
    if (dataset === null) {
      throw notFound(`dataset not found: ${parsed.data.datasetId}`);
    }

    // Pull every example for the dataset. The /v1/datasets/:id/examples
    // route paginates for the UI, but the playground needs the full
    // set so the sampler can pick uniformly. Cap defensively at 1000
    // rows — if a customer wants to score a bigger dataset they should
    // use /eval/sweeps which is built for it.
    const all = await listExamples(deps.db, { datasetId: dataset.id, limit: 1000 });
    const totalAvailable = all.rows.length;
    const target = parsed.data.sampleSize ?? totalAvailable;
    const sampleSize = Math.min(target, totalAvailable);
    const examples =
      parsed.data.sampleSize !== undefined ? sampler(all.rows, sampleSize) : all.rows;

    const runId = `pgr_${randomUUID()}`;
    const startedAt = now().toISOString();
    const initial: PlaygroundRun = {
      id: runId,
      evaluatorId: evaluator.id,
      evaluatorName: evaluator.name,
      evaluatorKind: evaluator.kind,
      datasetId: dataset.id,
      datasetName: dataset.name,
      sampleSize,
      status: 'running' satisfies PlaygroundRunStatus,
      startedAt,
      endedAt: null,
      rows: [],
      aggregate: emptyAggregate(sampleSize),
    };
    store.put(runId, { tenantId: auth.tenantId, run: initial });

    scheduleScore(() =>
      scoreRun({
        store,
        runId,
        tenantId: auth.tenantId,
        evaluator,
        examples,
        judge: deps.judge,
        now,
      }),
    );

    const body = StartPlaygroundRunResponse.parse({ runId });
    return c.json(body, 202);
  });

  // ---------------------------------------------------------------- GET run
  app.get('/v1/eval/playground/runs/:id', async (c) => {
    const idParsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid playground run id', idParsed.error.issues);
    }
    const auth = getAuth(c);
    const run = store.get(idParsed.data.id, auth.tenantId);
    if (run === null) {
      throw notFound(`playground run not found: ${idParsed.data.id}`);
    }
    const body = GetPlaygroundRunResponse.parse({ run });
    return c.json(body);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

interface ScoreRunArgs {
  readonly store: PlaygroundRunStore;
  readonly runId: string;
  readonly tenantId: string;
  readonly evaluator: EvaluatorRow;
  readonly examples: readonly DatasetExampleRow[];
  readonly judge: JudgeGateway | undefined;
  readonly now: () => Date;
}

async function scoreRun(args: ScoreRunArgs): Promise<void> {
  const { store, runId, evaluator, examples, judge, now } = args;
  try {
    for (const ex of examples) {
      const t0 = Date.now();
      const inputStr = stringify(ex.input);
      const expectedStr = ex.expected === null ? '' : stringify(ex.expected);
      // We score the example's `expected` value as the "output" — the
      // playground is for evaluator development against known data,
      // not for running an agent end-to-end. This mirrors how
      // Braintrust's playground populates the output column from the
      // dataset row when no chain/agent is bound.
      const output = expectedStr.length > 0 ? expectedStr : inputStr;

      const ctx: EvaluatorContext = {
        tenant: args.tenantId,
        ...(judge?.gateway !== undefined ? { judgeGateway: judge.gateway } : {}),
        ...(expectedStr.length > 0 ? { expected: expectedStr } : {}),
        ...(inputStr.length > 0 ? { input: inputStr } : {}),
      };

      let row: PlaygroundScoredRow;
      try {
        const result = await runStoredEvaluator(
          output,
          { id: evaluator.id, kind: evaluator.kind, config: evaluator.config },
          ctx,
        );
        const durationMs = Math.max(0, Date.now() - t0);
        row = {
          exampleId: ex.id,
          inputPreview: truncate(inputStr, 200),
          expectedPreview: truncate(expectedStr, 200),
          output: truncate(output, 400),
          passed: result.passed,
          score: clamp01(result.score),
          ...(result.detail !== undefined ? { detail: result.detail } : {}),
          durationMs,
          // Built-in evaluators are free; only llm_judge spends. The
          // runner doesn't surface a per-call cost yet — we stamp 0
          // and the aggregate panel will show the row's lack of cost.
          // When the gateway grows a per-call cost report (wave-12+
          // observability already tracks USD per usage_record) the
          // hook will land here.
          costUsd: 0,
        };
      } catch (err) {
        const durationMs = Math.max(0, Date.now() - t0);
        row = {
          exampleId: ex.id,
          inputPreview: truncate(inputStr, 200),
          expectedPreview: truncate(expectedStr, 200),
          output: truncate(output, 400),
          passed: false,
          score: 0,
          detail: { error: err instanceof Error ? err.message : String(err) },
          durationMs,
          costUsd: 0,
        };
      }

      // Atomically append the row + recompute aggregates.
      store.patch(runId, (existing) => {
        const rows = [...existing.run.rows, row];
        return {
          tenantId: existing.tenantId,
          run: {
            ...existing.run,
            rows,
            aggregate: aggregateFor(rows, existing.run.sampleSize),
          },
        };
      });
    }

    store.patch(runId, (existing) => ({
      tenantId: existing.tenantId,
      run: {
        ...existing.run,
        status: 'completed' satisfies PlaygroundRunStatus,
        endedAt: now().toISOString(),
      },
    }));
  } catch (err) {
    store.patch(runId, (existing) => ({
      tenantId: existing.tenantId,
      run: {
        ...existing.run,
        status: 'failed' satisfies PlaygroundRunStatus,
        endedAt: now().toISOString(),
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    }));
  }
}

// ---------------------------------------------------------------------------
// Aggregate math
// ---------------------------------------------------------------------------

export function aggregateFor(
  rows: readonly PlaygroundScoredRow[],
  sampleSize: number,
): PlaygroundAggregate {
  if (rows.length === 0) return emptyAggregate(sampleSize);
  let passed = 0;
  let totalScore = 0;
  let totalDurationMs = 0;
  let totalCostUsd = 0;
  let minScore = 1;
  let maxScore = 0;
  const scoresAsc: number[] = [];
  for (const r of rows) {
    if (r.passed) passed += 1;
    totalScore += r.score;
    totalDurationMs += r.durationMs;
    totalCostUsd += r.costUsd;
    if (r.score < minScore) minScore = r.score;
    if (r.score > maxScore) maxScore = r.score;
    scoresAsc.push(r.score);
  }
  scoresAsc.sort((a, b) => a - b);
  const failed = rows.length - passed;
  return {
    scored: rows.length,
    total: sampleSize,
    passed,
    failed,
    passRate: passed / rows.length,
    meanScore: totalScore / rows.length,
    p50Score: percentile(scoresAsc, 0.5),
    p95Score: percentile(scoresAsc, 0.95),
    minScore,
    maxScore,
    meanDurationMs: totalDurationMs / rows.length,
    totalCostUsd,
  };
}

function emptyAggregate(sampleSize: number): PlaygroundAggregate {
  return {
    scored: 0,
    total: sampleSize,
    passed: 0,
    failed: 0,
    passRate: 0,
    meanScore: 0,
    p50Score: 0,
    p95Score: 0,
    minScore: 0,
    maxScore: 0,
    meanDurationMs: 0,
    totalCostUsd: 0,
  };
}

/** Standard linear-interpolation percentile (Excel-PERCENTILE.INC). */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo] ?? 0;
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? 0;
  return loVal + (hiVal - loVal) * (rank - lo);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function defaultRandomSample<T>(rows: readonly T[], k: number): T[] {
  if (k >= rows.length) return [...rows];
  // Fisher-Yates partial shuffle.
  const arr = [...rows];
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    const tmp = arr[i];
    arr[i] = arr[j]!;
    arr[j] = tmp!;
  }
  return arr.slice(0, k);
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

async function readJsonBody(c: { req: { raw: Request } }): Promise<unknown> {
  const text = await c.req.raw.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw validationError('invalid JSON body');
  }
}
