#!/usr/bin/env node
/**
 * aldo-mcp-platform — HTTP/SSE entry point.
 *
 * Hosts the same 8-tool surface as the stdio entry point at
 * POST/GET/DELETE `/mcp`, using the MCP Streamable HTTP transport
 * (per the @modelcontextprotocol/sdk 1.29+ spec). Both SSE streams
 * and direct JSON responses are supported by the same transport;
 * the client picks via the `Accept` header.
 *
 * Why this exists
 * ---------------
 * ChatGPT connectors, Cloudflare Workers AI, OpenAI Agents SDK in
 * remote mode — none of these can spawn a local stdio subprocess.
 * They need an HTTPS endpoint. This file makes it possible to host
 * `@aldo-ai/mcp-platform` at `mcp.aldo.tech`. The actual deploy
 * (DNS, edge nginx route, TLS) is a follow-up; this PR ships the
 * code that makes the deploy meaningful.
 *
 * Auth
 * ----
 * Per-request: read `Authorization: Bearer <token>` from the HTTP
 * request, instantiate a request-scoped REST client + MCP server
 * with that token. Each connected client uses *their own* ALDO API
 * key — there is no shared key in the env. The `ALDO_API_KEY` env
 * var is intentionally NOT consulted in HTTP mode; the token comes
 * from the header, full stop.
 *
 * Statelessness
 * -------------
 * The transport is configured *stateless* (`sessionIdGenerator:
 * undefined`). Every POST is a self-contained JSON-RPC request +
 * response — no session pinning, no in-memory connection state. A
 * future deploy can scale horizontally behind any load balancer
 * with no sticky sessions. Resumability + long-running tool calls
 * are deferred to a follow-up wave.
 *
 * CORS
 * ----
 * The hosted endpoint is consumed from browsers (ChatGPT
 * connectors, custom GPT actions) so we ship a permissive CORS
 * policy for the explicit allowlist below. Direct API clients and
 * server-to-server callers ignore CORS entirely.
 */

import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { RestClient } from './client.js';
import { createAldoPlatformServer } from './server.js';
import { SERVER_NAME, SERVER_VERSION } from './tools.js';

/**
 * Origins allowed to call `/mcp` from a browser.
 *
 * Curated, NOT a wildcard:
 *   - `https://chat.openai.com` + `https://chatgpt.com` — ChatGPT
 *     connectors call MCP servers from their hosted runtime.
 *   - `https://*.aldo.tech` — our own hosted surfaces (dashboard
 *     debug tooling, future ALDO-hosted custom GPT).
 *   - localhost on common dev ports for self-host testing.
 *
 * Server-to-server callers (Cursor remote, OpenAI Agents SDK,
 * Claude Code via http transport) don't send `Origin` headers and
 * are unaffected.
 */
const CORS_ALLOWLIST_EXACT = new Set<string>([
  'https://chat.openai.com',
  'https://chatgpt.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3030',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3030',
]);

/** Suffix matchers — any host whose origin ends in one of these is allowed. */
const CORS_ALLOWLIST_SUFFIX: ReadonlyArray<string> = ['.aldo.tech'];

const ALLOWED_HEADERS = ['Authorization', 'Content-Type', 'Mcp-Session-Id', 'MCP-Protocol-Version'];
const ALLOWED_METHODS = ['GET', 'POST', 'DELETE', 'OPTIONS'];

/** Default base URL for the wrapped REST API; overridable via env. */
const DEFAULT_BASE_URL = 'https://ai.aldo.tech';

