/**
 * Wave-16 — `/v1/eval/sweeps/:id/cluster` route test.
 *
 * Spins up the eval harness with a stub runner so we can stamp a known
 * set of failed cells, then drives the clustering route and asserts
 * the resulting cluster set looks like the on-disk
 * `failure-cluster.ts` library produced.
 */

import { randomBytes } from 'node:crypto';
import {
  ApiError,
  ClusterSweepResponse,
  type EvalSuite,
  StartSweepResponse,
  type SweepCellResult,
} from '@aldo-ai/api-contract';
import { AgentRegistry, PostgresStorage } from '@aldo-ai/registry';
import { type SqlClient, fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { buildApp } from '../src/app.js';
import { signSessionToken } from '../src/auth/jwt.js';
import { type Deps, SEED_TENANT_UUID, createDeps } from '../src/deps.js';
import { PostgresSweepStore } from '../src/eval-store.js';
import type { EvalDeps, SweepRunner } from '../src/routes/eval.js';
import { seedAgent } from './_setup.js';

interface ClusterEnv {
  readonly deps: Deps;
  readonly app: { request: (path: string, init?: RequestInit) => Promise<Response> };
  readonly db: SqlClient;
  setRunnerResult(cells: readonly SweepCellResult[]): void;
  drainSweeps(): Promise<void>;
  teardown(): Promise<void>;
}

const SUITE_YAML = `name: cluster-smoke
version: 1.0.0
description: cluster smoke
agent: reviewer
passThreshold: 0.5
cases:
  - id: c1
    input: q
    expect:
      kind: contains
      value: "x"
`;

async function setupClusterEnv(): Promise<ClusterEnv> {
  const db = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(db);

  let runnerResult: readonly SweepCellResult[] = [];
  const pending: Promise<void>[] = [];
  const runner: SweepRunner = {
    async run() {
      return runnerResult;
    },
  };
  const evalDeps: EvalDeps = {
    store: new PostgresSweepStore(db),
    runner,
    gate: {
      async check() {
        return [];
      },
    },
    scheduleSweep: (fn) => {
      pending.push(fn());
    },
    now: () => new Date('2026-04-25T12:00:00.000Z'),
  };

  const registry = new AgentRegistry({ storage: new PostgresStorage({ client: db }) });
  const signingKey = new Uint8Array(randomBytes(32));
  const deps = await createDeps({ DATABASE_URL: '' }, { db, registry, evalDeps, signingKey });
  // Seed the user
  await db.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')
     ON CONFLICT (id) DO NOTHING`,
    ['cluster-tester', 'cluster@aldo.test'],
  );
  await db.query(
    `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')
     ON CONFLICT (tenant_id, user_id) DO NOTHING`,
    [SEED_TENANT_UUID, 'cluster-tester'],
  );
  const token = await signSessionToken(
    { sub: 'cluster-tester', tid: SEED_TENANT_UUID, slug: 'default', role: 'owner' },
    signingKey,
  );
  const rawApp = buildApp(deps, { log: false });
  const app = {
    request: async (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers: Record<string, string> = {};
      const provided = (init.headers ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(provided)) {
        if (typeof v === 'string') headers[k] = v;
      }
      if (headers.Authorization === undefined && headers.authorization === undefined) {
        headers.Authorization = `Bearer ${token}`;
      }
      return rawApp.request(path, { ...init, headers });
    },
  };

  return {
    deps,
    app,
    db,
    setRunnerResult(cells) {
      runnerResult = cells;
    },
    async drainSweeps() {
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

let env: ClusterEnv;

beforeAll(async () => {
  env = await setupClusterEnv();
  // Seed the agent + suite the sweep references.
  await seedAgent(env.db, {
    name: 'reviewer',
    owner: 'support@aldo',
    version: '1.0.0',
    team: 'support',
    description: 'reviewer',
    promoted: true,
  });
  const suite = YAML.parse(SUITE_YAML) as EvalSuite;
  await new PostgresSweepStore(env.db).putSuite(suite, SUITE_YAML);
});

afterAll(async () => {
  await env.teardown();
});

describe('POST /v1/eval/sweeps/:id/cluster', () => {
  it('clusters failed cells of a completed sweep and persists rows', async () => {
    // Stamp a sweep with a mix of failed cells whose outputs share a
    // few obvious top terms — the bag-of-words clusterer should bucket
    // them deterministically.
    const failures: SweepCellResult[] = [
      {
        caseId: 'c1',
        model: 'opaque.model-a',
        passed: false,
        score: 0,
        output: 'sql injection vulnerability in the database query',
        costUsd: 0,
        durationMs: 1,
      },
      {
        caseId: 'c2',
        model: 'opaque.model-a',
        passed: false,
        score: 0,
        output: 'sql injection found inside the database call',
        costUsd: 0,
        durationMs: 1,
      },
      {
        caseId: 'c3',
        model: 'opaque.model-a',
        passed: true,
        score: 1,
        output: 'looks safe',
        costUsd: 0,
        durationMs: 1,
      },
    ];
    env.setRunnerResult(failures);
    const start = await env.app.request('/v1/eval/sweeps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suiteName: 'cluster-smoke',
        suiteVersion: '1.0.0',
        models: ['opaque.model-a'],
      }),
    });
    expect(start.status).toBe(200);
    const sweep = StartSweepResponse.parse(await start.json());
    await env.drainSweeps();

    const res = await env.app.request(`/v1/eval/sweeps/${sweep.sweepId}/cluster`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = ClusterSweepResponse.parse(await res.json());
    expect(body.failedCount).toBe(2);
    expect(body.clusters.length).toBeGreaterThanOrEqual(1);
    // The clusterer should surface a top-terms label that mentions
    // the load-bearing word in the failed outputs.
    expect(body.clusters[0]?.label.toLowerCase()).toMatch(/sql|injection|database/);

    // Re-running clusters MUST replace the rows, not append.
    const res2 = await env.app.request(`/v1/eval/sweeps/${sweep.sweepId}/cluster`, {
      method: 'POST',
    });
    const body2 = ClusterSweepResponse.parse(await res2.json());
    expect(body2.clusters.length).toBe(body.clusters.length);
  });

  it('returns 404 for an unknown sweep', async () => {
    const res = await env.app.request('/v1/eval/sweeps/missing-id/cluster', {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });
});
