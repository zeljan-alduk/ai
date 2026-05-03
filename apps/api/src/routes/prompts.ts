/**
 * `/v1/prompts/*` — Wave-4 (Tier-4) prompts as first-class entities.
 *
 * Closes the Vellum + LangSmith Hub competitive gap. Customers get a
 * versioned, diffable, playground-runnable prompt surface that is
 * disconnected from any individual agent spec. Agent specs gain an
 * additive `promptRef: { id, version }` slot so a deployed agent can
 * hold a stable pointer at a versioned prompt instead of inlining
 * the body in YAML.
 *
 * Endpoints:
 *   GET    /v1/prompts?project=<slug>           list (tenant + project scoped)
 *   POST   /v1/prompts                          create (creates v1 atomically)
 *   GET    /v1/prompts/:id                      detail (header + latest version)
 *   PATCH  /v1/prompts/:id                      rename / re-describe / move project
 *   DELETE /v1/prompts/:id                      soft-delete (gated on no agent ref)
 *   GET    /v1/prompts/:id/versions             history (newest first)
 *   GET    /v1/prompts/:id/versions/:n          one specific version
 *   POST   /v1/prompts/:id/versions             create new version
 *   GET    /v1/prompts/:id/diff?from=&to=       line-by-line diff
 *   POST   /v1/prompts/:id/test                 run against the model gateway
 *   GET    /v1/prompts/:id/used-by              list agent specs referencing this prompt
 *
 * RBAC: writes require `member`-or-above; reads are open to anyone in
 * the tenant.
 *
 * LLM-agnostic: every prompt version stores a capability class only;
 * the gateway resolves the concrete model on /test. A `capabilityOverride`
 * lets the playground compare classes side-by-side without mutating
 * the version.
 */

import {
  CreatePromptRequest,
  CreatePromptVersionRequest,
  GetPromptResponse,
  GetPromptVersionResponse,
  ListPromptVersionsResponse,
  ListPromptsResponse,
  PromptDiffResponse as PromptDiffSchema,
  Prompt as PromptSchema,
  PromptTestRequest,
  PromptTestResponse,
  type PromptVariablesSchema,
  PromptVersion as PromptVersionSchema,
  UpdatePromptRequest,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth, requireRole } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { HttpError, notFound, validationError } from '../middleware/error.js';
import { getDefaultProjectIdForTenant, getProjectBySlug } from '../projects-store.js';
import {
  type AgentReference,
  MissingVariableError,
  PromptNameConflictError,
  type PromptRow,
  type PromptVersionRow,
  diffPromptBodies,
  extractVariableNames,
  getLatestVersion,
  getPromptById,
  getVersion,
  insertPromptWithInitialVersion,
  insertVersion,
  listAgentsReferencingPrompt,
  listPromptsForTenant,
  listVersionsForPrompt,
  promptToWire,
  softDeletePrompt,
  substituteVariables,
  updatePromptMeta,
  versionToWire,
} from '../prompts-store.js';

// ─────────────────────────────────────────── Test runner seam

/**
 * Minimal interface for the model-gateway call the /test endpoint
 * makes. Tests inject a deterministic stub so the SSE/HTTP shape
 * assertions don't depend on a network round-trip.
 *
 * Production wiring resolves the abstract `capability` against the
 * gateway router (the same router that backs /v1/playground/run);
 * the gateway returns a concrete model id + token + cost telemetry.
 *
 * The default v0 implementation is a thin stub that echoes the
 * resolved body back. The wave-4 brief calls for a real run through
 * the gateway; the brief explicitly notes "the same telemetry pipe
 * used by /v1/agents/run" — that pipe lives in the engine package
 * which the api can't pull at build time without breaking the
 * contract. The seam below means the wiring lands cleanly when the
 * engine grows a public `runPrompt(capability, body)` entry point.
 */
export interface PromptRunner {
  run(opts: PromptRunOpts): Promise<PromptRunResult>;
}

export interface PromptRunOpts {
  readonly tenantId: string;
  readonly capability: string;
  readonly body: string;
  readonly maxTokensOut?: number;
}

export interface PromptRunResult {
  readonly output: string;
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly latencyMs: number;
}

const defaultPromptRunner: PromptRunner = {
  async run(opts: PromptRunOpts): Promise<PromptRunResult> {
    const start = Date.now();
    // Stub: echo a deterministic short reply. The web playground
    // surface renders this as-is until the engine wires the real
    // gateway call. Token / cost are estimated so the live counter
    // in the UI moves and the customer sees the LLM-agnostic shape.
    const reply = `[capability=${opts.capability}] ${opts.body.slice(0, 240)}`;
    return {
      output: reply,
      model: `capability:${opts.capability}`,
      tokensIn: estimateTokens(opts.body),
      tokensOut: estimateTokens(reply),
      costUsd: 0,
      latencyMs: Math.max(0, Date.now() - start),
    };
  },
};

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

