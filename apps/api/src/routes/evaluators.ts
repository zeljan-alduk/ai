/**
 * `/v1/evaluators` — Wave-16 custom evaluators.
 *
 * Tenant-scoped CRUD over the `evaluators` table (migration 014). The
 * row's `kind` selects the runner (`exact_match` / `contains` /
 * `regex` / `json_schema` / `llm_judge`); for `llm_judge` we route the
 * judge call through whatever `JudgeGateway` is wired into the deps
 * bag (production wires the platform `ModelGateway`; tests inject a
 * deterministic stub).
 *
 * Endpoints:
 *   GET    /v1/evaluators              list (tenant-scoped)
 *   POST   /v1/evaluators              create
 *   GET    /v1/evaluators/:id          read
 *   PATCH  /v1/evaluators/:id          update name/config/share
 *   DELETE /v1/evaluators/:id          delete
 *   POST   /v1/evaluators/:id/test     run the evaluator on (input, output, expected)
 *
 * RBAC: writes require `member`-or-above; reads are open to anyone in
 * the tenant. Per the wave-14 contract, only the author of an
 * evaluator may edit/delete it (route layer enforces).
 *
 * LLM-agnostic: `llm_judge` configs carry a `model_class` capability
 * string. The gateway picks the actual model. Privacy is honoured —
 * an `internal` privacy tier means the judge can route to local or
 * cloud models per the platform router; `sensitive` would (and the
 * router enforces) refuse cloud routing.
 */

import {
  CreateEvaluatorRequest,
  Evaluator,
  type EvaluatorKind,
  ListEvaluatorsResponse,
  TestEvaluatorRequest,
  TestEvaluatorResponse,
  UpdateEvaluatorRequest,
} from '@aldo-ai/api-contract';
import {
  type EvaluationResult,
  type EvaluatorContext,
  evaluateLlmJudge,
  runStoredEvaluator,
} from '@aldo-ai/eval';
import type { ModelGateway } from '@aldo-ai/types';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth, requireRole } from '../auth/middleware.js';
import {
  type EvaluatorRow,
  deleteEvaluator,
  getEvaluatorById,
  insertEvaluator,
  listEvaluators,
  updateEvaluator,
} from '../datasets/evaluators-store.js';
import type { Deps } from '../deps.js';
import { HttpError, notFound, validationError } from '../middleware/error.js';

const EvaluatorIdParam = z.object({ id: z.string().min(1) });

/**
 * Judge-gateway seam. Production wires the platform model gateway;
 * tests inject a deterministic stub. The route never imports a
 * provider SDK directly.
 */
export interface JudgeGateway {
  readonly gateway: ModelGateway;
}

export interface EvaluatorRouteOptions {
  /** Override the judge gateway (tests pass a stub). */
  readonly judge?: JudgeGateway;
}

