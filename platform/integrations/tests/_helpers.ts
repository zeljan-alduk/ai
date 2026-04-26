/**
 * Tiny in-process HTTP server for runner tests. We don't use a real
 * Slack/Discord/GitHub endpoint — we spin up a localhost server, make
 * the runner POST to it, and assert on the body + headers we received.
 *
 * The server lets each test override its response (status, delay, body)
 * so the four runner test cases (success, failure, timeout, signature)
 * can share one transport.
 */

import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CapturedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface MockServerHandle {
  readonly url: string;
  readonly requests: CapturedRequest[];
  setResponse(opts: {
    status?: number;
    body?: string;
    headers?: Record<string, string>;
    delayMs?: number;
  }): void;
  close(): Promise<void>;
}

export async function startMockServer(): Promise<MockServerHandle> {
  const requests: CapturedRequest[] = [];
  let response: { status: number; body: string; headers: Record<string, string>; delayMs: number } =
    {
      status: 200,
      body: 'ok',
      headers: { 'content-type': 'text/plain' },
      delayMs: 0,
    };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v;
        else if (Array.isArray(v)) headers[k] = v.join(', ');
      }
      requests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers,
        body,
      });
      const sendNow = () => {
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      };
      if (response.delayMs > 0) {
        setTimeout(sendNow, response.delayMs);
      } else {
        sendNow();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    requests,
    setResponse(opts) {
      response = {
        status: opts.status ?? 200,
        body: opts.body ?? 'ok',
        headers: opts.headers ?? { 'content-type': 'text/plain' },
        delayMs: opts.delayMs ?? 0,
      };
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err !== undefined ? reject(err) : resolve())),
      );
    },
  };
}

/**
 * Re-route a runner's hardcoded host (e.g. hooks.slack.com) to our
 * local mock by rewriting the URL string. Each runner module exposes
 * a hostname guard, so the test must construct a URL that *passes*
 * the hostname check — we do that by wiring the runner's fetch via
 * a global fetch override that rewrites the URL transparently.
 *
 * Returns a teardown function the test calls in afterEach.
 */
export function patchFetchToServer(allowedHosts: string[], serverUrl: string): () => void {
  const original = globalThis.fetch;
  const wrapper = async (input: string | URL | Request, init?: RequestInit) => {
    const urlStr =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(urlStr);
    if (allowedHosts.includes(u.hostname)) {
      // Rewrite to local mock; preserve path + query so GitHub-style
      // path-encoded targets (`/repos/x/y/issues/1/comments`) reach
      // the mock and show up in `requests[0].url`.
      const target = new URL(serverUrl);
      target.pathname = u.pathname;
      target.search = u.search;
      return original(target.toString(), init);
    }
    return original(urlStr, init);
  };
  globalThis.fetch = wrapper as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
