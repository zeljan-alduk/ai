/**
 * Cover the three probes that all hit `/v1/models`: vLLM, llama.cpp,
 * and LM Studio. They share the same OpenAI-compatible response shape
 * so the tests are parameterised across all three.
 */

import { describe, expect, it, vi } from 'vitest';
import { probe as probeLlamacpp } from '../src/probes/llamacpp.js';
import { probe as probeLmstudio } from '../src/probes/lmstudio.js';
import { probe as probeVllm } from '../src/probes/vllm.js';
import type { DiscoverySource, ProbeOptions } from '../src/types.js';

interface Case {
  readonly source: DiscoverySource;
  readonly fn: (opts?: ProbeOptions) => Promise<readonly unknown[]>;
  readonly defaultBase: string;
}

const CASES: readonly Case[] = [
  { source: 'vllm', fn: probeVllm, defaultBase: 'http://localhost:8000' },
  { source: 'llamacpp', fn: probeLlamacpp, defaultBase: 'http://localhost:8080' },
  { source: 'lmstudio', fn: probeLmstudio, defaultBase: 'http://localhost:1234' },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe.each(CASES)('probe($source)', ({ source, fn, defaultBase }) => {
  it('parses /v1/models into discovered models with the right defaults', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        object: 'list',
        data: [
          { id: 'llama-3.3-70b', object: 'model' },
          { id: 'phi-4', object: 'model' },
        ],
      }),
    );
    const out = (await fn({ fetch: fetchMock })) as ReadonlyArray<{
      id: string;
      provider: string;
      providerKind: string;
      locality: string;
      capabilityClass: string;
      privacyAllowed: readonly string[];
      cost: { usdPerMtokIn: number; usdPerMtokOut: number };
      providerConfig?: { baseUrl?: string };
      source: string;
      discoveredAt: string;
    }>;
    expect(out).toHaveLength(2);
    const first = out[0];
    if (first === undefined) throw new Error('expected a row');
    expect(first.id).toBe('llama-3.3-70b');
    expect(first.provider).toBe(source);
    expect(first.providerKind).toBe('openai-compat');
    expect(first.locality).toBe('local');
    expect(first.capabilityClass).toBe('local-reasoning');
    expect(first.privacyAllowed).toEqual(['public', 'internal', 'sensitive']);
    expect(first.cost.usdPerMtokIn).toBe(0);
    expect(first.cost.usdPerMtokOut).toBe(0);
    expect(first.providerConfig?.baseUrl).toBe(`${defaultBase}/v1`);
    expect(first.source).toBe(source);
  });

  it('returns [] on connection refused', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('ECONNREFUSED');
    });
    const out = await fn({ fetch: fetchMock });
    expect(out).toEqual([]);
  });

  it('returns [] on HTTP 401 / 404', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }));
    expect(await fn({ fetch: fetchMock })).toEqual([]);
    const fetchMock2 = vi.fn(async () => new Response('', { status: 404 }));
    expect(await fn({ fetch: fetchMock2 })).toEqual([]);
  });

  it('returns [] on non-JSON body', async () => {
    const fetchMock = vi.fn(async () => new Response('html?', { status: 200 }));
    expect(await fn({ fetch: fetchMock })).toEqual([]);
  });

  it('returns [] when the data array is missing', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ object: 'list' }));
    expect(await fn({ fetch: fetchMock })).toEqual([]);
  });

  it('skips entries with empty id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: '' }, { id: 'kept' }, {}] }));
    const out = await fn({ fetch: fetchMock });
    expect(out).toHaveLength(1);
  });

  it('honours a baseUrl override', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 'm' }] }));
    await fn({ fetch: fetchMock, baseUrl: 'http://10.0.0.5:9999/' });
    expect(fetchMock).toHaveBeenCalledWith('http://10.0.0.5:9999/v1/models', expect.any(Object));
  });

  it('returns [] when the timeout fires', async () => {
    const fetchMock: typeof fetch = vi.fn(async (_url, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    expect(await fn({ fetch: fetchMock, timeoutMs: 5 })).toEqual([]);
  });
});
