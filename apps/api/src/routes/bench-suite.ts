/**
 * `/v1/bench/suite` — quality × speed model rating, streamed via SSE.
 *
 * Two surfaces:
 *  - `POST /v1/bench/suite` (SSE): streams `BenchSuiteEvent` frames as
 *    each case completes. Body picks a suite (id or inline YAML) +
 *    model + baseUrl + optional max_tokens.
 *  - `GET  /v1/bench/suites`: lists the server-side suites available
 *    by id (today: anything under `agency/eval/<id>/suite.yaml`).
 *
 * The engine lives in `@aldo-ai/bench-suite`. This route only owns:
 *   - input validation,
 *   - SSE serialization,
 *   - server-side suite-id resolution,
 *   - cancellation when the client closes the connection.
 *
 * Auth: tenant-scoped like every other /v1/* route. The tenant doesn't
 * affect the rating itself — it affects rate-limiting and audit.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSuiteByIdOrPath, streamBenchSuite } from '@aldo-ai/bench-suite';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { validationError } from '../middleware/error.js';

/**
 * Resolve `<repo-root>/agency/eval` from this file. Used by both the
 * GET listing and the POST resolver. We accept any directory under
 * `agency/eval` that contains a `suite.yaml`.
 */
function defaultSuiteRoot(): string {
  return fileURLToPath(new URL('../../../../agency/eval', import.meta.url));
}

const StartBenchSuiteRequest = z
  .object({
    /** Server-side suite id (e.g. `local-model-rating`). Mutually exclusive with `yaml`. */
    suiteId: z.string().min(1).optional(),
    /** Inline suite YAML. Mutually exclusive with `suiteId`. */
    yaml: z.string().min(1).optional(),
    /** Pin the model. Required. */
    model: z.string().min(1),
    /** OpenAI-compatible base URL (no `/v1` suffix). Required. */
    baseUrl: z.string().url(),
    /** Max output tokens per case. */
    maxTokens: z.number().int().positive().max(8192).optional(),
  })
  .refine((v) => (v.suiteId !== undefined) !== (v.yaml !== undefined), {
    message: 'exactly one of `suiteId` or `yaml` must be set',
  });

/**
 * SSRF guard. The bench route is unauthenticated (it's the demo),
 * so the user-supplied `baseUrl` must be restricted to networks the
 * caller plausibly owns: loopback (127.0.0.0/8, ::1, localhost) and
 * the standard RFC1918 ranges (10/8, 172.16/12, 192.168/16) plus
 * link-local (169.254/16).
 *
 * Anything else — public IPs, cloud-metadata addresses (169.254.169.254
 * is link-local but matches in CIDR; the explicit deny below kills it),
 * AWS/GCP/Azure metadata services — is rejected with HTTP 400.
 *
 * `localhost` resolves later via the runtime's DNS, but we don't trust
 * resolution: a hostile DNS could rebind to a public IP between this
 * check and the fetch. So we only allow literal hostnames `localhost`
 * + IP-literal `baseUrl`s that match the private-network CIDRs.
 */
const PRIVATE_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
const CLOUD_METADATA_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal']);

export function isPrivateBaseUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (CLOUD_METADATA_HOSTS.has(host)) return false;
  if (PRIVATE_HOSTNAMES.has(host)) return true;
  // Strip IPv6 brackets so `[::1]` is matched above and `[fc00::1]`
  // (unique-local) flows through the IPv4 branches as a non-match.
  if (host.startsWith('[') && host.endsWith(']')) {
    const inner = host.slice(1, -1);
    if (inner === '::1') return true;
    // IPv6 unique-local (fc00::/7) — fc00 + fd00 prefixes.
    if (inner.startsWith('fc') || inner.startsWith('fd')) return true;
    return false;
  }
  // IPv4 literal — split into octets and match RFC1918 + loopback +
  // link-local.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m === null) return false;
  const [, a, b] = m as unknown as [string, string, string, string, string];
  const o1 = Number.parseInt(a, 10);
  const o2 = Number.parseInt(b, 10);
  if (o1 === 127) return true; // loopback
  if (o1 === 10) return true; // 10/8
  if (o1 === 192 && o2 === 168) return true; // 192.168/16
  if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16/12
  if (o1 === 169 && o2 === 254) return true; // link-local (catches metadata via CLOUD_METADATA_HOSTS check above)
  return false;
}

