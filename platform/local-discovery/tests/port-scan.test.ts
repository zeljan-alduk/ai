import { describe, expect, it, vi } from 'vitest';
import { discover } from '../src/discover.js';
import {
  COMMON_DEV_PORTS,
  probeOpenAICompatPort,
  resolvePortList,
  scanLocalhostPorts,
} from '../src/port-scan.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('resolvePortList', () => {
  it('returns the curated list for "common"', () => {
    expect(resolvePortList('common')).toBe(COMMON_DEV_PORTS);
  });

  it('returns 64512 ports for "exhaustive" (1024..65535 inclusive)', () => {
    const xs = resolvePortList('exhaustive');
    expect(xs.length).toBe(65535 - 1024 + 1);
    expect(xs[0]).toBe(1024);
    expect(xs[xs.length - 1]).toBe(65535);
  });

  it('passes through an explicit list', () => {
    expect(resolvePortList([7000, 7001])).toEqual([7000, 7001]);
  });
});

describe('probeOpenAICompatPort', () => {
  it('returns parsed models on a valid OpenAI-shaped response', async () => {
    const fetchMock: typeof fetch = vi.fn(async () =>
      jsonResponse({ data: [{ id: 'qwen-7b' }, { id: 'mistral' }] }),
    );
    const out = await probeOpenAICompatPort('http://127.0.0.1:7000', { fetch: fetchMock });
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.id).sort()).toEqual(['mistral', 'qwen-7b']);
    expect(out[0]?.source).toBe('openai-compat');
    expect(out[0]?.providerConfig?.baseUrl).toBe('http://127.0.0.1:7000/v1');
  });

  it('returns [] on non-200', async () => {
    const fetchMock: typeof fetch = vi.fn(async () => new Response('', { status: 404 }));
    expect(await probeOpenAICompatPort('http://127.0.0.1:7000', { fetch: fetchMock })).toEqual([]);
  });

  it('returns [] on a non-OpenAI body', async () => {
    const fetchMock: typeof fetch = vi.fn(async () => jsonResponse({ message: 'hello' }));
    expect(await probeOpenAICompatPort('http://127.0.0.1:7000', { fetch: fetchMock })).toEqual([]);
  });

  it('returns [] on a network error (never throws)', async () => {
    const fetchMock: typeof fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await probeOpenAICompatPort('http://127.0.0.1:7000', { fetch: fetchMock })).toEqual([]);
  });
});

describe('scanLocalhostPorts', () => {
  it('aggregates hits across a custom port list', async () => {
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes(':7000/v1/models')) {
        return jsonResponse({ data: [{ id: 'a' }] });
      }
      if (url.includes(':7001/v1/models')) {
        return jsonResponse({ data: [{ id: 'b' }] });
      }
      return new Response('', { status: 404 });
    });
    const out = await scanLocalhostPorts([7000, 7001, 7002], {
      fetch: fetchMock,
      concurrency: 4,
    });
    expect(out.map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  it('honours skipBaseUrls so named-probe hits are not re-discovered', async () => {
    const fetchMock: typeof fetch = vi.fn(async () => jsonResponse({ data: [{ id: 'shadow' }] }));
    const out = await scanLocalhostPorts([7000], {
      fetch: fetchMock,
      skipBaseUrls: new Set(['http://127.0.0.1:7000']),
    });
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects the concurrency cap (workers <= ports)', async () => {
    let inflight = 0;
    let peak = 0;
    const fetchMock: typeof fetch = vi.fn(async () => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight -= 1;
      return new Response('', { status: 404 });
    });
    await scanLocalhostPorts([7000, 7001, 7002, 7003, 7004, 7005], {
      fetch: fetchMock,
      concurrency: 2,
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('discover() with scan', () => {
  it('appends port-scan results after the named probes', async () => {
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      // Named probes hit defaults; only ollama returns a model.
      if (url.includes(':11434/api/tags')) {
        return jsonResponse({ models: [{ name: 'named-ollama' }] });
      }
      if (url.includes(':8000/v1/models')) return new Response('', { status: 404 });
      if (url.includes(':8080/v1/models')) return new Response('', { status: 404 });
      if (url.includes(':1234/v1/models')) return new Response('', { status: 404 });
      // Port scan finds something on 5000.
      if (url.includes(':5000/v1/models')) {
        return jsonResponse({ data: [{ id: 'oga-found' }] });
      }
      return new Response('', { status: 404 });
    });
    const out = await discover({
      fetch: fetchMock,
      env: {},
      scan: [5000, 5001],
      scanConcurrency: 4,
    });
    const ids = out.map((m) => m.id).sort();
    expect(ids).toEqual(['named-ollama', 'oga-found']);
  });

  it('dedupes a port-scan hit when the named probe already covered the port', async () => {
    // LM Studio's named probe AND a port scan on 1234 — the scan should
    // skip 1234 because the named probe already produced a row there.
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes(':1234/v1/models')) {
        return jsonResponse({ data: [{ id: 'qwen-lms' }] });
      }
      // Other named probes return nothing.
      return new Response('', { status: 404 });
    });
    const out = await discover({
      fetch: fetchMock,
      env: {},
      sources: ['lmstudio'],
      scan: [1234, 1235],
    });
    expect(out.filter((m) => m.id === 'qwen-lms')).toHaveLength(1);
    // Only one fetch to :1234 (the named probe). The scan skipped it.
    const lmsCalls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (c) => String(c[0]).includes(':1234'),
    );
    expect(lmsCalls).toHaveLength(1);
  });
});
