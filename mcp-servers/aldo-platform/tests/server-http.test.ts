/**
 * Tests for the HTTP/SSE transport entry point.
 *
 * Strategy: drive the Hono app via `app.fetch()` directly with
 * hand-crafted Web Standard `Request` objects, rather than spinning
 * up a real port. The MCP transport works against the same
 * `Request`/`Response` shapes whether they come from `@hono/node-server`
 * or directly from a test harness — by-construction faithful.
 *
 * Network is mocked at the `fetch` seam exposed by `RestClient`. No
 * real ALDO API is contacted.
 */

import { describe, expect, it } from 'vitest';
import { buildHttpApp, parseBearer } from '../src/server-http.js';

const TEST_API_KEY = 'aldo_test_abc123';
const MCP_PROTOCOL_VERSION = '2025-03-26';

/**
 * Build a fetch impl that mocks one upstream REST call.
 * Returns a tuple of [fetch, captured-requests-array].
 */
function mockUpstream(
  responder: (url: string, init: RequestInit) => Response | Promise<Response>,
): {
  readonly fetch: typeof globalThis.fetch;
  readonly captured: Array<{ url: string; init: RequestInit }>;
} {
  const captured: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const i = init ?? {};
    captured.push({ url, init: i });
    const r = await responder(url, i);
    return r;
  };
  return { fetch: fetchImpl, captured };
}

/** Build an MCP-spec POST request to /mcp carrying a JSON-RPC body. */
function mcpPost(body: unknown, opts: { auth?: string; origin?: string } = {}): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  };
  if (opts.auth !== undefined) headers.Authorization = opts.auth;
  if (opts.origin !== undefined) headers.Origin = opts.origin;
  return new Request('http://test.local/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const initRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'aldo-mcp-platform-test', version: '0.0.0' },
  },
};

const listToolsRequest = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {},
};

