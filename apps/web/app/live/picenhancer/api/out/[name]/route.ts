/**
 * /live/picenhancer/api/out/<name> — proxy for the produced PNG.
 *
 * The pixmend backend writes enhanced images to its own /tmp/.../out
 * directory and serves them at GET /out/<name>. The client receives
 * `imageUrl: "/out/<name>"` in the SSE `done` event and fetches it
 * through this proxy so all picenhancer traffic stays under the
 * single ai.aldo.tech origin.
 */

import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND = process.env.PIXMEND_BACKEND_URL ?? 'http://127.0.0.1:4000';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await params;
  // Same allow-list the backend itself enforces on /out/:name. Defence
  // in depth — keep the proxy from being abused as a generic file
  // probe even if the backend's path-strip ever loosens.
  const safe = name.replace(/[^a-z0-9._-]/gi, '');
  if (!safe) return new Response('bad name', { status: 400 });
  let res: Response;
  try {
    res = await fetch(`${BACKEND.replace(/\/$/, '')}/out/${safe}`);
  } catch (err) {
    return new Response(
      `picenhancer backend offline: ${err instanceof Error ? err.message : String(err)}`,
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }
  if (!res.ok || !res.body) {
    return new Response('not found', { status: res.status === 404 ? 404 : 502 });
  }
  return new Response(res.body, {
    status: 200,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'image/png',
      'cache-control': 'no-store',
    },
  });
}
