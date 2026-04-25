/**
 * Unit tests for `lib/api.ts`.
 *
 * Focus: the request<T>() helper threads the bearer token from
 * `getSession()` into the Authorization header on the SERVER side,
 * and never adds it on the client side (where the auth-proxy route
 * handler does the injection instead).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sessionToken: string | null = null;

const fetchMock = vi.fn();

beforeEach(async () => {
  sessionToken = null;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // Install (or refresh) the resolver. The resolver closes over the
  // mutable `sessionToken` variable above, so each test only needs
  // to assign a new value.
  const mod = await import('./api.js');
  mod.setServerTokenResolver(async () => sessionToken);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  // Make sure we don't leak window-stubbing across tests. The
  // assignment-to-undefined form is what biome's `noDelete` rule
  // wants; functionally equivalent for our `typeof window === ...`
  // check.
  // @ts-expect-error — undeclared in node typings.
  globalThis.window = undefined;
});

describe('buildRequestHeaders', () => {
  it('includes Authorization: Bearer <token> on the server when a session exists', async () => {
    sessionToken = 'jwt-server-side';
    const { buildRequestHeaders } = await import('./api.js');
    const headers = await buildRequestHeaders(undefined);
    expect(headers.authorization).toBe('Bearer jwt-server-side');
    expect(headers.accept).toBe('application/json');
  });

  it('omits Authorization on the server when no session is present', async () => {
    sessionToken = null;
    const { buildRequestHeaders } = await import('./api.js');
    const headers = await buildRequestHeaders(undefined);
    expect(headers.authorization).toBeUndefined();
    expect(headers.accept).toBe('application/json');
  });

  it('omits Authorization in the browser even with a stubbed cookie', async () => {
    sessionToken = 'jwt-must-not-leak';
    // Pretend we're in a browser bundle.
    vi.stubGlobal('window', { location: { origin: 'https://app.example.test' } });
    const { buildRequestHeaders } = await import('./api.js');
    const headers = await buildRequestHeaders(undefined);
    expect(headers.authorization).toBeUndefined();
  });

  it('preserves caller-supplied headers (object form, case-insensitive)', async () => {
    sessionToken = null;
    const { buildRequestHeaders } = await import('./api.js');
    const headers = await buildRequestHeaders({ 'Content-Type': 'application/json' });
    expect(headers['content-type']).toBe('application/json');
  });

  it('preserves caller-supplied headers (Headers instance)', async () => {
    sessionToken = null;
    const { buildRequestHeaders } = await import('./api.js');
    const h = new Headers({ 'X-Custom': 'yes' });
    const out = await buildRequestHeaders(h);
    expect(out['x-custom']).toBe('yes');
  });
});

describe('request injects Authorization on the server', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ secrets: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('sends Authorization: Bearer <token> when a session cookie exists', async () => {
    sessionToken = 'jwt-from-cookie';
    const { listSecrets } = await import('./api.js');
    await listSecrets();
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const sentHeaders = init?.headers as Record<string, string> | undefined;
    expect(sentHeaders?.authorization).toBe('Bearer jwt-from-cookie');
  });

  it('omits Authorization when no session is present', async () => {
    sessionToken = null;
    const { listSecrets } = await import('./api.js');
    await listSecrets();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const sentHeaders = init?.headers as Record<string, string> | undefined;
    expect(sentHeaders?.authorization).toBeUndefined();
  });

  it('throws ApiClientError with code "unauthenticated" on a 401', async () => {
    sessionToken = null;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'unauthenticated', message: 'no session' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { listSecrets, ApiClientError } = await import('./api.js');
    await expect(listSecrets()).rejects.toBeInstanceOf(ApiClientError);
    try {
      await listSecrets();
    } catch (err) {
      const e = err as { kind: string; code: string; status: number };
      expect(e.kind).toBe('http_4xx');
      expect(e.code).toBe('unauthenticated');
      expect(e.status).toBe(401);
    }
  });
});
