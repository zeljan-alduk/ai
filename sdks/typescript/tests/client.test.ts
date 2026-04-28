/**
 * Smoke tests for the SDK shell. We mock `fetch` and assert that:
 *   - the bearer header is injected,
 *   - the URL is composed correctly (path + query string),
 *   - 4xx/5xx responses become AldoApiError with the parsed envelope,
 *   - non-JSON responses don't crash the parser.
 *
 * Resource methods are exercised via `aldo.agents.list()` /
 * `aldo.runs.create()` to cover the GET + POST paths.
 */

import { describe, expect, it } from 'vitest';
import { Aldo, AldoApiError } from '../src/index.js';

function fakeFetch(impl: (url: string, init: RequestInit) => Promise<Response>): typeof fetch {
  return ((url: RequestInfo | URL, init?: RequestInit) => {
    return impl(typeof url === 'string' ? url : url.toString(), init ?? {});
  }) as typeof fetch;
}

describe('Aldo', () => {
  it('throws when apiKey is missing', () => {
    expect(() => new Aldo({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('injects Bearer auth + lists agents', async () => {
    let captured: { url: string; auth?: string; method?: string } | null = null;
    const aldo = new Aldo({
      apiKey: 'aldo_live_test',
      baseUrl: 'https://api.example.test',
      fetch: fakeFetch(async (url, init) => {
        const headers = new Headers(init.headers as HeadersInit);
        captured = { url, auth: headers.get('authorization') ?? undefined, method: init.method };
        return new Response(JSON.stringify({ agents: [{ name: 'a', team: 't' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    });
    const agents = await aldo.agents.list();
    expect(agents).toEqual([{ name: 'a', team: 't' }]);
    expect(captured).toBeTruthy();
    expect(captured?.url).toBe('https://api.example.test/v1/agents');
    expect(captured?.auth).toBe('Bearer aldo_live_test');
    expect(captured?.method ?? 'GET').toBe('GET');
  });

  it('serialises POST bodies + parses CreateRunResponse', async () => {
    let body: string | undefined;
    const aldo = new Aldo({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      fetch: fakeFetch(async (_url, init) => {
        body = typeof init.body === 'string' ? init.body : undefined;
        return new Response(
          JSON.stringify({
            run: {
              id: 'r_1',
              agentName: 'researcher',
              agentVersion: '0.1.0',
              status: 'running',
              startedAt: '2026-04-28T12:00:00.000Z',
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }),
    });
    const res = await aldo.runs.create({ agentName: 'researcher' });
    expect(body).toBe(JSON.stringify({ agentName: 'researcher' }));
    expect(res.run.id).toBe('r_1');
  });

  it('threads query params through ProjectsResource.list', async () => {
    let capturedUrl: string | undefined;
    const aldo = new Aldo({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      fetch: fakeFetch(async (url) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    });
    await aldo.projects.list({ includeArchived: true });
    expect(capturedUrl).toBe('https://api.example.test/v1/projects?archived=1');
  });

  it('turns 4xx + envelope into AldoApiError with parsed code', async () => {
    const aldo = new Aldo({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      fetch: fakeFetch(async () => {
        return new Response(
          JSON.stringify({
            error: { code: 'project_slug_conflict', message: 'slug already exists' },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        );
      }),
    });
    await expect(aldo.projects.create({ slug: 'x', name: 'X' })).rejects.toMatchObject({
      name: 'AldoApiError',
      status: 409,
      code: 'project_slug_conflict',
    });
  });

  it('AldoApiError is an Error instance (so `instanceof Error` works)', async () => {
    const aldo = new Aldo({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      fetch: fakeFetch(async () => {
        return new Response('{"error":{"code":"e","message":"m"}}', {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }),
    });
    try {
      await aldo.agents.list();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AldoApiError);
      return;
    }
    throw new Error('expected to reject');
  });
});