// ─────────────────────────────────────────── Validators

const PromptIdParam = z.object({ id: z.string().min(1) });
const VersionParam = z.object({ id: z.string().min(1), n: z.coerce.number().int().positive() });
const DiffQuery = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});

// ─────────────────────────────────────────── Helpers

async function readJsonBody(c: { req: { raw: Request } }): Promise<unknown> {
  const text = await c.req.raw.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw validationError('invalid JSON body');
  }
}

async function resolveProjectId(
  deps: Deps,
  tenantId: string,
  slug: string | undefined,
): Promise<string | null> {
  if (slug !== undefined && slug.length > 0) {
    const project = await getProjectBySlug(deps.db, { slug, tenantId });
    if (project === null) throw notFound(`project not found: ${slug}`);
    return project.id;
  }
  return getDefaultProjectIdForTenant(deps.db, tenantId);
}

function nameConflict(name: string): HttpError {
  return new HttpError(
    409,
    'prompt_name_conflict',
    `a prompt with name "${name}" already exists in this project`,
  );
}

function buildPromptDetailWire(prompt: PromptRow, version: PromptVersionRow | null): unknown {
  return {
    ...promptToWire(prompt),
    latest: version === null ? null : versionToWire(version),
  };
}

/**
 * Auto-build a variables_schema from the body. Used when the create
 * request omits `variablesSchema` — the editor calls the same logic
 * client-side, so the server-side fallback keeps the behaviour
 * consistent for raw API callers (curl, SDKs).
 */
function autoBuildVariablesSchema(body: string): PromptVariablesSchema {
  const names = extractVariableNames(body);
  return {
    variables: names.map((name) => ({ name, type: 'string' as const, required: true })),
  };
}

// ─────────────────────────────────────────── Route options

export interface PromptRoutesOptions {
  /** Override the model-gateway runner (tests inject deterministic). */
  readonly runner?: PromptRunner;
}

