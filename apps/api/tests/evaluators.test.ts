/**
 * Wave-16 — `/v1/evaluators/*` route tests.
 *
 * Built-in evaluator kinds run their JS scoring; the `llm_judge` kind
 * is exercised against an in-memory ModelGateway stub so the test
 * doesn't reach for a real provider (LLM-agnostic per CLAUDE.md non-
 * negotiable #1).
 */

import { randomBytes } from 'node:crypto';
import {
  ApiError,
  Evaluator,
  ListEvaluatorsResponse,
  TestEvaluatorResponse,
} from '@aldo-ai/api-contract';
import { AgentRegistry, PostgresStorage } from '@aldo-ai/registry';
import { type SqlClient, fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import type { CallContext, CompletionRequest, Delta, ModelGateway } from '@aldo-ai/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { signSessionToken } from '../src/auth/jwt.js';
import { type Deps, SEED_TENANT_UUID, createDeps } from '../src/deps.js';

interface JudgeCall {
  readonly req: CompletionRequest;
  readonly ctx: CallContext;
}

interface EvalEnv {
  readonly deps: Deps;
  readonly app: { request: (path: string, init?: RequestInit) => Promise<Response> };
  readonly db: SqlClient;
  readonly judgeCalls: JudgeCall[];
  setJudgeReply(text: string): void;
  teardown(): Promise<void>;
}

async function setupEvaluatorEnv(): Promise<EvalEnv> {
  const db = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(db);

  const judgeCalls: JudgeCall[] = [];
  let nextReply = 'YES';
  const judgeGateway: ModelGateway = {
    complete(req: CompletionRequest, ctx: CallContext): AsyncIterable<Delta> {
      judgeCalls.push({ req, ctx });
      const reply = nextReply;
      return (async function* () {
        yield { textDelta: reply };
      })();
    },
    async embed() {
      throw new Error('not used in tests');
    },
  };

  const registry = new AgentRegistry({ storage: new PostgresStorage({ client: db }) });
  const signingKey = new Uint8Array(randomBytes(32));
  const deps = await createDeps(
    { DATABASE_URL: '' },
    {
      db,
      registry,
      signingKey,
      judge: { gateway: judgeGateway },
    },
  );
  // Seed the test user for tenant-membership lookups.
  await db.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')
     ON CONFLICT (id) DO NOTHING`,
    ['eval-tester', 'eval-tester@aldo.test'],
  );
  await db.query(
    `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')
     ON CONFLICT (tenant_id, user_id) DO NOTHING`,
    [SEED_TENANT_UUID, 'eval-tester'],
  );
  const token = await signSessionToken(
    { sub: 'eval-tester', tid: SEED_TENANT_UUID, slug: 'default', role: 'owner' },
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
    judgeCalls,
    setJudgeReply(text) {
      nextReply = text;
    },
    async teardown() {
      await db.close();
    },
  };
}

let env: EvalEnv;

beforeAll(async () => {
  env = await setupEvaluatorEnv();
});

afterAll(async () => {
  await env.teardown();
});

async function createEvaluator(payload: Record<string, unknown>): Promise<string> {
  const res = await env.app.request('/v1/evaluators', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(201);
  const body = Evaluator.parse(await res.json());
  return body.id;
}

describe('/v1/evaluators — CRUD', () => {
  it('creates and lists an evaluator', async () => {
    const id = await createEvaluator({
      name: 'contains-hi',
      kind: 'contains',
      config: { value: 'hi' },
    });
    const list = await env.app.request('/v1/evaluators');
    expect(list.status).toBe(200);
    const body = ListEvaluatorsResponse.parse(await list.json());
    expect(body.evaluators.find((e) => e.id === id)).toBeDefined();
  });

  it('reads an evaluator by id', async () => {
    const id = await createEvaluator({
      name: 'exact-ok',
      kind: 'exact_match',
      config: { value: 'ok' },
    });
    const res = await env.app.request(`/v1/evaluators/${id}`);
    expect(res.status).toBe(200);
    const body = Evaluator.parse(await res.json());
    expect(body.kind).toBe('exact_match');
    expect(body.ownedByMe).toBe(true);
  });

  it('rejects an invalid create body with 400', async () => {
    const res = await env.app.request('/v1/evaluators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', kind: 'contains', config: {} }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('updates and deletes an evaluator (delete is idempotent → 404)', async () => {
    const id = await createEvaluator({
      name: 'to-delete',
      kind: 'regex',
      config: { value: '^foo' },
    });
    const upd = await env.app.request(`/v1/evaluators/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    });
    expect(upd.status).toBe(200);
    const updBody = Evaluator.parse(await upd.json());
    expect(updBody.name).toBe('renamed');

    const del1 = await env.app.request(`/v1/evaluators/${id}`, { method: 'DELETE' });
    expect(del1.status).toBe(204);
    const del2 = await env.app.request(`/v1/evaluators/${id}`, { method: 'DELETE' });
    expect(del2.status).toBe(404);
  });
});

describe('/v1/evaluators/:id/test — built-in dispatch', () => {
  it('runs `contains` against an output and returns pass=true', async () => {
    const id = await createEvaluator({
      name: 'contains-hi-test',
      kind: 'contains',
      config: { value: 'hi' },
    });
    const res = await env.app.request(`/v1/evaluators/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output: 'say hi to mom' }),
    });
    expect(res.status).toBe(200);
    const body = TestEvaluatorResponse.parse(await res.json());
    expect(body.passed).toBe(true);
    expect(body.score).toBe(1);
  });
});

describe('/v1/evaluators/:id/test — llm_judge dispatch through the gateway', () => {
  it('dispatches to the wired ModelGateway and parses YES as pass', async () => {
    const id = await createEvaluator({
      name: 'judge-yes',
      kind: 'llm_judge',
      config: {
        model_class: 'reasoning-medium',
        prompt: 'Does {{output}} match {{expected}}?',
      },
    });
    env.setJudgeReply('YES');
    const callsBefore = env.judgeCalls.length;
    const res = await env.app.request(`/v1/evaluators/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output: 'foo', expected: 'foo' }),
    });
    expect(res.status).toBe(200);
    const body = TestEvaluatorResponse.parse(await res.json());
    expect(body.passed).toBe(true);
    // The route went through the gateway exactly once.
    expect(env.judgeCalls.length).toBe(callsBefore + 1);
    const last = env.judgeCalls[env.judgeCalls.length - 1];
    // CLAUDE.md non-negotiable #1 — the call context carries a privacy
    // tier (here: `internal` per the llm_judge default) and never a
    // provider name; the gateway is the only thing that knows how to
    // route that.
    expect(last?.ctx.privacy).toBe('internal');
  });
});