export interface HttpAppOpts {
  /** Override the upstream API base URL (default: ALDO_BASE_URL env or https://ai.aldo.tech). */
  readonly baseUrl?: string;
  /** Test seam: alternative fetch impl forwarded to per-request RestClient. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Build a Hono app that hosts the MCP HTTP transport at `/mcp` plus
 * a `/healthz` probe. Exported as a function so tests can call it
 * with a mocked fetch (no network) and so the production entry
 * point can wire it up under @hono/node-server.
 */
export function buildHttpApp(opts: HttpAppOpts = {}): Hono {
  const baseUrl = opts.baseUrl ?? process.env.ALDO_BASE_URL ?? DEFAULT_BASE_URL;
  const fetchImpl = opts.fetch;

  const app = new Hono();

  app.use('*', corsMiddleware());

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      transport: 'http',
      protocol: 'mcp-streamable-http',
      server: SERVER_NAME,
      version: SERVER_VERSION,
    }),
  );

  // The MCP transport handles GET (open SSE stream), POST (JSON-RPC
  // request), and DELETE (terminate session — no-op in stateless
  // mode but keeps the contract honest).
  app.all('/mcp', async (c) => {
    if (c.req.method === 'OPTIONS') {
      // Hono's CORS middleware already short-circuits OPTIONS via
      // the headers it set, but wire an explicit 204 to keep parity
      // with what some MCP clients expect.
      return new Response(null, { status: 204 });
    }

    const auth = c.req.header('authorization');
    const token = parseBearer(auth);
    if (token === null) {
      return jsonRpcAuthError(c, 'missing_or_invalid_authorization');
    }

    const restClientOpts: ConstructorParameters<typeof RestClient>[0] = {
      baseUrl,
      apiKey: token,
    };
    if (fetchImpl !== undefined) {
      (restClientOpts as { fetch: typeof globalThis.fetch }).fetch = fetchImpl;
    }
    const client = new RestClient(restClientOpts);
    const server = createAldoPlatformServer({ client });

    // Stateless transport: no session, no in-memory connection
    // state. Each request creates its own transport + server pair
    // so per-request auth is genuinely isolated.
    //
    // Per the SDK type signature with `exactOptionalPropertyTypes`,
    // we omit `sessionIdGenerator` entirely rather than passing
    // `undefined` — both routes through the same stateless code
    // path inside the transport.
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(c.req.raw);
      return response;
    } catch (err) {
      // The transport already returns Response objects for protocol
      // errors; this catches genuine bugs (handler threw, etc.).
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32603, message: `internal_error: ${message}` },
          id: null,
        },
        500,
      );
    } finally {
      // Best-effort cleanup; stateless transport has nothing to
      // close but server.close() releases the in-memory tool
      // registrations.
      void server.close().catch(() => undefined);
    }
  });

  // 404 for anything else — the transport is the only public surface.
  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: `no route ${c.req.path}` } }, 404),
  );

  return app;
}

/** Parse `Authorization: Bearer <token>`. Returns null on missing/malformed. */
export function parseBearer(header: string | undefined): string | null {
  if (typeof header !== 'string') return null;
  const trimmed = header.trim();
  // Case-insensitive scheme per RFC 7235.
  const match = /^Bearer\s+(\S+)$/i.exec(trimmed);
  if (match === null) return null;
  const token = match[1];
  if (token === undefined || token.length === 0) return null;
  return token;
}

function jsonRpcAuthError(c: Context, code: string): Response {
  return c.json(
    {
      jsonrpc: '2.0',
      error: {
        // -32001 is the conventional JSON-RPC "auth required" code
        // used by the MCP SDK examples.
        code: -32001,
        message: code,
        data: {
          hint: 'pass `Authorization: Bearer <ALDO_API_KEY>` (generate at https://ai.aldo.tech/settings/api-keys)',
        },
      },
      id: null,
    },
    401,
  );
}

function corsMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = origin !== undefined && isOriginAllowed(origin);

    if (allowed) {
      c.res.headers.set('Access-Control-Allow-Origin', origin);
      c.res.headers.set('Vary', 'Origin');
      c.res.headers.set('Access-Control-Allow-Credentials', 'true');
    }

    if (c.req.method === 'OPTIONS') {
      // Preflight — respond directly so we don't fall through to
      // the route handler.
      const headers = new Headers();
      if (allowed) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Vary', 'Origin');
        headers.set('Access-Control-Allow-Credentials', 'true');
        headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
        headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
        headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id');
        headers.set('Access-Control-Max-Age', '86400');
      }
      return new Response(null, { status: 204, headers });
    }

    await next();
  };
}

function isOriginAllowed(origin: string): boolean {
  if (CORS_ALLOWLIST_EXACT.has(origin)) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  for (const suffix of CORS_ALLOWLIST_SUFFIX) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

// ──────────────────────────────────────── entry point

export async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3030);
  const host = process.env.HOST ?? '0.0.0.0';
  const app = buildHttpApp();

  serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    process.stderr.write(
      `[aldo-mcp-http] listening on http://${info.address}:${info.port} ` +
        `(transport=streamable-http, server=${SERVER_NAME}@${SERVER_VERSION})\n`,
    );
  });

  // No graceful-shutdown promise — `serve()` returns synchronously
  // and Node's HTTP server keeps the event loop alive. SIGTERM /
  // SIGINT default behaviour (process exit) is fine for the v0
  // deploy; the orchestrator (k8s / docker) sees a healthy SIGTERM
  // exit. A future revision can wire a drain hook.
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  // Touch randomUUID so it's tree-shake-safe; reserved for future
  // session-mode use (`sessionIdGenerator: () => randomUUID()`).
  void randomUUID;
  main().catch((err) => {
    process.stderr.write(`aldo-mcp-http: fatal: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
}
