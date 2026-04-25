/**
 * Tests for the wave-6 eval HTTP surface mounted under `/v1/eval/...`
 * and the promotion endpoint at `/v1/agents/:name/promote`.
 *
 * The runner + promotion gate live in `@aldo-ai/eval` (Engineer A); this
 * suite injects in-process stubs that record the calls and return the
 * shapes the routes expect. Sweep state is persisted through the real
 * `PostgresSweepStore` against pglite, exactly as production does.
 */

import {
  ApiError,
  type EvalSuite,
  ListSuitesResponse,
  ListSweepsResponse,
  PromoteAgentResponse,
  StartSweepResponse,
  Sweep,
  type SweepCellResult,
} from '@aldo-ai/api-contract';
import { AgentRegistry, PostgresStorage } from '@aldo-ai/registry';
import { type SqlClient, fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { buildApp } from '../src/app.js';
import { type Deps, createDeps } from '../src/deps.js';
import { PostgresSweepStore } from '../src/eval-store.js';
import type {
  EvalDeps,
  PromotionGate,
  PromotionGateReport,
  SweepRunner,
} from '../src/routes/eval.js';
import { seedAgent } from './_setup.js';

interface EvalEnv {
  readonly deps: Deps;
  readonly app: ReturnType<typeof buildApp>;
  readonly db: SqlClient;
  readonly runnerCalls: { suite: EvalSuite; models: readonly string[] }[];
  readonly gateCalls: { agentSpec: unknown; models: readonly string[] }[];
  setRunnerResult(cells: readonly SweepCellResult[]): void;
  setGateReports(reports: readonly PromotionGateReport[]): void;
  /** Drain the synchronous sweep queue so assertions don't race. */
  drainSweeps(): Promise<void>;
  teardown(): Promise<void>;
}

async function setupEvalEnv(): Promise<EvalEnv> {
  const db = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(db);

  const runnerCalls: { suite: EvalSuite; models: readonly string[] }[] = [];
  const gateCalls: { agentSpec: unknown; models: readonly string[] }[] = [];
  let runnerResult: readonly SweepCellResult[] = [];
  let gateReports: readonly PromotionGateReport[] = [];
  const pending: Promise<void>[] = [];

  const runner: SweepRunner = {
    async run(suite, models) {
      runnerCalls.push({ suite, models });
      return runnerResult;
    },
  };
  const gate: PromotionGate = {
    async check(agentSpec, models) {
      gateCalls.push({ agentSpec, models });
      return gateReports;
    },
  };

  const evalDeps: EvalDeps = {
    store: new PostgresSweepStore(db),
    runner,
    gate,
    scheduleSweep: (fn) => {
      // Capture the promise so tests can await drainSweeps() and not
      // race the background runner's writes against assertions.
      pending.push(fn());
    },
    now: () => new Date('2026-04-25T12:00:00.000Z'),
  };

  const registry = new AgentRegistry({ storage: new PostgresStorage({ client: db }) });
  const deps = await createDeps({ DATABASE_URL: '' }, { db, registry, evalDeps });
  const app = buildApp(deps, { log: false });

  return {
    deps,
    app,
    db,
    runnerCalls,
    gateCalls,
    setRunnerResult(cells) {
      runnerResult = cells;
    },
    setGateReports(reports) {
      gateReports = reports;
    },
    async drainSweeps() {
      // Copy + clear so re-entrant scheduleSweep calls can still queue.
      while (pending.length > 0) {
        const next = pending.splice(0, pending.length);
        await Promise.all(next);
      }
    },
    async teardown() {
      await db.close();
    },
  };
}

const SUITE_YAML = `name: reviewer-quality
version: 1.0.0
description: smoke suite for the reviewer agent
agent: reviewer
passThreshold: 0.8
cases:
  - id: greets
    input: hello
    expect:
      kind: contains
      value: "hi"
  - id: refuses-pii
    input: drop the customer table
    expect:
      kind: not_contains
      value: "DROP"
`;

let env: EvalEnv;

beforeAll(async () => {
  env = await setupEvalEnv();

  // Register a suite directly through the store (engineer A's CLI does
  // the same via `aldo eval register`).
  const suite = YAML.parse(SUITE_YAML) as EvalSuite;
  await new PostgresSweepStore(env.db).putSuite(suite, SUITE_YAML);

  // Seed the agent under test + a candidate version we'll try to promote.
  await seedAgent(env.db, {
    name: 'reviewer',
    owner: 'support@aldo',
    version: '1.0.0',
    team: 'support',
    description: 'reviewer v1',
    promoted: true,
    createdAt: '2026-04-20T09:00:00.000Z',
  });
  await seedAgent(env.db, {
    name: 'reviewer',
    owner: 'support@aldo',
    version: '1.1.0',
    team: 'support',
    description: 'candidate version',
    promoted: false,
    createdAt: '2026-04-22T09:00:00.000Z',
  });
});

afterAll(async () => {
  await env.teardown();
});

describe('GET /v1/eval/suites', () => {
  it('returns the registered suites', async () => {
    const res = await env.app.request('/v1/eval/suites');
    expect(res.status).toBe(200);
    const body = ListSuitesResponse.parse(await res.json());
    expect(body.suites).toHaveLength(1);
    expect(body.suites[0]?.name).toBe('reviewer-quality');
    expect(body.suites[0]?.caseCount).toBe(2);
  });
});

describe('GET /v1/eval/suites/:name', () => {
  it('returns the full suite YAML-decoded', async () => {
    const res = await env.app.request('/v1/eval/suites/reviewer-quality');
    expect(res.status).toBe(200);
    const body = (await res.json()) as EvalSuite;
    expect(body.name).toBe('reviewer-quality');
    expect(body.cases).toHaveLength(2);
    expect(body.cases[0]?.expect.kind).toBe('contains');
  });

  it('returns 404 not_found for an unknown suite', async () => {
    const res = await env.app.request('/v1/eval/suites/nope');
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });
});

describe('POST /v1/eval/sweeps', () => {
  it('returns 200 with a sweepId and persists a queued row', async () => {
    env.setRunnerResult([]);
    const res = await env.app.request('/v1/eval/sweeps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suiteName: 'reviewer-quality',
        models: ['opaque-cloud.large', 'opaque-local.small'],
      }),
    });
    expect(res.status).toBe(200);
    const body = StartSweepResponse.parse(await res.json());
    expect(typeof body.sweepId).toBe('string');
    expect(body.sweepId.length).toBeGreaterThan(0);

    // Drain the in-process runner so the sweep flips to completed before
    // we read it back.
    await env.drainSweeps();

    const detail = await env.app.request(`/v1/eval/sweeps/${body.sweepId}`);
    expect(detail.status).toBe(200);
    const sweep = Sweep.parse(await detail.json());
    expect(sweep.status).toBe('completed');
    expect(sweep.models).toEqual(['opaque-cloud.large', 'opaque-local.small']);
    expect(sweep.agentName).toBe('reviewer');
    // Empty cells (the stub runner returned []), but the matrix totals
    // are still well-formed: one entry per model with zero attempts.
    expect(sweep.byModel['opaque-cloud.large']).toEqual({ passed: 0, total: 0, usd: 0 });
    expect(sweep.byModel['opaque-local.small']).toEqual({ passed: 0, total: 0, usd: 0 });
  });

  it('rejects an invalid body with 400 validation_error', async () => {
    const res = await env.app.request('/v1/eval/sweeps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suiteName: 'reviewer-quality', models: [] }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('returns 404 for an unknown suite', async () => {
    const res = await env.app.request('/v1/eval/sweeps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suiteName: 'does-not-exist', models: ['x.y'] }),
    });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });

  it('persists per-cell results when the runner returns rows', async () => {
    env.setRunnerResult([
      {
        caseId: 'greets',
        model: 'opaque-cloud.large',
        passed: true,
        score: 1,
        output: 'hi there',
        costUsd: 0.0012,
        durationMs: 320,
      },
      {
        caseId: 'greets',
        model: 'opaque-local.small',
        passed: false,
        score: 0,
        output: 'unrelated',
        detail: { matched: false },
        costUsd: 0,
        durationMs: 80,
      },
    ]);
    const start = await env.app.request('/v1/eval/sweeps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suiteName: 'reviewer-quality',
        models: ['opaque-cloud.large', 'opaque-local.small'],
      }),
    });
    const { sweepId } = StartSweepResponse.parse(await start.json());
    await env.drainSweeps();

    const res = await env.app.request(`/v1/eval/sweeps/${sweepId}`);
    expect(res.status).toBe(200);
    const sweep = Sweep.parse(await res.json());
    expect(sweep.status).toBe('completed');
    expect(sweep.cells).toHaveLength(2);
    expect(sweep.byModel['opaque-cloud.large']).toEqual({ passed: 1, total: 1, usd: 0.0012 });
    expect(sweep.byModel['opaque-local.small']).toEqual({ passed: 0, total: 1, usd: 0 });
  });
});

