/**
 * Auth-proxy route handler.
 *
 * Client components that talk to the control-plane API hit
 * `/api/auth-proxy/<path>` instead of `API_BASE` directly. This handler:
 *
 *   1. Reads the HTTP-only `aldo_session` cookie (browser JS can't),
 *   2. Re-issues the request to `API_BASE/<path>` with
 *      `Authorization: Bearer <token>` injected,
 *   3. Streams the upstream response back to the browser.
 *
 * Net effect: the bearer token never reaches the browser bundle, but
 * client components keep the simple `fetch('/api/auth-proxy/...')`
 * ergonomic. This is the seam the brief calls "Pick whichever pattern
 * is cleanest"; we use it because several existing client islands
 * (delete-button, new-secret-form, sweep-view) already call API
 * mutations directly and rewriting them all into server actions is
 * out of scope for wave 10.
 *
 * LLM-agnostic: this handler forwards opaque bytes; it never inspects
 * provider names or model fields.
 */

import { API_BASE } from '@/lib/api';
import { getSession } from '@/lib/session';
import type { NextRequest } from 'next/server';

// Methods the control-plane API uses today. Anything else gets a 405.
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// Forwarded-from-browser headers we explicitly drop. `host` and
// `content-length` will be set correctly by `fetch`. `cookie` carries
// our session cookie and must NEVER be forwarded to the upstream API
// — that's the whole reason the proxy exists.
const STRIP_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'cookie',
  'authorization',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
]);

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!ALLOWED_METHODS.has(req.method)) {
    return new Response(
      JSON.stringify({
        error: { code: 'http_error', message: `method ${req.method} not allowed` },
      }),
      { status: 405, headers: { 'content-type': 'application/json' } },
    );
  }

  const params = await ctx.params;
  const path = (params.path ?? []).map(encodeURIComponent).join('/');
  const upstreamUrl = new URL(`/${path}`, API_BASE);
  // Preserve query string from the proxy URL.
  const inUrl = new URL(req.url);
  inUrl.searchParams.forEach((v, k) => upstreamUrl.searchParams.set(k, v));

  const session = await getSession();

  // Build forwarded headers: strip browser-side cookies + auth, keep
  // content-type and accept.
  const fwdHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (STRIP_HEADERS.has(k)) return;
    fwdHeaders[k] = value;
  });
  fwdHeaders.accept = fwdHeaders.accept ?? 'application/json';
  if (session) fwdHeaders.authorization = `Bearer ${session.token}`;

  // Body: forward verbatim for write methods. exactOptionalPropertyTypes
  // forbids `body: undefined`, so build the init object conditionally.
  const init: RequestInit = {
    method: req.method,
    headers: fwdHeaders,
    cache: 'no-store',
    redirect: 'manual',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), init);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: {
          code: 'http_error',
          message: `auth-proxy: failed to reach API at ${upstreamUrl.host}`,
          details: err instanceof Error ? err.message : String(err),
        },
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  // Pass through the upstream body and status. Drop hop-by-hop headers.
  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (
      k === 'content-encoding' ||
      k === 'content-length' ||
      k === 'transfer-encoding' ||
      k === 'connection' ||
      k === 'set-cookie'
    ) {
      return;
    }
    respHeaders.set(k, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx);
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx);
}
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx);
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx);
}