export function benchSuiteRoutes(deps: Deps): Hono {
  void deps;
  const app = new Hono();

  /**
   * GET /v1/bench/suites — list every server-side suite the operator
   * can reference by id. Each entry is `{ id, name, version, description, caseCount }`.
   */
  app.get('/v1/bench/suites', async (c) => {
    const suiteRoot = process.env.ALDO_BENCH_SUITE_ROOT ?? defaultSuiteRoot();
    let entries: string[] = [];
    try {
      entries = await readdir(suiteRoot);
    } catch {
      return c.json({ suites: [] });
    }
    const out: Array<{
      id: string;
      name: string;
      version: string;
      description: string;
      caseCount: number;
    }> = [];
    for (const id of entries) {
      const suitePath = join(suiteRoot, id, 'suite.yaml');
      try {
        const s = await stat(suitePath);
        if (!s.isFile()) continue;
        const yaml = await readFile(suitePath, 'utf8');
        const { parseSuiteYaml } = await import('@aldo-ai/eval');
        const r = parseSuiteYaml(yaml);
        if (!r.ok) continue;
        out.push({
          id,
          name: r.suite.name,
          version: r.suite.version,
          description: r.suite.description,
          caseCount: r.suite.cases.length,
        });
      } catch {
        // skip unreadable entries
      }
    }
    return c.json({ suites: out });
  });

  /**
   * POST /v1/bench/suite — start a rating run, stream per-case results.
   * The connection holds open until the suite completes (or the client
   * disconnects). Each case is a `{ event: 'frame', data: <BenchSuiteEvent> }`
   * SSE frame; a final `{ event: 'done' }` closes the stream.
   */
  app.post('/v1/bench/suite', async (c) => {
    const json = (await c.req.json().catch(() => ({}))) as unknown;
    const parsed = StartBenchSuiteRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid bench/suite request', parsed.error.issues);
    }
    const body = parsed.data;

    // SSRF guard. The route is on the public allow-list (it's the
    // marketing demo) so we MUST refuse a baseUrl that points at a
    // public address. The check runs BEFORE the fetch — we don't
    // resolve DNS, we just match the hostname literal.
    if (!isPrivateBaseUrl(body.baseUrl)) {
      throw validationError(
        'baseUrl must be a loopback or private-network address (127.0.0.1, 10/8, 172.16/12, 192.168/16, link-local, IPv6 unique-local). Public addresses and cloud-metadata hosts are refused.',
        [],
      );
    }

    // Resolve the suite. For `suiteId`, anchor the lookup at the
    // server-configured suite root (so the API doesn't trust an
    // arbitrary path from the client). For inline `yaml`, parse via
    // a synthetic in-memory loader so the prompt-file expansion path
    // still works (callers can include the prompt text in `input:`
    // directly to avoid the file lookup).
    let resolved: { suite: import('@aldo-ai/api-contract').EvalSuite; suiteDir: string };
    try {
      if (body.suiteId !== undefined) {
        const suiteRoot = process.env.ALDO_BENCH_SUITE_ROOT ?? defaultSuiteRoot();
        const r = await resolveSuiteByIdOrPath(body.suiteId, {
          // Anchor the bare-id resolver at the configured suite root.
          // `cwd` is treated as the parent of `agency/eval/<id>/suite.yaml`,
          // so set cwd one level up.
          cwd: fileURLToPath(new URL('..', `file://${suiteRoot}/`)),
        });
        resolved = { suite: r.suite, suiteDir: r.suiteDir };
      } else {
        const { parseSuiteYamlOrThrow } = await import('@aldo-ai/eval');
        const suite = parseSuiteYamlOrThrow(body.yaml ?? '');
        // No suiteDir for inline YAML — file: inputs must be inlined.
        resolved = { suite, suiteDir: process.cwd() };
      }
    } catch (e) {
      throw validationError(
        `could not resolve suite: ${e instanceof Error ? e.message : String(e)}`,
        [],
      );
    }

    return streamSSE(c, async (stream) => {
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      c.req.raw.signal.addEventListener('abort', onAbort);

      try {
        const gen = streamBenchSuite({
          suite: resolved.suite,
          suiteDir: resolved.suiteDir,
          model: body.model,
          baseUrl: body.baseUrl,
          ...(body.maxTokens !== undefined ? { maxTokens: body.maxTokens } : {}),
        });
        for await (const ev of gen) {
          if (ac.signal.aborted) break;
          await stream.writeSSE({
            event: 'frame',
            data: JSON.stringify(ev),
          });
        }
        if (!ac.signal.aborted) {
          await stream.writeSSE({ event: 'done', data: '{}' });
        }
      } catch (err) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            message: err instanceof Error ? err.message : String(err),
          }),
        });
      } finally {
        c.req.raw.signal.removeEventListener('abort', onAbort);
      }
    });
  });

  return app;
}
