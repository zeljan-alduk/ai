import { describe, expect, it, vi } from 'vitest';
import { discover, parseDiscoverySources } from '../src/discover.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('parseDiscoverySources', () => {
  it('returns all four sources by default', () => {
    expect(parseDiscoverySources(undefined)).toEqual(['ollama', 'vllm', 'llamacpp', 'lmstudio']);
  });

  it('returns no sources for "none"', () => {
    expect(parseDiscoverySources('none')).toEqual([]);
    expect(parseDiscoverySources('NONE')).toEqual([]);
    expect(parseDiscoverySources('  None  ')).toEqual([]);
  });

  it('selects an explicit subset', () => {
    expect(parseDiscoverySources('ollama,vllm')).toEqual(['ollama', 'vllm']);
  });

  it('drops unknown tokens silently', () => {
    expect(parseDiscoverySources('ollama,bogus,mlx')).toEqual(['ollama']);
  });

  it('deduplicates and trims', () => {
    expect(parseDiscoverySources('ollama, ollama , vllm')).toEqual(['ollama', 'vllm']);
  });
});

describe('discover()', () => {
  it('runs every probe in parallel and aggregates results', async () => {
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes(':11434/api/tags')) {
        return jsonResponse({ models: [{ name: 'qwen' }] });
      }
      if (url.includes(':8000/v1/models')) {
        return jsonResponse({ data: [{ id: 'llama-vllm' }] });
      }
      if (url.includes(':8080/v1/models')) {
        return jsonResponse({ data: [{ id: 'phi-llamacpp' }] });
      }
      if (url.includes(':1234/v1/models')) {
        return jsonResponse({ data: [{ id: 'mistral-lms' }] });
      }
      return new Response('', { status: 404 });
    });
    const out = await discover({ fetch: fetchMock, env: {} });
    const ids = out.map((m) => m.id).sort();
    expect(ids).toEqual(['llama-vllm', 'mistral-lms', 'phi-llamacpp', 'qwen']);
    // One fetch per probe.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('returns [] when ALDO_LOCAL_DISCOVERY=none', async () => {
    const fetchMock = vi.fn();
    const out = await discover({
      fetch: fetchMock,
      env: { ALDO_LOCAL_DISCOVERY: 'none' },
    });
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honours an explicit subset', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ models: [{ name: 'only-ollama' }] }));
    const out = await discover({
      fetch: fetchMock,
      sources: ['ollama'],
    });
    expect(out).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a single failing probe does not block the others', async () => {
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes(':11434')) throw new TypeError('ECONNREFUSED');
      if (url.includes(':8000')) {
        return jsonResponse({ data: [{ id: 'still-here' }] });
      }
      return new Response('', { status: 404 });
    });
    const out = await discover({
      fetch: fetchMock,
      sources: ['ollama', 'vllm'],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('still-here');
  });

  it('passes a baseUrl override through to the matching probe', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ models: [{ name: 'remote' }] }));
    await discover({
      fetch: fetchMock,
      sources: ['ollama'],
      baseUrls: { ollama: 'http://10.1.2.3:11434' },
    });
    expect(fetchMock).toHaveBeenCalledWith('http://10.1.2.3:11434/api/tags', expect.any(Object));
  });

  it('total wall-clock is bounded by max(timeoutMs)', async () => {
    const fetchMock: typeof fetch = vi.fn(async (_url, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const t0 = Date.now();
    const out = await discover({ fetch: fetchMock, timeoutMs: 50 });
    const dt = Date.now() - t0;
    expect(out).toEqual([]);
    // Probes run concurrently; total time should stay close to one
    // timeout window, not 4×. Allow generous slack for CI.
    expect(dt).toBeLessThan(500);
  });
});
