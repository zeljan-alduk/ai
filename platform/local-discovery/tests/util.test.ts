import { describe, expect, it, vi } from 'vitest';
import { fetchJsonSafe, trimSlash } from '../src/probes/util.js';

describe('trimSlash', () => {
  it('removes a single trailing slash', () => {
    expect(trimSlash('http://x/')).toBe('http://x');
  });
  it('leaves un-slashed strings untouched', () => {
    expect(trimSlash('http://x')).toBe('http://x');
  });
});

describe('fetchJsonSafe', () => {
  it('returns ok=true with parsed body on 200 + JSON', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ hello: 'world' }), { status: 200 }),
    );
    const r = await fetchJsonSafe('http://x', 'ollama', { fetch: fetchMock });
    expect(r.ok).toBe(true);
    expect(r.body).toEqual({ hello: 'world' });
  });

  it('returns ok=false on HTTP 404', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    const debug = vi.fn();
    const r = await fetchJsonSafe('http://x', 'vllm', {
      fetch: fetchMock,
      onDebug: debug,
    });
    expect(r.ok).toBe(false);
    expect(debug).toHaveBeenCalled();
  });

  it('returns ok=false on non-JSON body', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>nope</html>', { status: 200 }));
    const r = await fetchJsonSafe('http://x', 'llamacpp', { fetch: fetchMock });
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toBe('non-JSON body');
  });

  it('returns ok=false on connection refused', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    });
    const debug = vi.fn();
    const r = await fetchJsonSafe('http://x', 'lmstudio', {
      fetch: fetchMock,
      onDebug: debug,
    });
    expect(r.ok).toBe(false);
    expect(debug).toHaveBeenCalled();
  });

  it('returns ok=false on AbortError (timeout)', async () => {
    const fetchMock: typeof fetch = vi.fn(async (_url, init) => {
      // Wait until the AbortSignal fires, then mimic native fetch's behavior.
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const r = await fetchJsonSafe('http://x', 'ollama', {
      fetch: fetchMock,
      timeoutMs: 5,
    });
    expect(r.ok).toBe(false);
  });
});
