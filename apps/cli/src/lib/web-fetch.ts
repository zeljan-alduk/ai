/**
 * `/web <url>` runner — fetches a URL, strips HTML to readable
 * text, returns a markdown block suitable for injection into the
 * next conversation turn.
 *
 * Pure-ish: only does network I/O. Caller owns where the result
 * goes (system entry, follow-up brief, etc.). Mirrors how
 * Claude Code / Aider handle URL injection.
 *
 * Hard caps:
 *   - 256 KB body cap. Larger responses are truncated with a tail
 *     marker — saves the model's context window from a huge page.
 *   - 30s timeout via AbortController.
 *   - Only http(s) schemes. file:// / data:// / ftp:// are refused.
 *   - Hostname allowlist is intentionally NOT enforced — the user
 *     typed the URL, they own the choice. The status line surfaces
 *     the host so an accidental paste is visible.
 */

const MAX_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface WebFetchOptions {
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface WebFetchResult {
  readonly url: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly bytes: number;
  readonly truncated: boolean;
  /** Body, decoded as UTF-8, optionally HTML-stripped if content-type was HTML. */
  readonly body: string;
}

export class WebFetchError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'WebFetchError';
    if (cause !== undefined) this.cause = cause;
  }
}

export async function webFetch(
  rawUrl: string,
  opts: WebFetchOptions = {},
): Promise<WebFetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new WebFetchError(`invalid URL: ${rawUrl}`, err);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebFetchError(`refused scheme '${parsed.protocol}': only http/https are allowed`);
  }

  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.5',
        'user-agent': 'aldo-cli/0.0',
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new WebFetchError(`fetch failed: ${err instanceof Error ? err.message : String(err)}`, err);
  }
  clearTimeout(timer);

  const contentType = res.headers.get('content-type');
  const buf = new Uint8Array(await res.arrayBuffer());
  const truncated = buf.length > maxBytes;
  const slice = truncated ? buf.slice(0, maxBytes) : buf;
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(slice);
  const body = isHtml(contentType, decoded) ? stripHtml(decoded) : decoded;

  return {
    url: parsed.toString(),
    status: res.status,
    contentType,
    bytes: buf.length,
    truncated,
    body,
  };
}

/**
 * Render the fetch result as a markdown block ready to drop into
 * a conversation. Header carries the URL, status, content-type,
 * and byte-count so the model can reason about provenance.
 */
export function renderWebFetchBlock(r: WebFetchResult): string {
  const headerParts = [
    `[WEB] ${r.url}`,
    `status=${r.status}`,
    r.contentType !== null ? `type=${r.contentType.split(';')[0]?.trim() ?? r.contentType}` : '',
    `bytes=${r.bytes}${r.truncated ? ' (truncated)' : ''}`,
  ].filter((s) => s.length > 0);
  return [headerParts.join(' · '), '', '```text', r.body, '```'].join('\n');
}

function isHtml(contentType: string | null, body: string): boolean {
  if (contentType !== null && /text\/html|application\/xhtml/i.test(contentType)) return true;
  // Heuristic for servers that serve HTML with text/plain or no
  // content-type at all.
  return /<\s*html[\s>]|<\s*head[\s>]|<\s*body[\s>]/i.test(body.slice(0, 4096));
}

/**
 * HTML → plain text. Strips <script>/<style> blocks entirely, peels
 * tags, decodes the few entities people actually hit (`&amp;`,
 * `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;`). Not a real DOM
 * parser; we don't need one for "drop a doc page into the LLM's
 * context".
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
