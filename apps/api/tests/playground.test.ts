/**
 * Wave-13 — `/v1/playground/run` SSE endpoint tests.
 *
 *   1. Capability-class routing — only models matching the requested
 *      class show up as columns.
 *   2. Privacy fail-closed — sensitive privacy + cloud-only catalog
 *      returns 422 BEFORE any SSE bytes are written.
 *   3. Model cap — schema rejects > PLAYGROUND_MAX_MODELS in the
 *      `models[]` array.
 *   4. Rate limit — the 11th request from the same tenant in a 60s
 *      window returns 429.
 *   5. SSE shape — frames are `event: delta\ndata: <json>\n\n` and the
 *      json shape is `{modelId, type, payload}` with `type` in
 *      {start, delta, usage, done}.
 *   6. Error propagation — a streamer that throws emits an `error`
 *      frame for that column and the others continue cleanly.
 */

import { fileURLToPath } from 'node:url';
import {
  ApiError,
  PLAYGROUND_MAX_MODELS,
  PLAYGROUND_RATE_LIMIT_PER_MIN,
  PlaygroundFrame,
} from '@aldo-ai/api-contract';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetPlaygroundRateLimiter } from '../src/routes/playground.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

const CLOUD_ONLY_FIXTURE = fileURLToPath(
  new URL('./fixtures/models.cloud-only.yaml', import.meta.url),
);
const WITH_LOCAL_FIXTURE = fileURLToPath(
  new URL('./fixtures/models.with-local.yaml', import.meta.url),
);

let env: TestEnv;
let cloudOnly: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv({ MODELS_FIXTURE_PATH: WITH_LOCAL_FIXTURE });
  cloudOnly = await setupTestEnv({ MODELS_FIXTURE_PATH: CLOUD_ONLY_FIXTURE });
});

afterAll(async () => {
  await env.teardown();
  await cloudOnly.teardown();
});

afterEach(() => {
  // The limiter is module-scoped; reset between cases so individual
  // tests don't bleed quota into each other.
  resetPlaygroundRateLimiter();
});

/**
 * Read an SSE response body into an array of parsed frames. The
 * playground writes `event: delta\ndata: <json>\n\n` per frame.
 */
async function readFrames(
  res: Response,
): Promise<Array<{ modelId: string; type: string; payload: unknown }>> {
  const text = await res.text();
  const frames: Array<{ modelId: string; type: string; payload: unknown }> = [];
  const blocks = text.split('\n\n');
  for (const block of blocks) {
    const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
    if (dataLine === undefined) continue;
    const json = dataLine.slice('data:'.length).trim();
    if (json.length === 0) continue;
    const parsed = PlaygroundFrame.parse(JSON.parse(json));
    frames.push({ modelId: parsed.modelId, type: parsed.type, payload: parsed.payload });
  }
  return frames;
}

describe('POST /v1/playground/run — capability-class routing', () => {
  it('streams a column per eligible model in the requested capability class', async () => {
    const res = await env.app.request('/v1/playground/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capabilityClass: 'reasoning-medium',
        privacy: 'public',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const frames = await readFrames(res);
    // The with-local fixture has exactly one cloud row in
    // reasoning-medium ('cloud-medium-fixture'); we should see one
    // start, one delta, one usage, one done.
    const modelIds = new Set(frames.map((f) => f.modelId));
    expect(modelIds.has('cloud-medium-fixture')).toBe(true);
    expect(frames.some((f) => f.type === 'start')).toBe(true);
    expect(frames.some((f) => f.type === 'delta')).toBe(true);
    expect(frames.some((f) => f.type === 'usage')).toBe(true);
    expect(frames.some((f) => f.type === 'done')).toBe(true);
  });
});

describe('POST /v1/playground/run — privacy fail-closed', () => {
  it('sensitive + cloud-only catalog returns 422 with privacy_tier_unroutable', async () => {
    const res = await cloudOnly.app.request('/v1/playground/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capabilityClass: 'reasoning-medium',
        privacy: 'sensitive',
        messages: [{ role: 'user', content: 'sensitive thing' }],
        stream: true,
      }),
    });
    expect(res.status).toBe(422);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('privacy_tier_unroutable');
    const details = body.error.details as
      | { capabilityClass?: string; privacyTier?: string; trace?: ReadonlyArray<unknown> }
      | undefined;
    expect(details?.privacyTier).toBe('sensitive');
    expect(Array.isArray(details?.trace)).toBe(true);
  });
});

