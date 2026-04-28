/**
 * Internal HTTP transport. One function: `request<T>()`. Used by every
 * resource module. Not exported from the package.
 */

import { AldoNetworkError, parseApiError } from './errors.js';

export interface HttpClientConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Default 30s. */
  readonly timeoutMs?: number;
  /** Optional fetch override for tests. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Extra headers applied to every request — useful for User-Agent
   * pinning in customer apps. The SDK always sets `authorization`,
   * `accept`, and (when sending a body) `content-type`; those win.
   */
  readonly headers?: Record<string, string>;
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: unknown;
  /** AbortSignal so a caller can cancel a long-running request. */
  readonly signal?: AbortSignal;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly extraHeaders: Record<string, string>;

  constructor(cfg: HttpClientConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '');
    this.apiKey = cfg.apiKey;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.fetchImpl = cfg.fetch ?? globalThis.fetch.bind(globalThis);
    this.extraHeaders = cfg.headers ?? {};
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (opts.query !== undefined) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined || v === '') continue;
        url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      ...this.extraHeaders,
      accept: 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    // Compose an AbortSignal that respects both the per-call signal
    // and our own timeout.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const onCallerAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onCallerAbort);

    let res: Response;
    try {
      const init: RequestInit = {
        method: opts.method ?? 'GET',
        headers,
        signal: controller.signal,
      };
      if (body !== undefined) init.body = body;
      res = await this.fetchImpl(url.toString(), init);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new AldoNetworkError('request aborted', err);
      }
      throw new AldoNetworkError(
        `network error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', onCallerAbort);
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON body (HTML error page from an edge proxy, etc.).
        // Surface what we got so the caller can debug.
        if (!res.ok) {
          throw parseApiError(res.status, {
            error: { code: 'non_json_response', message: text.slice(0, 200) },
          });
        }
        throw new AldoNetworkError(`non-JSON response: ${text.slice(0, 200)}`);
      }
    }

    if (!res.ok) {
      throw parseApiError(res.status, parsed);
    }
    return parsed as T;
  }
}