export function evaluatorsRoutes(deps: Deps, opts: EvaluatorRouteOptions = {}): Hono {
  const app = new Hono();

  // ---------------------------------------------------------------- list
  app.get('/v1/evaluators', async (c) => {
    const auth = getAuth(c);
    const rows = await listEvaluators(deps.db, { tenantId: auth.tenantId });
    const body = ListEvaluatorsResponse.parse({
      evaluators: rows.map((r) => toWire(r, auth.userId)),
    });
    return c.json(body);
  });

  // -------------------------------------------------------------- create
  app.post('/v1/evaluators', async (c) => {
    requireRole(c, 'member');
    const json = await readJsonBody(c);
    const parsed = CreateEvaluatorRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid create-evaluator request', parsed.error.issues);
    }
    const auth = getAuth(c);
    const row = await insertEvaluator(deps.db, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      config: parsed.data.config,
      ...(parsed.data.isShared !== undefined ? { isShared: parsed.data.isShared } : {}),
    });
    return c.json(Evaluator.parse(toWire(row, auth.userId)), 201);
  });

  // ---------------------------------------------------------------- read
  app.get('/v1/evaluators/:id', async (c) => {
    const idParsed = EvaluatorIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid evaluator id', idParsed.error.issues);
    const auth = getAuth(c);
    const row = await getEvaluatorById(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
    });
    if (row === null) throw notFound(`evaluator not found: ${idParsed.data.id}`);
    return c.json(Evaluator.parse(toWire(row, auth.userId)));
  });

  // -------------------------------------------------------------- update
  app.patch('/v1/evaluators/:id', async (c) => {
    requireRole(c, 'member');
    const idParsed = EvaluatorIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid evaluator id', idParsed.error.issues);
    const json = await readJsonBody(c);
    const parsed = UpdateEvaluatorRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid update-evaluator request', parsed.error.issues);
    }
    const auth = getAuth(c);
    const existing = await getEvaluatorById(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
    });
    if (existing === null) throw notFound(`evaluator not found: ${idParsed.data.id}`);
    if (existing.userId !== auth.userId) {
      // Author-only writes — surface as 404 to mirror the saved-views
      // disclosure stance ("the row you can edit doesn't exist").
      throw notFound(`evaluator not found: ${idParsed.data.id}`);
    }
    const updated = await updateEvaluator(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
      patch: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.config !== undefined ? { config: parsed.data.config } : {}),
        ...(parsed.data.isShared !== undefined ? { isShared: parsed.data.isShared } : {}),
      },
    });
    if (updated === null) throw notFound(`evaluator not found: ${idParsed.data.id}`);
    return c.json(Evaluator.parse(toWire(updated, auth.userId)));
  });

  // -------------------------------------------------------------- delete
  app.delete('/v1/evaluators/:id', async (c) => {
    requireRole(c, 'member');
    const idParsed = EvaluatorIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid evaluator id', idParsed.error.issues);
    const auth = getAuth(c);
    const existing = await getEvaluatorById(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
    });
    if (existing === null) throw notFound(`evaluator not found: ${idParsed.data.id}`);
    if (existing.userId !== auth.userId) {
      throw notFound(`evaluator not found: ${idParsed.data.id}`);
    }
    const removed = await deleteEvaluator(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
    });
    if (!removed) throw notFound(`evaluator not found: ${idParsed.data.id}`);
    return new Response(null, { status: 204 });
  });

  // ---------------------------------------------------------------- test
  app.post('/v1/evaluators/:id/test', async (c) => {
    requireRole(c, 'member');
    const idParam = c.req.param('id');
    const json = await readJsonBody(c);
    const parsed = TestEvaluatorRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid test-evaluator request', parsed.error.issues);
    }
    const auth = getAuth(c);

    // Resolve the evaluator: either the URL id (canonical) OR an
    // inline `kind` + `config` for the "test before save" panel.
    let kind: EvaluatorKind;
    let config: Record<string, unknown>;
    if (idParam !== '__inline__') {
      const row = await getEvaluatorById(deps.db, { id: idParam, tenantId: auth.tenantId });
      if (row === null) throw notFound(`evaluator not found: ${idParam}`);
      kind = row.kind;
      config = row.config;
    } else if (parsed.data.kind !== undefined) {
      kind = parsed.data.kind;
      config = parsed.data.config ?? {};
    } else {
      throw validationError('inline test requires `kind` + `config`');
    }

    // Build the evaluator context. The gateway is only required for
    // llm_judge — built-in kinds never reach for it.
    const ctx: EvaluatorContext = {
      ...(opts.judge?.gateway !== undefined ? { judgeGateway: opts.judge.gateway } : {}),
      tenant: auth.tenantId,
      ...(parsed.data.expected !== undefined ? { expected: parsed.data.expected } : {}),
      ...(parsed.data.input !== undefined ? { input: parsed.data.input } : {}),
    };

    let result: EvaluationResult;
    if (kind === 'llm_judge') {
      if (opts.judge?.gateway === undefined) {
        // Refuse to run when no gateway is wired — mirrors the rubric
        // path's behaviour. Returns 422 so callers can surface a
        // useful message ("configure the gateway"); we don't 500.
        throw new HttpError(
          422,
          'judge_gateway_unavailable',
          'llm_judge requires the judge gateway, which is not wired in this deployment',
        );
      }
      const promptStr = typeof config.prompt === 'string' ? config.prompt : '';
      const modelClass =
        typeof config.model_class === 'string' ? config.model_class : 'reasoning-medium';
      const outputSchema =
        config.output_schema !== undefined && config.output_schema !== null
          ? (config.output_schema as Record<string, unknown>)
          : undefined;
      result = await evaluateLlmJudge(parsed.data.output, {
        prompt: promptStr,
        modelClass,
        gateway: opts.judge.gateway,
        tenant: auth.tenantId,
        ...(outputSchema !== undefined ? { outputSchema } : {}),
        ...(parsed.data.expected !== undefined ? { expected: parsed.data.expected } : {}),
        ...(parsed.data.input !== undefined ? { input: parsed.data.input } : {}),
      });
    } else {
      result = await runStoredEvaluator(parsed.data.output, { id: idParam, kind, config }, ctx);
    }

    const reason =
      result.detail !== null &&
      typeof result.detail === 'object' &&
      typeof (result.detail as { error?: unknown }).error === 'string'
        ? ((result.detail as { error: string }).error as string)
        : undefined;
    const body = TestEvaluatorResponse.parse({
      passed: result.passed,
      score: result.score,
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
      ...(reason !== undefined ? { reason } : {}),
    });
    return c.json(body);
  });

  return app;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toWire(r: EvaluatorRow, callerUserId: string): z.infer<typeof Evaluator> {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    config: r.config,
    isShared: r.isShared,
    ownedByMe: r.userId === callerUserId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function readJsonBody(c: { req: { raw: Request } }): Promise<unknown> {
  const text = await c.req.raw.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw validationError('invalid JSON body');
  }
}