describe('healthz', () => {
  it('returns ok with transport metadata', async () => {
    const app = buildHttpApp({ baseUrl: 'http://upstream.local' });
    const res = await app.fetch(new Request('http://test.local/healthz'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; transport: string; version: string };
    expect(body.ok).toBe(true);
    expect(body.transport).toBe('http');
    expect(body.version).toBe('0.0.0');
  });
});

describe('auth — Authorization: Bearer enforcement', () => {
  const baseOpts = { baseUrl: 'http://upstream.local' };

  it('rejects POST /mcp with no Authorization header (401)', async () => {
    const app = buildHttpApp(baseOpts);
    const res = await app.fetch(mcpPost(initRequest));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32001);
    expect(body.error.message).toContain('missing_or_invalid_authorization');
  });

  it('rejects POST /mcp with malformed Authorization header (401)', async () => {
    const app = buildHttpApp(baseOpts);
    const res = await app.fetch(mcpPost(initRequest, { auth: 'Basic abc' }));
    expect(res.status).toBe(401);
  });

  it('rejects empty Bearer token (401)', async () => {
    const app = buildHttpApp(baseOpts);
    const res = await app.fetch(mcpPost(initRequest, { auth: 'Bearer ' }));
    expect(res.status).toBe(401);
  });

  it('accepts a valid Bearer token and lets the MCP transport handle the body', async () => {
    const upstream = mockUpstream(() => new Response('{}', { status: 200 }));
    const app = buildHttpApp({ ...baseOpts, fetch: upstream.fetch });
    const res = await app.fetch(mcpPost(initRequest, { auth: `Bearer ${TEST_API_KEY}` }));
    // The MCP transport handles initialise without touching the
    // upstream REST API — what matters here is that the auth
    // gate let the request through to the transport (i.e. NOT
    // 401, NOT 403).
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe('parseBearer', () => {
  it('parses standard Bearer token', () => {
    expect(parseBearer('Bearer aldo_live_xyz')).toBe('aldo_live_xyz');
  });
  it('is case-insensitive on the scheme', () => {
    expect(parseBearer('bearer aldo_live_xyz')).toBe('aldo_live_xyz');
    expect(parseBearer('BEARER aldo_live_xyz')).toBe('aldo_live_xyz');
  });
  it('returns null on missing/empty/wrong scheme', () => {
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('')).toBeNull();
    expect(parseBearer('Basic abc')).toBeNull();
    expect(parseBearer('Bearer ')).toBeNull();
    expect(parseBearer('Bearer')).toBeNull();
  });
});

describe('CORS preflight', () => {
  const baseOpts = { baseUrl: 'http://upstream.local' };

  it('responds to OPTIONS preflight from chatgpt.com with the right ACAO + methods', async () => {
    const app = buildHttpApp(baseOpts);
    const res = await app.fetch(
      new Request('http://test.local/mcp', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://chatgpt.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type',
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://chatgpt.com');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'authorization',
    );
  });

  it('allows arbitrary *.aldo.tech subdomains via suffix match', async () => {
    const app = buildHttpApp(baseOpts);
    const res = await app.fetch(
      new Request('http://test.local/mcp', {
        method: 'OPTIONS',
        headers: { Origin: 'https://gpt.aldo.tech' },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://gpt.aldo.tech');
  });

  it('does NOT echo Access-Control-Allow-Origin for off-allowlist origins', async () => {
    const app = buildHttpApp(baseOpts);
    const res = await app.fetch(
      new Request('http://test.local/mcp', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example.com' },
      }),
    );
    // Preflight still returns 204 (CORS is advisory) but no
    // ACAO header → browser refuses the cross-origin request.
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('end-to-end tool call via the streamable HTTP transport', () => {
  /**
   * Hand-craft the full handshake and a `tools/call` for
   * `aldo.list_agents`. Asserts that:
   *   1. the Bearer token is forwarded to the upstream REST call
   *   2. the response carries the upstream JSON inside the MCP
   *      tool result envelope
   */
  it('aldo.list_agents — forwards Bearer token + returns upstream JSON via /mcp POST', async () => {
    const fakeAgents = {
      agents: [
        { name: 'planner', version: '0.1.0', tags: ['delivery'] },
        { name: 'reviewer', version: '0.2.0', tags: ['quality'] },
      ],
    };
    const upstream = mockUpstream((url, init) => {
      const headers = new Headers(init.headers);
      // Sanity: the bearer we passed in is what reaches upstream.
      expect(headers.get('authorization')).toBe(`Bearer ${TEST_API_KEY}`);
      expect(url).toContain('/v1/agents');
      return new Response(JSON.stringify(fakeAgents), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const app = buildHttpApp({ baseUrl: 'http://upstream.local', fetch: upstream.fetch });

    // Single batched request: one connection, full call. Stateless
    // transport is happy to handle a `tools/call` without prior
    // `initialize` because there's no session to bind.
    const res = await app.fetch(
      mcpPost(
        {
          jsonrpc: '2.0',
          id: 99,
          method: 'tools/call',
          params: { name: 'aldo.list_agents', arguments: {} },
        },
        { auth: `Bearer ${TEST_API_KEY}` },
      ),
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    // Either application/json (when enableJsonResponse=true and the
    // SDK returns a single response) or text/event-stream (an SSE
    // frame containing the JSON-RPC payload). Both carry the same
    // payload — pull it out either way.
    const payload = extractMcpResponse(text);
    expect(payload.id).toBe(99);
    const result = payload.result as {
      structuredContent?: { agents: ReadonlyArray<unknown> };
      content: Array<{ type: string; text: string }>;
    };
    expect(result.structuredContent?.agents).toHaveLength(2);
    expect(upstream.captured.length).toBe(1);
  });

  it('tools/list — returns all 8 ALDO tools', async () => {
    const upstream = mockUpstream(() => new Response('{}', { status: 200 }));
    const app = buildHttpApp({ baseUrl: 'http://upstream.local', fetch: upstream.fetch });

    const res = await app.fetch(
      mcpPost(listToolsRequest, { auth: `Bearer ${TEST_API_KEY}` }),
    );
    expect(res.status).toBe(200);
    const payload = extractMcpResponse(await res.text());
    const tools = (payload.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(tools.sort()).toEqual([
      'aldo.compare_runs',
      'aldo.get_agent',
      'aldo.get_run',
      'aldo.list_agents',
      'aldo.list_datasets',
      'aldo.list_runs',
      'aldo.run_agent',
      'aldo.save_run_as_eval_row',
    ]);
    // tools/list does not call upstream.
    expect(upstream.captured.length).toBe(0);
  });
});

describe('not-found surface', () => {
  it('returns 404 JSON for unknown routes', async () => {
    const app = buildHttpApp({ baseUrl: 'http://upstream.local' });
    const res = await app.fetch(new Request('http://test.local/random'));
    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────── helpers

interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: { code: number; message: string };
}

/**
 * Extract a JSON-RPC response from either:
 *   - a raw application/json body, or
 *   - an SSE stream (one or more `data: …` frames) — pick the first
 *     frame that parses to a JSON-RPC response with an `id`/`result`
 *     /`error` field.
 */
function extractMcpResponse(body: string): JsonRpcResponse {
  // Try plain JSON first.
  try {
    const parsed = JSON.parse(body) as JsonRpcResponse;
    if (parsed && typeof parsed === 'object' && 'jsonrpc' in parsed) return parsed;
  } catch {
    // fall through to SSE parsing
  }
  // SSE: lines beginning with `data: `, separated by blank lines.
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice('data:'.length).trim();
    if (data.length === 0) continue;
    try {
      const parsed = JSON.parse(data) as JsonRpcResponse;
      if (parsed && typeof parsed === 'object' && 'jsonrpc' in parsed) return parsed;
    } catch {
      // skip malformed frames
    }
  }
  throw new Error(`could not parse MCP response from body: ${body.slice(0, 400)}`);
}
