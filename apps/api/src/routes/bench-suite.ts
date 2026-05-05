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