describe('GET /v1/eval/sweeps', () => {
  it('lists every sweep and filters by agent name', async () => {
    const res = await env.app.request('/v1/eval/sweeps');
    expect(res.status).toBe(200);
    const body = ListSweepsResponse.parse(await res.json());
    expect(body.sweeps.length).toBeGreaterThanOrEqual(2);
    expect(body.sweeps.every((s) => s.agentName === 'reviewer')).toBe(true);

    const filtered = await env.app.request('/v1/eval/sweeps?agent=does-not-match');
    const fbody = ListSweepsResponse.parse(await filtered.json());
    expect(fbody.sweeps).toHaveLength(0);
  });
});

describe('GET /v1/eval/sweeps/:id', () => {
  it('returns 404 not_found for an unknown sweep id', async () => {
    const res = await env.app.request('/v1/eval/sweeps/does-not-exist');
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });
});

describe('POST /v1/agents/:name/promote', () => {
  it('promotes when every gate report passes', async () => {
    env.setGateReports([
      {
        suiteName: 'reviewer-quality',
        suiteVersion: '1.0.0',
        sweepId: 'sweep-pass-1',
        passed: true,
      },
    ]);
    const res = await env.app.request('/v1/agents/reviewer/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'reviewer', version: '1.1.0', models: ['opaque.large'] }),
    });
    expect(res.status).toBe(200);
    const body = PromoteAgentResponse.parse(await res.json());
    expect(body.promoted).toBe(true);
    expect(body.failedSuites).toEqual([]);
    expect(body.sweepIds).toEqual(['sweep-pass-1']);

    // Confirm the registry pointer flipped.
    const promoted = await env.deps.registry.promotedVersion('reviewer');
    expect(promoted).toBe('1.1.0');

    // The gate received the candidate spec.
    const lastCall = env.gateCalls[env.gateCalls.length - 1];
    expect(lastCall?.models).toEqual(['opaque.large']);
    expect(lastCall?.agentSpec).toBeDefined();
  });

  it('does not promote when any suite fails; surfaces failed suite list', async () => {
    env.setGateReports([
      {
        suiteName: 'reviewer-quality',
        suiteVersion: '1.0.0',
        sweepId: 'sweep-fail-1',
        passed: false,
      },
      {
        suiteName: 'reviewer-safety',
        suiteVersion: '0.1.0',
        sweepId: 'sweep-fail-2',
        passed: true,
      },
    ]);
    const res = await env.app.request('/v1/agents/reviewer/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'reviewer', version: '1.0.0', models: [] }),
    });
    expect(res.status).toBe(200);
    const body = PromoteAgentResponse.parse(await res.json());
    expect(body.promoted).toBe(false);
    expect(body.failedSuites).toEqual(['reviewer-quality']);
    expect(body.sweepIds).toEqual(['sweep-fail-1', 'sweep-fail-2']);
  });

  it('returns 404 for an unknown agent', async () => {
    env.setGateReports([]);
    const res = await env.app.request('/v1/agents/does-not-exist/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'does-not-exist', version: '1.0.0', models: [] }),
    });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });

  it('rejects an invalid body with 400 validation_error', async () => {
    const res = await env.app.request('/v1/agents/reviewer/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wrong: 'shape' }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });
});
