/**
 * /live/picenhancer/api/enhance — proxy to the pixmend Hono backend.
 *
 * Forwards the multipart/form-data POST as-is, streams the SSE
 * response back without buffering. Configurable via the
 * `PIXMEND_BACKEND_URL` env (default http://127.0.0.1:4000), so the
 * production deploy can point at the co-located pixmend container on
 * the slovenia-transit VPS.
 *
 * Failure modes the visitor sees:
 *   - 503 + clear message when the backend isn't reachable. The
 *     /live/picenhancer client surfaces this inline so a prospect knows
 *     the runtime is provisioning rather than seeing an opaque error.
 *   - Backend status passed through verbatim for everything else.
 */

import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND = process.env.PIXMEND_BACKEND_URL ?? 'http://127.0.0.1:4000';

export async function POST(req: NextRequest): Promise<Response> {
  const upstream = `${BACKEND.replace(/\/$/, '')}/enhance`;
  let res: Response;
  try {
    res = await fetch(upstream, {
      method: 'POST',
      // Pass the multipart body through; fetch will use the original
      // content-type + boundary because we hand it the raw stream.
      body: req.body,
      headers: {
        'content-type': req.headers.get('content-type') ?? 'application/octet-stream',
      },
      // @ts-expect-error — Node's undici needs duplex 'half' to forward a request stream.
      duplex: 'half',
    });
  } catch (err) {
    return backendOffline(err);
  }

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    return new Response(txt || `backend HTTP ${res.status}`, {
      status: res.status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  // Stream the SSE body straight through.
  return new Response(res.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

function backendOffline(err: unknown): Response {
  const msg =
    'picenhancer runtime is not enabled on this server yet. ' +
    'The Real-ESRGAN container is being provisioned on the same VPS — check back shortly, ' +
    'or run it locally (see /examples for instructions). ' +
    `(detail: ${err instanceof Error ? err.message : String(err)})`;
  return new Response(msg, {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