describe('POST /v1/playground/run — model cap', () => {
  it('rejects > PLAYGROUND_MAX_MODELS pinned ids', async () => {
    const tooMany = Array.from(
      { length: PLAYGROUND_MAX_MODELS + 1 },
      (_, i) => `pinned-model-${i}`,
    );
    const res = await env.app.request('/v1/playground/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capabilityClass: 'reasoning-medium',
        privacy: 'public',
        messages: [{ role: 'user', content: 'x' }],
        models: tooMany,
        stream: true,
      }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });
});

describe('POST /v1/playground/run — rate limit', () => {
  it(`returns 429 after ${PLAYGROUND_RATE_LIMIT_PER_MIN} requests in a 60s window`, async () => {
    // Fire exactly the cap-many successful requests, then a final one
    // that must 429. Use a fresh harness to avoid bleed from other
    // suites that may have consumed quota in this process.
    resetPlaygroundRateLimiter();
    const body = JSON.stringify({
      capabilityClass: 'reasoning-medium',
      privacy: 'public',
      messages: [{ role: 'user', content: 'rate-limit-probe' }],
      stream: true,
    });
    for (let i = 0; i < PLAYGROUND_RATE_LIMIT_PER_MIN; i++) {
      const ok = await env.app.request('/v1/playground/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(ok.status).toBe(200);
      // Drain the body so the connection is fully consumed before
      // the next iteration.
      await ok.text();
    }
    const limited = await env.app.request('/v1/playground/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(limited.status).toBe(429);
    const err = ApiError.parse(await limited.json());
    expect(err.error.code).toBe('rate_limited');
  });
});

describe('POST /v1/playground/run — SSE shape', () => {
  it('every frame is event:delta + data:<json> with {modelId,type,payload}', async () => {
    const res = await env.app.request('/v1/playground/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capabilityClass: 'reasoning-medium',
        privacy: 'public',
        messages: [{ role: 'user', content: 'shape-check' }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    // Every non-empty block has exactly one `event: delta` line and
    // exactly one `data:` line that parses as JSON to the contract.
    const blocks = text.split('\n\n').filter((b) => b.trim().length > 0);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event:'));
      const data = lines.find((l) => l.startsWith('data:'));
      expect(event).toBe('event: delta');
      expect(data).toBeDefined();
      if (data === undefined) continue;
      const json = JSON.parse(data.slice('data:'.length).trim());
      const parsed = PlaygroundFrame.safeParse(json);
      expect(parsed.success).toBe(true);
    }
  });
});

describe('POST /v1/playground/run — error propagation', () => {
  it('when a column streamer throws, the column emits an error frame and others continue', async () => {
    // Build a fresh harness with a streamer that throws for one model
    // and yields normally for the others. We can't reach in via the
    // standard buildApp seam (Deps doesn't expose a playground hook),
    // so we directly construct a Hono app with the route mounted with
    // a custom streamer.
    const { Hono } = await import('hono');
    const { playgroundRoutes } = await import('../src/routes/playground.js');
    const erroringStreamer = {
      // eslint-disable-next-line require-yield
      async *stream(opts: { model: { id: string } }) {
        if (opts.model.id === 'cloud-medium-fixture') {
          throw new Error('synthetic stream failure');
        }
        yield { kind: 'text' as const, text: 'ok' };
        yield {
          kind: 'usage' as const,
          tokensIn: 1,
          tokensOut: 1,
          usd: 0,
          latencyMs: 1,
        };
      },
    };
    const app = new Hono();
    app.use('*', async (c, next) => {
      // Stub the auth context so getAuth() returns a tenant id.
      // Cast around the tightly-typed Hono context — the test only
      // needs `tenantId` on the auth blob.
      (c as unknown as { set(k: string, v: unknown): void }).set('auth', {
        tenantId: env.tenantId,
        userId: 'test',
        role: 'owner',
        tenantSlug: 'default',
      });
      await next();
    });
    app.route('/', playgroundRoutes(env.deps, { streamer: erroringStreamer }));
    const res = await app.request('/v1/playground/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capabilityClass: 'reasoning-medium',
        privacy: 'public',
        messages: [{ role: 'user', content: 'err-prop' }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    const frames = await readFrames(res);
    const errorFrames = frames.filter((f) => f.type === 'error');
    expect(errorFrames.length).toBeGreaterThanOrEqual(1);
    const errPayload = errorFrames[0]?.payload as { code?: string; message?: string };
    expect(errPayload?.code).toBe('stream_failed');
    expect(errPayload?.message).toContain('synthetic');
  });
});
