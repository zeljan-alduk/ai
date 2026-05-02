import { describe, expect, it, vi } from 'vitest';
import { probe } from '../src/probes/ollama.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('probe(ollama)', () => {
  it('parses /api/tags into discovered models with the right defaults', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        models: [
          { name: 'qwen2.5:7b', model: 'qwen2.5:7b' },
          { name: 'llama3.2:3b', model: 'llama3.2:3b' },
        ],
      }),
    );
    const out = await probe({ fetch: fetchMock });
    expect(out).toHaveLength(2);
    const m = out[0];
    if (m === undefined) throw new Error('expected first row');
    expect(m.id).toBe('qwen2.5:7b');
    expect(m.provider).toBe('ollama');
    expect(m.providerKind).toBe('openai-compat');
    expect(m.locality).toBe('local');
    expect(m.capabilityClass).toBe('local-reasoning');
    expect(m.privacyAllowed).toEqual(['public', 'internal', 'sensitive']);
    expect(m.cost.usdPerMtokIn).toBe(0);
    expect(m.cost.usdPerMtokOut).toBe(0);
    expect(m.providerConfig?.baseUrl).toBe('http://localhost:11434/v1');
    expect(m.source).toBe('ollama');
    expect(typeof m.discoveredAt).toBe('string');
  });

  it('returns [] when the service is not running (connection refused)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('ECONNREFUSED');
    });
    const out = await probe({ fetch: fetchMock });
    expect(out).toEqual([]);
  });

  it('returns [] on HTTP 404', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    const out = await probe({ fetch: fetchMock });
    expect(out).toEqual([]);
  });

  it('returns [] on non-JSON body', async () => {
    const fetchMock = vi.fn(async () => new Response('not json', { status: 200 }));
    const out = await probe({ fetch: fetchMock });
    expect(out).toEqual([]);
  });

  it('returns [] when shape is wrong (missing models array)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ unrelated: true }));
    const out = await probe({ fetch: fetchMock });
    expect(out).toEqual([]);
  });

  it('skips entries with missing/empty name', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        models: [{ name: '' }, { name: 'good:tag' }, { model: '   ' }],
      }),
    );
    const out = await probe({ fetch: fetchMock });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('good:tag');
  });

  it('honours a custom baseUrl override', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ models: [{ name: 'gpt-oss' }] }));
    await probe({ fetch: fetchMock, baseUrl: 'http://[::1]:11434' });
    expect(fetchMock).toHaveBeenCalledWith('http://[::1]:11434/api/tags', expect.any(Object));
  });

  it('Tier 4.1 — Llama 3.1 70B reports effectiveContextTokens=131072 from the table', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        models: [{ name: 'llama3.1:70b', model: 'llama3.1:70b' }],
      }),
    );
    const out = await probe({ fetch: fetchMock });
    expect(out).toHaveLength(1);
    expect(out[0]?.effectiveContextTokens).toBe(131_072);
  });

  it('Tier 4.1 — unknown model falls back to 8192', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        models: [{ name: 'totally-niche-experimental:0.5b' }],
      }),
    );
    const out = await probe({ fetch: fetchMock });
    expect(out).toHaveLength(1);
    expect(out[0]?.effectiveContextTokens).toBe(8_192);
  });

  it('Tier 4.1 — server-reported context_length wins over the table', async () => {
    // Even though the table says Llama 3.1 70B → 131072, the server's
    // own report (e.g. user launched Ollama with --num-ctx 32768) is
    // authoritative.
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        models: [
          {
            name: 'llama3.1:70b',
            model: 'llama3.1:70b',
            details: { context_length: 32_768 },
          },
        ],
      }),
    );
    const out = await probe({ fetch: fetchMock });
    expect(out).toHaveLength(1);
    expect(out[0]?.effectiveContextTokens).toBe(32_768);
  });

  it('aborts when the per-probe timeout is exceeded', async () => {
    const fetchMock: typeof fetch = vi.fn(async (_url, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const out = await probe({ fetch: fetchMock, timeoutMs: 5 });
    expect(out).toEqual([]);
  });
});
