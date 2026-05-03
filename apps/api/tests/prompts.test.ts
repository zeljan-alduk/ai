/**
 * Wave-4 (Tier-4) — `/v1/prompts/*` route + store tests.
 *
 * Covers CRUD on prompts and their versions, the diff endpoint, the
 * variable-substitution edge cases, the /test playground entry-point
 * (with an injected runner stub so we never touch a real provider),
 * and tenant isolation. Tests run against the shared pglite harness
 * from `_setup.ts`.
 */

import {
  ApiError,
  GetPromptResponse,
  GetPromptVersionResponse,
  ListPromptVersionsResponse,
  ListPromptsResponse,
  PromptDiffResponse,
  PromptTestResponse,
} from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MissingVariableError,
  diffPromptBodies,
  extractVariableNames,
  substituteVariables,
} from '../src/prompts-store.js';
import { type PromptRunner, promptsRoutes } from '../src/routes/prompts.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

async function createPrompt(
  name: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await env.app.request('/v1/prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: 'smoke',
      body: 'hello {{name}}',
      modelCapability: 'reasoning-medium',
      ...overrides,
    }),
  });
  expect(res.status).toBe(201);
  const body = GetPromptResponse.parse(await res.json());
  return body.prompt.id;
}

describe('/v1/prompts — CRUD', () => {
  it('creates a prompt and lists it (tenant-scoped)', async () => {
    const id = await createPrompt(`p-create-${Date.now()}`);
    const list = await env.app.request('/v1/prompts');
    expect(list.status).toBe(200);
    const body = ListPromptsResponse.parse(await list.json());
    expect(body.prompts.some((p) => p.id === id)).toBe(true);
  });

  it('reads a prompt detail with the latest version inlined', async () => {
    const id = await createPrompt(`p-read-${Date.now()}`);
    const res = await env.app.request(`/v1/prompts/${id}`);
    expect(res.status).toBe(200);
    const body = GetPromptResponse.parse(await res.json());
    expect(body.prompt.id).toBe(id);
    expect(body.prompt.latestVersion).toBe(1);
    expect(body.prompt.latest?.version).toBe(1);
    expect(body.prompt.latest?.body).toBe('hello {{name}}');
  });

  it('returns 404 for an unknown prompt id', async () => {
    const res = await env.app.request('/v1/prompts/pmt_does-not-exist');
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });

  it('rejects an invalid create body with 400 validation_error', async () => {
    const res = await env.app.request('/v1/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', body: '' }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('409s on duplicate name within a project', async () => {
    const name = `p-dup-${Date.now()}`;
    await createPrompt(name);
    const res = await env.app.request('/v1/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, body: 'a {{x}}' }),
    });
    expect(res.status).toBe(409);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('prompt_name_conflict');
  });

  it('updates the description', async () => {
    const id = await createPrompt(`p-update-${Date.now()}`);
    const res = await env.app.request(`/v1/prompts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'renamed' }),
    });
    expect(res.status).toBe(200);
    const body = GetPromptResponse.parse(await res.json());
    expect(body.prompt.description).toBe('renamed');
  });

  it('refuses an empty PATCH', async () => {
    const id = await createPrompt(`p-empty-patch-${Date.now()}`);
    const res = await env.app.request(`/v1/prompts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('soft-deletes (subsequent GET 404s)', async () => {
    const id = await createPrompt(`p-delete-${Date.now()}`);
    const r1 = await env.app.request(`/v1/prompts/${id}`, { method: 'DELETE' });
    expect(r1.status).toBe(204);
    const r2 = await env.app.request(`/v1/prompts/${id}`);
    expect(r2.status).toBe(404);
  });

  it('isolates prompts across tenants', async () => {
    const id = await createPrompt(`p-iso-${Date.now()}`);
    const otherTenantHeader = await env.authFor('22222222-2222-2222-2222-222222222222');
    const res = await env.app.request(`/v1/prompts/${id}`, { headers: otherTenantHeader });
    expect(res.status).toBe(404);
  });
});

describe('/v1/prompts/:id/versions — versioning', () => {
  it('creates a new version and bumps latest_version', async () => {
    const id = await createPrompt(`p-ver-${Date.now()}`);
    const res = await env.app.request(`/v1/prompts/${id}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hi {{name}}, welcome!', notes: 'add greeting' }),
    });
    expect(res.status).toBe(201);
    const created = GetPromptVersionResponse.parse(await res.json());
    expect(created.version.version).toBe(2);
    expect(created.version.notes).toBe('add greeting');

    const detail = await env.app.request(`/v1/prompts/${id}`);
    const body = GetPromptResponse.parse(await detail.json());
    expect(body.prompt.latestVersion).toBe(2);
    expect(body.prompt.latest?.version).toBe(2);
  });

  it('lists versions newest-first', async () => {
    const id = await createPrompt(`p-list-ver-${Date.now()}`);
    for (let i = 0; i < 3; i++) {
      const r = await env.app.request(`/v1/prompts/${id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: `iter ${i} {{name}}`, notes: `iter-${i}` }),
      });
      expect(r.status).toBe(201);
    }
    const list = await env.app.request(`/v1/prompts/${id}/versions`);
    const body = ListPromptVersionsResponse.parse(await list.json());
    expect(body.versions).toHaveLength(4);
    expect(body.versions[0]?.version).toBe(4);
    expect(body.versions.at(-1)?.version).toBe(1);
  });

  it('reads a specific version', async () => {
    const id = await createPrompt(`p-get-ver-${Date.now()}`);
    await env.app.request(`/v1/prompts/${id}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'v2 body {{x}}', notes: 'bump' }),
    });
    const res = await env.app.request(`/v1/prompts/${id}/versions/1`);
    expect(res.status).toBe(200);
    const body = GetPromptVersionResponse.parse(await res.json());
    expect(body.version.version).toBe(1);
    expect(body.version.body).toBe('hello {{name}}');
  });

  it('rejects parentVersionId that doesnt belong to this prompt', async () => {
    const id = await createPrompt(`p-bad-parent-${Date.now()}`);
    const res = await env.app.request(`/v1/prompts/${id}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: 'fork attempt',
        notes: 'fork',
        parentVersionId: 'pmtv_does-not-exist',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('forks from an older version when parentVersionId matches', async () => {
    const id = await createPrompt(`p-fork-${Date.now()}`);
    // Create v2 + v3.
    for (let i = 0; i < 2; i++) {
      await env.app.request(`/v1/prompts/${id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: `linear v${i + 2}`, notes: `bump ${i}` }),
      });
    }
    // Pick v1 as the parent.
    const v1Res = await env.app.request(`/v1/prompts/${id}/versions/1`);
    const v1 = GetPromptVersionResponse.parse(await v1Res.json());
    const fork = await env.app.request(`/v1/prompts/${id}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: 'forked off v1',
        notes: 'fork',
        parentVersionId: v1.version.id,
      }),
    });
    expect(fork.status).toBe(201);
    const created = GetPromptVersionResponse.parse(await fork.json());
    expect(created.version.version).toBe(4);
    expect(created.version.parentVersionId).toBe(v1.version.id);
  });
});

describe('/v1/prompts/:id/diff — line-by-line diff', () => {
  it('returns added/removed/unchanged classifications', async () => {
    const id = await createPrompt(`p-diff-${Date.now()}`, {
      body: 'line one\nline two\nline three',
    });
    await env.app.request(`/v1/prompts/${id}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: 'line one\nline two MODIFIED\nline three\nline four',
        notes: 'edit + add',
      }),
    });
    const res = await env.app.request(`/v1/prompts/${id}/diff?from=1&to=2`);
    expect(res.status).toBe(200);
    const body = PromptDiffResponse.parse(await res.json());
    expect(body.fromVersion).toBe(1);
    expect(body.toVersion).toBe(2);
    expect(body.stats.added).toBeGreaterThanOrEqual(2); // "MODIFIED" line + "line four"
    expect(body.stats.removed).toBeGreaterThanOrEqual(1);
    expect(body.stats.unchanged).toBeGreaterThanOrEqual(2);
  });

  it('404s on an unknown version', async () => {
    const id = await createPrompt(`p-diff-404-${Date.now()}`);
    const res = await env.app.request(`/v1/prompts/${id}/diff?from=1&to=99`);
    expect(res.status).toBe(404);
  });
});

describe('/v1/prompts/:id/test — playground', () => {
  it('substitutes variables and returns the runner output', async () => {
    const id = await createPrompt(`p-test-${Date.now()}`);
    const res = await env.app.request(`/v1/prompts/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: { name: 'world' } }),
    });
    expect(res.status).toBe(200);
    const body = PromptTestResponse.parse(await res.json());
    expect(body.resolvedBody).toBe('hello world');
    expect(body.version).toBe(1);
    expect(body.capabilityUsed).toBe('reasoning-medium');
    expect(body.output.length).toBeGreaterThan(0);
  });

  it('422s on missing required variables', async () => {
    const id = await createPrompt(`p-test-missing-${Date.now()}`);
    const res = await env.app.request(`/v1/prompts/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: {} }),
    });
    expect(res.status).toBe(422);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('missing_variables');
  });

  it('respects capabilityOverride', async () => {
    const id = await createPrompt(`p-test-cap-${Date.now()}`);
    const res = await env.app.request(`/v1/prompts/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: { name: 'x' }, capabilityOverride: 'fast' }),
    });
    expect(res.status).toBe(200);
    const body = PromptTestResponse.parse(await res.json());
    expect(body.capabilityUsed).toBe('fast');
  });

  it('runs against a specific version when pinned', async () => {
    const id = await createPrompt(`p-test-pin-${Date.now()}`);
    await env.app.request(`/v1/prompts/${id}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'goodbye {{name}}', notes: 'bye' }),
    });
    const res = await env.app.request(`/v1/prompts/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: { name: 'world' }, version: 1 }),
    });
    expect(res.status).toBe(200);
    const body = PromptTestResponse.parse(await res.json());
    expect(body.version).toBe(1);
    expect(body.resolvedBody).toBe('hello world');
  });

  it('uses an injected runner when provided to the route factory', async () => {
    // Wire up a fresh Hono app that ONLY mounts the stubbed prompts
    // route (no buildApp layer — buildApp would also mount the
    // default-runner instance, which would win on path matching).
    // We hand-roll a slim middleware to inject the auth context the
    // route reads via getAuth() since we're skipping buildApp's
    // bearerAuth.
    const ids: string[] = [];
    const runner: PromptRunner = {
      async run(opts) {
        ids.push(opts.capability);
        return {
          output: `STUB:${opts.body}`,
          model: 'stub-model',
          tokensIn: 10,
          tokensOut: 20,
          costUsd: 0.0001,
          latencyMs: 7,
        };
      },
    };
    // Create the prompt via the production app first (it goes through
    // the normal store the stub runner will read from).
    const id = await createPrompt(`p-test-stub-${Date.now()}`);
    // Build a minimal app for the stub-runner test. We re-use the
    // standard auth wiring by going through buildApp's signing key
    // and a hand-rolled bearerAuth.
    const { Hono } = await import('hono');
    const { bearerAuth } = await import('../src/auth/middleware.js');
    const customApp = new Hono();
    customApp.use('*', bearerAuth(env.deps.signingKey, env.deps.db));
    customApp.route('/', promptsRoutes(env.deps, { runner }));
    const res = await customApp.request(`/v1/prompts/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...env.authHeader },
      body: JSON.stringify({ variables: { name: 'agent' } }),
    });
    expect(res.status).toBe(200);
    const body = PromptTestResponse.parse(await res.json());
    expect(body.output).toBe('STUB:hello agent');
    expect(body.model).toBe('stub-model');
    expect(body.costUsd).toBeCloseTo(0.0001);
    expect(ids).toEqual(['reasoning-medium']);
  });
});

describe('prompts-store — variable substitution helpers', () => {
  it('extracts variable names in the order they appear, deduped', () => {
    const names = extractVariableNames('hello {{a}} and {{b}} again {{a}} end');
    expect(names).toEqual(['a', 'b']);
  });

  it('handles whitespace inside the braces', () => {
    expect(extractVariableNames('{{  name  }} ok')).toEqual(['name']);
  });

  it('substitutes scalars and JSON-stringifies objects', () => {
    const out = substituteVariables(
      'name={{name}} count={{count}} flag={{flag}} data={{data}}',
      { name: 'alice', count: 7, flag: true, data: { k: 'v' } },
      { variables: [] },
    );
    expect(out).toBe('name=alice count=7 flag=true data={"k":"v"}');
  });

  it('throws MissingVariableError for required variables when omitted', () => {
    expect(() => substituteVariables('hi {{x}}', {}, { variables: [] })).toThrow(
      MissingVariableError,
    );
  });

  it('treats schema-marked optional variables as optional', () => {
    const out = substituteVariables(
      'hi {{name}}',
      {},
      { variables: [{ name: 'name', type: 'string', required: false }] },
    );
    // Missing optional variable substitutes to empty string.
    expect(out).toBe('hi ');
  });

  it('produces a stable diff (insert + change + delete)', () => {
    const diff = diffPromptBodies('a\nb\nc', 'a\nB\nc\nd', 1, 2);
    expect(diff.fromVersion).toBe(1);
    expect(diff.toVersion).toBe(2);
    // 'a' unchanged, 'b' removed, 'B' added, 'c' unchanged, 'd' added.
    expect(diff.stats.added).toBe(2);
    expect(diff.stats.removed).toBe(1);
    expect(diff.stats.unchanged).toBe(2);
  });

  it('handles two identical bodies as fully unchanged', () => {
    const body = 'one\ntwo\nthree';
    const diff = diffPromptBodies(body, body, 1, 2);
    expect(diff.stats.added).toBe(0);
    expect(diff.stats.removed).toBe(0);
    expect(diff.stats.unchanged).toBe(3);
  });
});

describe('/v1/prompts/:id/used-by — agent reference scan', () => {
  it('returns an empty list when no agents reference the prompt', async () => {
    const id = await createPrompt(`p-used-by-empty-${Date.now()}`);
    const res = await env.app.request(`/v1/prompts/${id}/used-by`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: unknown[] };
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents).toHaveLength(0);
  });
});