export function promptsRoutes(deps: Deps, opts: PromptRoutesOptions = {}): Hono {
  const app = new Hono();
  const runner = opts.runner ?? defaultPromptRunner;

  // ------------------------------------------------------------------ list
  app.get('/v1/prompts', async (c) => {
    const auth = getAuth(c);
    const url = new URL(c.req.url);
    const projectSlug = url.searchParams.get('project') ?? undefined;
    const projectId = await resolveProjectId(deps, auth.tenantId, projectSlug);
    const rows = await listPromptsForTenant(deps.db, {
      tenantId: auth.tenantId,
      projectId,
    });
    return c.json(
      ListPromptsResponse.parse({
        prompts: rows.map(promptToWire),
      }),
    );
  });

  // ----------------------------------------------------------------- create
  app.post('/v1/prompts', async (c) => {
    requireRole(c, 'member');
    const json = await readJsonBody(c);
    const parsed = CreatePromptRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid create-prompt request', parsed.error.issues);
    }
    const auth = getAuth(c);
    const projectId = await resolveProjectId(deps, auth.tenantId, parsed.data.project);
    const variablesSchema =
      parsed.data.variablesSchema ?? autoBuildVariablesSchema(parsed.data.body);
    try {
      const { prompt, version } = await insertPromptWithInitialVersion(deps.db, {
        tenantId: auth.tenantId,
        projectId,
        name: parsed.data.name,
        description: parsed.data.description,
        createdBy: auth.userId,
        body: parsed.data.body,
        variablesSchema,
        modelCapability: parsed.data.modelCapability,
        notes: parsed.data.notes ?? 'initial version',
      });
      const body = GetPromptResponse.parse({
        prompt: buildPromptDetailWire(prompt, version),
      });
      return c.json(body, 201);
    } catch (err) {
      if (err instanceof PromptNameConflictError) throw nameConflict(parsed.data.name);
      throw err;
    }
  });

  // ------------------------------------------------------------------- read
  app.get('/v1/prompts/:id', async (c) => {
    const idParsed = PromptIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid prompt id', idParsed.error.issues);
    const auth = getAuth(c);
    const prompt = await getPromptById(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (prompt === null) throw notFound(`prompt not found: ${idParsed.data.id}`);
    const latest = await getLatestVersion(deps.db, { promptId: prompt.id });
    return c.json(GetPromptResponse.parse({ prompt: buildPromptDetailWire(prompt, latest) }));
  });

  // ---------------------------------------------------------------- update
  app.patch('/v1/prompts/:id', async (c) => {
    requireRole(c, 'member');
    const idParsed = PromptIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid prompt id', idParsed.error.issues);
    const json = await readJsonBody(c);
    const parsed = UpdatePromptRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid update-prompt request', parsed.error.issues);
    }
    if (
      parsed.data.name === undefined &&
      parsed.data.description === undefined &&
      parsed.data.project === undefined
    ) {
      throw validationError('update-prompt requires at least one field');
    }
    const auth = getAuth(c);
    const existing = await getPromptById(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
    });
    if (existing === null) throw notFound(`prompt not found: ${idParsed.data.id}`);
    let projectId: string | null | undefined = undefined;
    if (parsed.data.project !== undefined) {
      projectId = await resolveProjectId(deps, auth.tenantId, parsed.data.project);
    }
    try {
      const updated = await updatePromptMeta(deps.db, {
        id: existing.id,
        tenantId: auth.tenantId,
        patch: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.description !== undefined
            ? { description: parsed.data.description }
            : {}),
          ...(projectId !== undefined ? { projectId } : {}),
        },
      });
      if (updated === null) throw notFound(`prompt not found: ${idParsed.data.id}`);
      const latest = await getLatestVersion(deps.db, { promptId: updated.id });
      return c.json(GetPromptResponse.parse({ prompt: buildPromptDetailWire(updated, latest) }));
    } catch (err) {
      if (err instanceof PromptNameConflictError) throw nameConflict(parsed.data.name ?? '');
      throw err;
    }
  });

  // ---------------------------------------------------------------- delete
  app.delete('/v1/prompts/:id', async (c) => {
    requireRole(c, 'member');
    const idParsed = PromptIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid prompt id', idParsed.error.issues);
    const auth = getAuth(c);
    const existing = await getPromptById(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
    });
    if (existing === null) throw notFound(`prompt not found: ${idParsed.data.id}`);
    // Gate on agent references — we don't want to break a deployed
    // agent that points at this prompt. The /used-by endpoint surfaces
    // the same list so the caller can deal with the conflict UI-side.
    const refs = await listAgentsReferencingPrompt(deps.db, {
      tenantId: auth.tenantId,
      promptId: existing.id,
    });
    if (refs.length > 0) {
      throw new HttpError(
        409,
        'prompt_in_use',
        `prompt is referenced by ${refs.length} agent spec${refs.length === 1 ? '' : 's'}; remove the references first`,
        { agents: refs },
      );
    }
    const removed = await softDeletePrompt(deps.db, {
      id: existing.id,
      tenantId: auth.tenantId,
    });
    if (!removed) throw notFound(`prompt not found: ${idParsed.data.id}`);
    return new Response(null, { status: 204 });
  });

  // -------------------------------------------------------- list versions
  app.get('/v1/prompts/:id/versions', async (c) => {
    const idParsed = PromptIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid prompt id', idParsed.error.issues);
    const auth = getAuth(c);
    const prompt = await getPromptById(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (prompt === null) throw notFound(`prompt not found: ${idParsed.data.id}`);
    const rows = await listVersionsForPrompt(deps.db, { promptId: prompt.id });
    return c.json(
      ListPromptVersionsResponse.parse({
        versions: rows.map(versionToWire),
      }),
    );
  });

  // -------------------------------------------------------- get version
  app.get('/v1/prompts/:id/versions/:n', async (c) => {
    const parsed = VersionParam.safeParse({ id: c.req.param('id'), n: c.req.param('n') });
    if (!parsed.success) throw validationError('invalid prompt version', parsed.error.issues);
    const auth = getAuth(c);
    const prompt = await getPromptById(deps.db, { id: parsed.data.id, tenantId: auth.tenantId });
    if (prompt === null) throw notFound(`prompt not found: ${parsed.data.id}`);
    const version = await getVersion(deps.db, {
      promptId: prompt.id,
      version: parsed.data.n,
    });
    if (version === null) throw notFound(`version not found: ${parsed.data.n}`);
    return c.json(GetPromptVersionResponse.parse({ version: versionToWire(version) }));
  });

  // -------------------------------------------------- create new version
  app.post('/v1/prompts/:id/versions', async (c) => {
    requireRole(c, 'member');
    const idParsed = PromptIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid prompt id', idParsed.error.issues);
    const json = await readJsonBody(c);
    const parsed = CreatePromptVersionRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid create-version request', parsed.error.issues);
    }
    const auth = getAuth(c);
    const prompt = await getPromptById(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (prompt === null) throw notFound(`prompt not found: ${idParsed.data.id}`);
    // If the caller passed a parentVersionId, validate it belongs to
    // this prompt — otherwise a typo could silently fork from a
    // different prompt's history.
    let parentVersionId: string | null = null;
    if (parsed.data.parentVersionId !== undefined) {
      const versions = await listVersionsForPrompt(deps.db, { promptId: prompt.id });
      const parent = versions.find((v) => v.id === parsed.data.parentVersionId);
      if (parent === undefined) {
        throw validationError(
          `parent version not found in this prompt: ${parsed.data.parentVersionId}`,
        );
      }
      parentVersionId = parent.id;
    }
    // When the caller omits modelCapability, inherit from the latest
    // version so an "edit + save" flow doesn't silently reset the
    // capability class to the default.
    const latest = await getLatestVersion(deps.db, { promptId: prompt.id });
    const modelCapability =
      parsed.data.modelCapability ?? latest?.modelCapability ?? 'reasoning-medium';
    const variablesSchema =
      parsed.data.variablesSchema ?? autoBuildVariablesSchema(parsed.data.body);
    const { version } = await insertVersion(deps.db, {
      promptId: prompt.id,
      tenantId: auth.tenantId,
      body: parsed.data.body,
      variablesSchema,
      modelCapability,
      notes: parsed.data.notes,
      createdBy: auth.userId,
      parentVersionId,
    });
    return c.json(GetPromptVersionResponse.parse({ version: versionToWire(version) }), 201);
  });

  // ------------------------------------------------------------------ diff
  app.get('/v1/prompts/:id/diff', async (c) => {
    const idParsed = PromptIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid prompt id', idParsed.error.issues);
    const url = new URL(c.req.url);
    const queryParsed = DiffQuery.safeParse({
      from: url.searchParams.get('from') ?? '',
      to: url.searchParams.get('to') ?? '',
    });
    if (!queryParsed.success) throw validationError('invalid diff query', queryParsed.error.issues);
    const auth = getAuth(c);
    const prompt = await getPromptById(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (prompt === null) throw notFound(`prompt not found: ${idParsed.data.id}`);
    const fromVersion = await getVersion(deps.db, {
      promptId: prompt.id,
      version: queryParsed.data.from,
    });
    if (fromVersion === null) throw notFound(`version not found: ${queryParsed.data.from}`);
    const toVersion = await getVersion(deps.db, {
      promptId: prompt.id,
      version: queryParsed.data.to,
    });
    if (toVersion === null) throw notFound(`version not found: ${queryParsed.data.to}`);
    const diff = diffPromptBodies(
      fromVersion.body,
      toVersion.body,
      fromVersion.version,
      toVersion.version,
    );
    return c.json(PromptDiffSchema.parse(diff));
  });

  // ------------------------------------------------------------------ test
  app.post('/v1/prompts/:id/test', async (c) => {
    requireRole(c, 'member');
    const idParsed = PromptIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid prompt id', idParsed.error.issues);
    const json = await readJsonBody(c);
    const parsed = PromptTestRequest.safeParse(json);
    if (!parsed.success) throw validationError('invalid test request', parsed.error.issues);
    const auth = getAuth(c);
    const prompt = await getPromptById(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (prompt === null) throw notFound(`prompt not found: ${idParsed.data.id}`);
    const target =
      parsed.data.version !== undefined
        ? await getVersion(deps.db, { promptId: prompt.id, version: parsed.data.version })
        : await getLatestVersion(deps.db, { promptId: prompt.id });
    if (target === null) {
      throw notFound(
        parsed.data.version !== undefined
          ? `version not found: ${parsed.data.version}`
          : 'prompt has no versions yet',
      );
    }
    let resolvedBody: string;
    try {
      resolvedBody = substituteVariables(
        target.body,
        parsed.data.variables,
        target.variablesSchema,
      );
    } catch (err) {
      if (err instanceof MissingVariableError) {
        throw new HttpError(422, 'missing_variables', err.message, { missing: err.missing });
      }
      throw err;
    }
    const capability = parsed.data.capabilityOverride ?? target.modelCapability;
    const result = await runner.run({
      tenantId: auth.tenantId,
      capability,
      body: resolvedBody,
    });
    return c.json(
      PromptTestResponse.parse({
        version: target.version,
        resolvedBody,
        output: result.output,
        model: result.model,
        capabilityUsed: capability,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
      }),
    );
  });

  // --------------------------------------------------------------- used-by
  app.get('/v1/prompts/:id/used-by', async (c) => {
    const idParsed = PromptIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid prompt id', idParsed.error.issues);
    const auth = getAuth(c);
    const prompt = await getPromptById(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (prompt === null) throw notFound(`prompt not found: ${idParsed.data.id}`);
    const refs = await listAgentsReferencingPrompt(deps.db, {
      tenantId: auth.tenantId,
      promptId: prompt.id,
    });
    return c.json({ agents: refs satisfies readonly AgentReference[] });
  });

  // Ensure unused imports survive tree-shaking guards on the contract types.
  void PromptSchema;
  void PromptVersionSchema;

  return app;
}
