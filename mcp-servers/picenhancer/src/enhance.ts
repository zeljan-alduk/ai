/**
 * picenhancer.enhance — single-tool implementation.
 *
 * Wraps the picenhancer Hono backend's POST /enhance endpoint.
 * Accepts an image (base64 or URL) + a mode + a strength. Streams the
 * SSE response server-side, returns the final structured result.
 *
 * No image data is logged or persisted by this MCP wrapper — the
 * upstream Hono backend writes inputs to a private container path
 * (/var/lib/picenhancer/in) and outputs to a similar /out, both
 * scoped to the picenhancer container's volume.
 */

import { z } from 'zod';

export const enhanceInputSchema = z.object({
  image: z
    .string()
    .min(1)
    .describe(
      'The image to enhance. Either a `data:image/...;base64,...` URI, ' +
        'a raw base64 string (PNG/JPEG/WebP bytes), or an `https://...` ' +
        'URL the picenhancer backend can fetch.',
    ),
  mode: z
    .enum(['enhance', 'enhance-bg', 'upscale-x4', 'upscale-x8'])
    .default('enhance')
    .describe(
      'Action: `enhance` = restore faces only, keep dimensions (5–15 s). ' +
        '`enhance-bg` = also clean the background via Real-ESRGAN, same ' +
        'dimensions (10–25 s). `upscale-x4` = full SR + face restore ' +
        '(15–30 s). `upscale-x8` = AI x4 then Lanczos x2 on top.',
    ),
  strength: z
    .number()
    .min(0)
    .max(1)
    .default(0.7)
    .describe(
      'GFPGAN restoration strength 0.0–1.0. Lower preserves more of the ' +
        'source person\'s character; higher pushes toward GFPGAN\'s ' +
        'idealised face. Sweet spot 0.6–0.8.',
    ),
});

export const enhanceOutputSchema = z.object({
  imageUrl: z.string().describe('Public URL of the enhanced PNG.'),
  scale: z.union([z.literal(1), z.literal(4), z.literal(8), z.literal(16)]),
  bg: z.union([z.literal(0), z.literal(1)]),
  weight: z.number(),
  faces: z.number().int().min(0),
  origDims: z.object({ w: z.number(), h: z.number() }),
  enhancedDims: z.object({ w: z.number(), h: z.number() }),
  origBytes: z.number(),
  enhancedBytes: z.number(),
  enhanceMs: z.number().describe('Server-side wall time in ms.'),
});

export type EnhanceInput = z.infer<typeof enhanceInputSchema>;
export type EnhanceOutput = z.infer<typeof enhanceOutputSchema>;

const MODE_TO_PARAMS: Record<EnhanceInput['mode'], { scale: string; bg: string }> = {
  enhance: { scale: '1', bg: '0' },
  'enhance-bg': { scale: '1', bg: '1' },
  'upscale-x4': { scale: '4', bg: '1' },
  'upscale-x8': { scale: '8', bg: '1' },
};

export interface EnhanceConfig {
  /**
   * Base URL of the picenhancer Hono backend. Production points at
   * https://ai.aldo.tech/live/picenhancer/api (the Next.js proxy);
   * local dev points at http://127.0.0.1:4000 (direct).
   */
  readonly baseUrl: string;
}

/**
 * Decode `image` into an in-memory Blob. Accepts:
 *   - data:image/...;base64,... URI
 *   - bare base64 string (no prefix)
 *   - https:// URL (fetched server-side; size capped at 25 MB to match
 *     the picenhancer UI's stated limit)
 */
async function imageToBlob(image: string): Promise<Blob> {
  if (image.startsWith('data:')) {
    const m = image.match(/^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i);
    if (!m || !m[1] || !m[2]) {
      throw new Error('invalid data URI — expected data:image/...;base64,...');
    }
    return new Blob([Buffer.from(m[2], 'base64')], { type: m[1] });
  }
  if (image.startsWith('http://') || image.startsWith('https://')) {
    const res = await fetch(image, { redirect: 'follow' });
    if (!res.ok) throw new Error(`image fetch ${res.status}: ${image}`);
    const ct = res.headers.get('content-type') ?? 'application/octet-stream';
    if (!ct.startsWith('image/')) throw new Error(`fetched URL is not an image (content-type: ${ct})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) throw new Error('image > 25 MB');
    return new Blob([buf], { type: ct });
  }
  // Bare base64 — no MIME hint, default to PNG.
  return new Blob([Buffer.from(image, 'base64')], { type: 'image/png' });
}

interface SseEvent {
  readonly type: string;
  readonly status?: string;
  readonly imageUrl?: string;
  readonly scale?: number;
  readonly bg?: number;
  readonly weight?: number;
  readonly faces?: number;
  readonly origDims?: { w: number; h: number };
  readonly enhancedDims?: { w: number; h: number };
  readonly origBytes?: number;
  readonly enhancedBytes?: number;
  readonly enhanceMs?: number;
  readonly message?: string;
}

export async function enhance(
  config: EnhanceConfig,
  input: EnhanceInput,
): Promise<EnhanceOutput> {
  const blob = await imageToBlob(input.image);
  const params = MODE_TO_PARAMS[input.mode];

  const fd = new FormData();
  fd.append('file', blob, 'input.png');
  fd.append('scale', params.scale);
  fd.append('bg', params.bg);
  fd.append('weight', input.strength.toFixed(2));

  const url = `${config.baseUrl.replace(/\/$/, '')}/enhance`;
  // FormData is BodyInit-compatible at runtime in Node 22's undici; the
  // type cast bridges TS's tight RequestInit type without pulling in
  // browser DOM lib types.
  const init = { method: 'POST', body: fd } as unknown as RequestInit;
  const res = await fetch(url, init);
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`picenhancer backend ${res.status}: ${text || '(no body)'}`);
  }

  // Drain the SSE stream; the only frame we keep is the final `done`.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let done: SseEvent | null = null;
  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      try {
        const ev = JSON.parse(dataLine.slice(5).trim()) as SseEvent;
        if (ev.type === 'done') done = ev;
        else if (ev.type === 'error') {
          throw new Error(`picenhancer pipeline error: ${ev.message ?? '(no message)'}`);
        }
      } catch (e) {
        // Malformed JSON line — skip; pipeline `done` is what we need.
        if (e instanceof Error && e.message.startsWith('picenhancer pipeline error')) throw e;
      }
    }
  }
  if (!done) throw new Error('picenhancer stream ended without a done event');

  // Resolve the relative imageUrl against the public-facing baseUrl so
  // the caller can GET it directly (the backend returns paths like
  // /out/<uuid>-pass1-s4.png; we want the proxy-prefixed URL).
  const fullImageUrl = done.imageUrl?.startsWith('http')
    ? done.imageUrl
    : `${config.baseUrl.replace(/\/$/, '')}${done.imageUrl}`;

  return {
    imageUrl: fullImageUrl,
    scale: (done.scale ?? 1) as 1 | 4 | 8 | 16,
    bg: (done.bg ?? 0) as 0 | 1,
    weight: done.weight ?? input.strength,
    faces: done.faces ?? 0,
    origDims: done.origDims ?? { w: 0, h: 0 },
    enhancedDims: done.enhancedDims ?? { w: 0, h: 0 },
    origBytes: done.origBytes ?? 0,
    enhancedBytes: done.enhancedBytes ?? 0,
    enhanceMs: done.enhanceMs ?? 0,
  };
}
