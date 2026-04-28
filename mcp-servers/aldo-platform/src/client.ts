/**
 * Thin REST client used by every tool handler.
 *
 * The MCP server's job is to translate MCP JSON-RPC calls into
 * authenticated HTTP requests against the platform API. We don't
 * import `@aldo-ai/api-contract` for parsing — keeping the client
 * dependency-free makes the package easy to vendor or fork.
 *
 * Errors are surfaced as `RestError` instances with `status` + `code`
 * fields so the server layer can convert them into structured MCP
 * tool errors (`isError: true`).
 */

export class RestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
  constructor(status: number, code: string, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
    this.name = 'RestError';
  }
}

export interface RestClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Optional override for tests. */
  readonly fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly query?: Record<string, string | number | undefined>;
  readonly body?: unknown;
  /** AbortSignal so the MCP host can cancel a long-running request. */
  readonly signal?: AbortSignal;
}

export class RestClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: RestClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (opts.query !== undefined) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined || v === '') continue;
        url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
    };
    if (body !== undefined) init.body = body;
    if (opts.signal !== undefined) init.signal = opts.signal;

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), init);
    } catch (err) {
      throw new RestError(
        0,
        'network_error',
        `aldo-mcp-platform: ${err instanceof Error ? err.message : String(err)}`,
        null,
      );
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON body (e.g. HTML error page from a misconfigured
        // edge proxy). Surface it as a parse_error so the user gets
        // something more useful than `[object Object]`.
        throw new RestError(
          res.status,
          'non_json_response',
          `aldo-mcp-platform: server returned non-JSON ${res.status}: ${text.slice(0, 200)}`,
          text,
        );
      }
    }

    if (!res.ok) {
      const errEnvelope = parsed as { error?: { code?: string; message?: string } } | null;
      const code = errEnvelope?.error?.code ?? 'http_error';
      const message = errEnvelope?.error?.message ?? `HTTP ${res.status}`;
      throw new RestError(res.status, code, message, parsed);
    }

    return parsed as T;
  }
}
