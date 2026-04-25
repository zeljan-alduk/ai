/**
 * `/v1/eval/...` and `/v1/agents/:name/promote` — eval-harness HTTP surface.
 *
 * Wave-6 routes used by the web `/eval` page and the `aldo` CLI:
 *   - GET    /v1/eval/suites                     ListSuitesResponse
 *   - GET    /v1/eval/suites/:name               full EvalSuite (latest)
 *   - POST   /v1/eval/sweeps                     StartSweepResponse (queued)
 *   - GET    /v1/eval/sweeps?agent=&status=...   ListSweepsResponse
 *   - GET    /v1/eval/sweeps/:id                 full Sweep (with cells)
 *   - POST   /v1/agents/:name/promote            PromoteAgentResponse
 *
 * Engineer A is shipping `@aldo-ai/eval` with `SweepRunner.run(suite,
 * models)` and `PromotionGate.check(agentSpec, models)` in parallel. We
 * keep their interfaces pinned in `eval-store.ts` (TODO(integrate)) and
 * inject either the real implementations or test stubs through the
 * Hono-route factory's `EvalDeps` argument. The factory falls back to a
 * no-op stub so the API can boot before Engineer A's package lands.
 *
 * LLM-agnostic: model identifiers are opaque `provider.model` strings and
 * the runner / gate decide how to dispatch them through the gateway.
 *
 * Sweep execution is asynchronous: POST /v1/eval/sweeps returns
 * immediately with the sweep id; an in-process background task drives
 * the runner and persists results. v0 deliberately does not use an
 * external queue — once we have one (Postgres LISTEN/NOTIFY or a real
 * job queue) it can land behind the same `enqueueSweep` seam.
 */

import { randomUUID } from 'node:crypto';
import {
  ListSuitesResponse,
  ListSweepsResponse,
  PromoteAgentRequest,
  PromoteAgentResponse,
  StartSweepRequest,
  StartSweepResponse,
  Sweep,
} from '@aldo-ai/api-contract';
import type { EvalSuite, SweepStatus } from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import {
  PostgresSweepStore,
  type PromotionGate,
  type PromotionGateReport,
  type SweepRunner,
  type SweepStore,
  decodeSweepCursor,
} from '../eval-store.js';
// Re-export the engineer-A surface so tests + future integrations can
// import from the same module they import the route factory from.
export type { PromotionGate, PromotionGateReport, SweepRunner, SweepStore };
import { notFound, validationError } from '../middleware/error.js';

// ---------------------------------------------------------------------------
// Eval deps — injected by the app builder, swappable in tests.
// ---------------------------------------------------------------------------

export interface EvalDeps {
  readonly store: SweepStore;
  readonly runner: SweepRunner;
  readonly gate: PromotionGate;
  /**
   * Schedules `fn` to run after the current task. Tests override this to
   * await the work synchronously so assertions don't race the runner.
   * v0 default is `queueMicrotask` so the route returns `queued` before
   * the runner flips status to `running`.
   */
  readonly scheduleSweep: (fn: () => Promise<void>) => void;
  /** Injectable clock for deterministic timestamps in tests. */
  readonly now: () => Date;
}

/** Build the default eval deps using the registry + a Postgres store. */
export function defaultEvalDeps(deps: Deps): EvalDeps {
  return {
    store: new PostgresSweepStore(deps.db),
    runner: noopRunner,
    gate: noopGate,
    scheduleSweep: (fn) => {
      queueMicrotask(() => {
        void fn();
      });
    },
    now: () => new Date(),
  };
}

// TODO(integrate): replace these no-ops with the real symbols from
// `@aldo-ai/eval` once the package ships.
const noopRunner: SweepRunner = {
  async run() {
    return [];
  },
};

