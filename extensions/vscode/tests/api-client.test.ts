import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError } from '../src/api/client.js';

function fakeFetch(responses: Map<string, { status: number; body: unknown }>): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const r = responses.get(u);
    if (!r) throw new Error(`unexpected fetch: ${u}`);
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('ApiClient', () => {
  it('lists agents', async () => {
    const responses = new Map([
      ['https://api.test/v1/agents', { status: 200, body: { agents: [{ name: 'reviewer' }] } }],
    ]);
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      token: 'tk',
      fetchImpl: fakeFetch(responses),
    });
    const agents = await client.listAgents();
    expect(agents).toEqual([{ name: 'reviewer' }]);
  });

  it('strips trailing slashes from base url', async () => {
    const responses = new Map([
      ['https://api.test/v1/runs?limit=5', { status: 200, body: { runs: [] } }],
    ]);
    const client = new ApiClient({
      baseUrl: 'https://api.test/',
      token: 'tk',
      fetchImpl: fakeFetch(responses),
    });
    expect(await client.listRuns(5)).toEqual([]);
  });

  it('throws ApiError with code on non-2xx', async () => {
    const responses = new Map([
      [
        'https://api.test/v1/runs?limit=20',
        {
          status: 422,
          body: { code: 'privacy_tier_unroutable', message: 'nope' },
        },
      ],
    ]);
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      token: 'tk',
      fetchImpl: fakeFetch(responses),
    });
    await expect(client.listRuns()).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      code: 'privacy_tier_unroutable',
    });
  });

  it('forwards bearer token', async () => {
    let seenAuth = '';
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      seenAuth = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      token: 'sk-123',
      fetchImpl,
    });
    await client.listModels();
    expect(seenAuth).toBe('Bearer sk-123');
  });

  it('serialises createRun body', async () => {
    let seenBody = '';
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      seenBody = (init?.body as string) ?? '';
      return new Response(
        JSON.stringify({
          run: { id: 'run_x', agentName: 'a', status: 'queued' },
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      token: 'tk',
      fetchImpl,
    });
    const run = await client.createRun('a', 'hello');
    expect(JSON.parse(seenBody)).toEqual({ agentName: 'a', input: 'hello' });
    expect(run.id).toBe('run_x');
  });

  it('exposes ApiError class', () => {
    const e = new ApiError(401, 'unauthenticated', 'no token');
    expect(e.status).toBe(401);
    expect(e.code).toBe('unauthenticated');
    expect(e.message).toBe('no token');
  });
});