const noopGate: PromotionGate = {
  async check() {
    return [];
  },
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const SuiteNameParam = z.object({ name: z.string().min(1) });
const SweepIdParam = z.object({ id: z.string().min(1) });
const AgentNameParam = z.object({ name: z.string().min(1) });

const ListSweepsQuery = z.object({
  agent: z.string().optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export interface EvalRouteOptions {
  /** Override eval deps (tests inject a stub runner / gate / store). */
  readonly evalDeps?: EvalDeps;
}

export function evalRoutes(deps: Deps, opts: EvalRouteOptions = {}): Hono {
  const evalDeps = opts.evalDeps ?? defaultEvalDeps(deps);
  const app = new Hono();

  // ----- suites ----------------------------------------------------------

  app.get('/v1/eval/suites', async (c) => {
    const suites = await evalDeps.store.listSuites();
    const body = ListSuitesResponse.parse({ suites });
    return c.json(body);
  });

  app.get('/v1/eval/suites/:name', async (c) => {
    const parsed = SuiteNameParam.safeParse({ name: c.req.param('name') });
    if (!parsed.success) {
      throw validationError('invalid suite name', parsed.error.issues);
    }
    const suite = await evalDeps.store.getSuiteLatest(parsed.data.name);
    if (suite === null) {
      throw notFound(`suite not found: ${parsed.data.name}`);
    }
    return c.json(suite);
  });

  // ----- sweeps ----------------------------------------------------------

  app.post('/v1/eval/sweeps', async (c) => {
    const json = await readJsonBody(c);
    const parsed = StartSweepRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid sweep request', parsed.error.issues);
    }
    const req = parsed.data;
    const suite =
      req.suiteVersion !== undefined
        ? await evalDeps.store.getSuiteVersion(req.suiteName, req.suiteVersion)
        : await evalDeps.store.getSuiteLatest(req.suiteName);
    if (suite === null) {
      throw notFound(`suite not found: ${req.suiteName}`);
    }

    const agentVersion = req.agentVersion ?? (await resolveAgentVersion(deps, suite.agent));

    const sweepId = randomUUID();
    const startedAt = evalDeps.now().toISOString();
    await evalDeps.store.putSweep({
      id: sweepId,
      suiteName: suite.name,
      suiteVersion: suite.version,
      agentName: suite.agent,
      agentVersion,
      models: req.models,
      status: 'queued' satisfies SweepStatus,
      startedAt,
    });

    evalDeps.scheduleSweep(() => runSweep(evalDeps, sweepId, suite, req.models));

    const body = StartSweepResponse.parse({ sweepId });
    return c.json(body);
  });

  app.get('/v1/eval/sweeps', async (c) => {
    const parsed = ListSweepsQuery.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      throw validationError('invalid query', parsed.error.issues);
    }
    const q = parsed.data;
    const cursor = q.cursor !== undefined ? decodeSweepCursor(q.cursor) : undefined;
    if (q.cursor !== undefined && cursor === null) {
      throw validationError('invalid cursor');
    }
    const result = await evalDeps.store.listSweeps({
      ...(q.agent !== undefined ? { agent: q.agent } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      limit: q.limit,
      ...(cursor !== undefined && cursor !== null ? { cursor } : {}),
    });
    // The contract's ListSweepsResponse only carries the array — no
    // pagination meta. We still page on the server, but the cursor leaks
    // out via a future contract addition; for v0 the page size is 50 by
    // default and clients see the slice.
    const body = ListSweepsResponse.parse({ sweeps: result.sweeps });
    return c.json(body);
  });

  app.get('/v1/eval/sweeps/:id', async (c) => {
    const parsed = SweepIdParam.safeParse({ id: c.req.param('id') });
    if (!parsed.success) {
      throw validationError('invalid sweep id', parsed.error.issues);
    }
    const sweep = await evalDeps.store.getSweep(parsed.data.id);
    if (sweep === null) {
      throw notFound(`sweep not found: ${parsed.data.id}`);
    }
    const body = Sweep.parse(sweep);
    return c.json(body);
  });

  // ----- promote ---------------------------------------------------------

  app.post('/v1/agents/:name/promote', async (c) => {
    const idParsed = AgentNameParam.safeParse({ name: c.req.param('name') });
    if (!idParsed.success) {
      throw validationError('invalid agent name', idParsed.error.issues);
    }
    const json = await readJsonBody(c);
    // The agentName param overrides any value in the body so the URL is
    // load-bearing; we still require the body to validate as a whole.
    const merged = isObject(json) ? { ...json, agentName: idParsed.data.name } : json;
    const parsed = PromoteAgentRequest.safeParse(merged);
    if (!parsed.success) {
      throw validationError('invalid promote request', parsed.error.issues);
    }
    const req = parsed.data;

    let agentSpec: unknown;
    try {
      agentSpec = await deps.registry.load({ name: req.agentName, version: req.version });
    } catch {
      throw notFound(`agent not found: ${req.agentName}@${req.version}`);
    }

    const reports = await evalDeps.gate.check(agentSpec, req.models);
    const failedSuites = reports.filter((r) => !r.passed).map((r) => r.suiteName);
    const sweepIds = reports.map((r) => r.sweepId);
    const passed = failedSuites.length === 0;

    if (passed) {
      await deps.registry.promote(
        { name: req.agentName, version: req.version },
        { sweepIds, suites: reports.map((r) => ({ name: r.suiteName, version: r.suiteVersion })) },
      );
    }

    const body = PromoteAgentResponse.parse({
      promoted: passed,
      sweepIds,
      failedSuites,
    });
    return c.json(body);
  });

  return app;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function runSweep(
  evalDeps: EvalDeps,
  sweepId: string,
  suite: EvalSuite,
  models: readonly string[],
): Promise<void> {
  // Move queued -> running so callers polling the detail endpoint can
  // distinguish "not started" from "in flight".
  await evalDeps.store.updateSweepStatus(sweepId, 'running', null);
  try {
    const cells = await evalDeps.runner.run(suite, models);
    await evalDeps.store.putCells(sweepId, cells);
    await evalDeps.store.updateSweepStatus(sweepId, 'completed', evalDeps.now().toISOString());
  } catch {
    // Engineer A's runner is responsible for surfacing fine-grained
    // cell-level failures; if it throws outright, we mark the sweep
    // failed so the UI doesn't hang on a "running" row.
    await evalDeps.store.updateSweepStatus(sweepId, 'failed', evalDeps.now().toISOString());
  }
}

async function resolveAgentVersion(deps: Deps, agentName: string): Promise<string> {
  // Best-effort: prefer the promoted version if any, fall back to "latest".
  // If the registry doesn't know about the agent we still allow the sweep
  // to be queued — the runner is the place that ultimately fails when the
  // agent can't be loaded.
  try {
    const promoted = await deps.registry.promotedVersion(agentName);
    if (promoted !== null) return promoted;
    const versions = await deps.registry.listVersions(agentName);
    return versions[versions.length - 1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
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
