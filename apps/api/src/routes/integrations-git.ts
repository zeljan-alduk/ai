/**
 * `/v1/integrations/git/*` — wave-18 (Tier 3.5) Git integration.
 *
 * Endpoints (RBAC ladder shown in parens):
 *
 *   POST   /v1/integrations/git/repos                  connect a repo (admin)
 *   GET    /v1/integrations/git/repos?project=<slug>   list connected repos (member)
 *   GET    /v1/integrations/git/repos/:id              one repo (member)
 *   GET    /v1/integrations/git/repos/:id/syncs        recent sync history (member)
 *   DELETE /v1/integrations/git/repos/:id              disconnect (admin)
 *   POST   /v1/integrations/git/repos/:id/sync         manual sync (member)
 *   POST   /v1/webhooks/git/:provider/:repoId          push webhook (UNAUTH, signed)
 *
 * The webhook endpoint must be reachable WITHOUT a session token (push
 * deliveries are anonymous from GitHub/GitLab). It is added to the
 * public allow-list in `auth/middleware.ts` via the
 * `/v1/webhooks/git/` prefix; the route handler verifies the
 * provider-specific signature against the stored `webhook_secret`
 * before touching any state.
 *
 * Privacy / token handling:
 *   - The PAT is NEVER stored on `project_repos`. Customers paste it
 *     once into the connect form; the route writes it into the wave-7
 *     SecretStore under a deterministic name (`git/<repoId>/token`)
 *     and stores only the secret name on the repo row.
 *   - The webhook signing secret IS plaintext on disk. It's an opaque
 *     per-repo string we generate at connect-time, return ONCE in the
 *     create response, and feed back into HMAC verification on each
 *     webhook delivery. See migration 023 file header for rationale.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../auth/audit.js';
import { getAuth, requireRole } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import {
  ProjectRepoConflictError,
  createProjectRepo,
  deleteProjectRepo,
  generateWebhookSecret,
  getProjectRepoById,
  getWebhookSecret,
  listProjectRepos,
  listSyncRuns,
  recordSyncRun,
  updateLastSync,
} from '../integrations/git/store.js';
import { runSync } from '../integrations/git/sync.js';
import type { GitProvider, ProjectRepo, ProjectRepoSync } from '../integrations/git/types.js';
import { verifyGithubSignature, verifyGitlabSignature } from '../integrations/git/webhook.js';
import { HttpError, notFound, validationError } from '../middleware/error.js';
import { getProjectBySlug } from '../projects-store.js';

const ProviderEnum = z.enum(['github', 'gitlab']);

const ConnectRepoBody = z.object({
  project: z.string().min(1, 'project slug required'),
  provider: ProviderEnum,
  repoOwner: z.string().min(1, 'repoOwner required'),
  repoName: z.string().min(1, 'repoName required'),
  defaultBranch: z.string().min(1).default('main'),
  specPath: z.string().min(1).default('aldo/agents'),
  /**
   * PAT pasted once into the form. Stored in the secret store under a
   * deterministic name; never round-tripped on read. Optional — a
   * customer who connects a fully-public mirror can skip auth.
   */
  accessToken: z.string().min(1).optional(),
});

const SyncBody = z
  .object({
    /** When true, removed-from-repo agents are soft-deleted from the registry. */
    prune: z.boolean().default(false),
  })
  .partial();

const RepoIdParam = z.object({ id: z.string().min(1) });

export function integrationsGitRoutes(deps: Deps): Hono {
  const app = new Hono();

  // ---------------------------------------------------------------------
  // POST /v1/integrations/git/repos — connect a repo.
  // ---------------------------------------------------------------------
  app.post('/v1/integrations/git/repos', async (c) => {
    requireRole(c, 'admin');
    const auth = getAuth(c);
    const json = await safeJson(c.req.raw);
    const parsed = ConnectRepoBody.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid connect-repo body', parsed.error.issues);
    }
    const project = await getProjectBySlug(deps.db, {
      slug: parsed.data.project,
      tenantId: auth.tenantId,
    });
    if (project === null) {
      throw notFound(`project not found: ${parsed.data.project}`);
    }

    const repoId = randomUUID();
    let secretName: string | null = null;
    if (parsed.data.accessToken !== undefined) {
      const store = deps.secrets?.store;
      if (store === undefined) {
        throw new HttpError(503, 'not_configured', 'secrets store is not configured');
      }
      secretName = `git/${repoId}/token`;
      await store.set(auth.tenantId, secretName, parsed.data.accessToken);
    }

    const webhookSecret = generateWebhookSecret();
    let row: ProjectRepo;
    try {
      row = await createProjectRepo(deps.db, {
        tenantId: auth.tenantId,
        projectId: project.id,
        provider: parsed.data.provider,
        repoOwner: parsed.data.repoOwner,
        repoName: parsed.data.repoName,
        defaultBranch: parsed.data.defaultBranch,
        specPath: parsed.data.specPath,
        accessTokenSecretName: secretName,
        webhookSecret,
      });
    } catch (err) {
      if (err instanceof ProjectRepoConflictError) {
        throw new HttpError(
          409,
          'repo_already_connected',
          `${parsed.data.provider}:${parsed.data.repoOwner}/${parsed.data.repoName} is already connected to project "${parsed.data.project}"`,
        );
      }
      throw err;
    }
    await recordAudit(deps.db, c, {
      verb: 'git_repo.connect',
      objectKind: 'project_repo',
      objectId: row.id,
      metadata: { provider: row.provider, repo: `${row.repoOwner}/${row.repoName}` },
    });
    // Webhook secret is returned ONCE here so the customer can paste it
    // into GitHub/GitLab's webhook settings. Subsequent reads omit it.
    return c.json(
      {
        repo: toWire(row),
        webhookSecret,
        webhookUrl: webhookUrlFor(row.provider, row.id),
      },
      201,
    );
  });

  // ---------------------------------------------------------------------
  // GET /v1/integrations/git/repos
  // ---------------------------------------------------------------------
  app.get('/v1/integrations/git/repos', async (c) => {
    requireRole(c, 'member');
    const auth = getAuth(c);
    const url = new URL(c.req.url);
    const projectSlug = url.searchParams.get('project') ?? undefined;
    let projectIdFilter: string | undefined;
    if (projectSlug !== undefined) {
      const proj = await getProjectBySlug(deps.db, {
        slug: projectSlug,
        tenantId: auth.tenantId,
      });
      if (proj === null) throw notFound(`project not found: ${projectSlug}`);
      projectIdFilter = proj.id;
    }
    const rows = await listProjectRepos(deps.db, {
      tenantId: auth.tenantId,
      ...(projectIdFilter !== undefined ? { projectId: projectIdFilter } : {}),
    });
    return c.json({ repos: rows.map(toWire) });
  });

  // ---------------------------------------------------------------------
  // GET /v1/integrations/git/repos/:id
  // ---------------------------------------------------------------------
  app.get('/v1/integrations/git/repos/:id', async (c) => {
    requireRole(c, 'member');
    const param = RepoIdParam.safeParse({ id: c.req.param('id') });
    if (!param.success) throw validationError('invalid repo id', param.error.issues);
    const auth = getAuth(c);
    const repo = await getProjectRepoById(deps.db, {
      id: param.data.id,
      tenantId: auth.tenantId,
    });
    if (repo === null) throw notFound(`repo not found: ${param.data.id}`);
    return c.json({ repo: toWire(repo) });
  });

  // ---------------------------------------------------------------------
  // GET /v1/integrations/git/repos/:id/syncs — sync history
  // ---------------------------------------------------------------------
  app.get('/v1/integrations/git/repos/:id/syncs', async (c) => {
    requireRole(c, 'member');
    const param = RepoIdParam.safeParse({ id: c.req.param('id') });
    if (!param.success) throw validationError('invalid repo id', param.error.issues);
    const auth = getAuth(c);
    const repo = await getProjectRepoById(deps.db, {
      id: param.data.id,
      tenantId: auth.tenantId,
    });
    if (repo === null) throw notFound(`repo not found: ${param.data.id}`);
    const syncs = await listSyncRuns(deps.db, { projectRepoId: repo.id });
    return c.json({ syncs: syncs.map(syncToWire) });
  });

  // ---------------------------------------------------------------------
  // DELETE /v1/integrations/git/repos/:id
  // ---------------------------------------------------------------------
  app.delete('/v1/integrations/git/repos/:id', async (c) => {
    requireRole(c, 'admin');
    const param = RepoIdParam.safeParse({ id: c.req.param('id') });
    if (!param.success) throw validationError('invalid repo id', param.error.issues);
    const auth = getAuth(c);
    const repo = await getProjectRepoById(deps.db, {
      id: param.data.id,
      tenantId: auth.tenantId,
    });
    if (repo === null) throw notFound(`repo not found: ${param.data.id}`);
    if (repo.accessTokenSecretName !== null && deps.secrets?.store !== undefined) {
      // Best-effort secret cleanup; never blocks the disconnect.
      try {
        await deps.secrets.store.delete(auth.tenantId, repo.accessTokenSecretName);
      } catch {
        // swallowed — the secret may have been removed manually.
      }
    }
    await deleteProjectRepo(deps.db, { id: repo.id, tenantId: auth.tenantId });
    await recordAudit(deps.db, c, {
      verb: 'git_repo.disconnect',
      objectKind: 'project_repo',
      objectId: repo.id,
      metadata: { provider: repo.provider, repo: `${repo.repoOwner}/${repo.repoName}` },
    });
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------------
  // POST /v1/integrations/git/repos/:id/sync — manual sync trigger.
  // ---------------------------------------------------------------------
  app.post('/v1/integrations/git/repos/:id/sync', async (c) => {
    requireRole(c, 'member');
    const param = RepoIdParam.safeParse({ id: c.req.param('id') });
    if (!param.success) throw validationError('invalid repo id', param.error.issues);
    const auth = getAuth(c);
    const repo = await getProjectRepoById(deps.db, {
      id: param.data.id,
      tenantId: auth.tenantId,
    });
    if (repo === null) throw notFound(`repo not found: ${param.data.id}`);
    const json = await safeJson(c.req.raw);
    const parsed = SyncBody.safeParse(json ?? {});
    const prune = parsed.success ? (parsed.data.prune ?? false) : false;
    return doSync(deps, repo, { prune }).then((res) => c.json(res));
  });

  // ---------------------------------------------------------------------
  // POST /v1/webhooks/git/:provider/:repoId — push webhook (signed).
  //
  // NOTE: this endpoint is unauthenticated; the signature verification
  // BELOW is the auth boundary. The path is added to the auth allow-list
  // (see `auth/middleware.ts` PUBLIC_PATH_PREFIX).
  // ---------------------------------------------------------------------
  app.post('/v1/webhooks/git/:provider/:repoId', async (c) => {
    const provider = c.req.param('provider');
    const repoId = c.req.param('repoId');
    if (provider !== 'github' && provider !== 'gitlab') {
      throw notFound(`unknown provider: ${provider}`);
    }
    const repo = await getProjectRepoById(deps.db, { id: repoId });
    if (repo === null || repo.provider !== provider) {
      // Don't leak whether the id exists in another tenant; 404 either way.
      throw notFound(`repo not found: ${repoId}`);
    }
    // Read the raw body bytes BEFORE any JSON parsing — both signature
    // schemes are computed over the raw bytes.
    const bodyText = await c.req.raw.text();
    const webhookSecret = await getWebhookSecret(deps.db, { id: repo.id });
    if (webhookSecret === null) {
      // Defensive — the row exists (we resolved it above) but the secret
      // column isn't populated. Treat as misconfigured.
      throw new HttpError(500, 'webhook_misconfigured', 'webhook secret missing for repo');
    }
    let verify: ReturnType<typeof verifyGithubSignature>;
    if (provider === 'github') {
      verify = verifyGithubSignature({
        secret: webhookSecret,
        body: bodyText,
        signatureHeader: c.req.header('x-hub-signature-256') ?? c.req.header('X-Hub-Signature-256'),
      });
    } else {
      verify = verifyGitlabSignature({
        secret: webhookSecret,
        tokenHeader: c.req.header('x-gitlab-token') ?? c.req.header('X-Gitlab-Token'),
      });
    }
    if (!verify.ok) {
      throw new HttpError(401, 'webhook_signature_invalid', verify.reason ?? 'signature invalid');
    }
    // Best-effort: filter out non-push events. GitHub sends `X-GitHub-Event`
    // (we accept `push`); GitLab sends `X-Gitlab-Event` (we accept `Push Hook`).
    const eventHeader =
      provider === 'github' ? c.req.header('x-github-event') : c.req.header('x-gitlab-event');
    const isPush =
      provider === 'github'
        ? eventHeader === 'push' || eventHeader === 'ping'
        : eventHeader === 'Push Hook';
    if (eventHeader === 'ping') {
      // Customer just configured the webhook — nothing to sync, just ack.
      return c.json({ ok: true, action: 'ping' });
    }
    if (!isPush) {
      return c.json({ ok: true, action: 'ignored', reason: `event=${eventHeader ?? 'unknown'}` });
    }
    const syncRes = await doSync(deps, repo, { prune: false });
    return c.json({ ok: true, action: 'synced', sync: syncRes });
  });

  return app;
}

interface SyncResponseEnvelope {
  readonly status: 'ok' | 'failed';
  readonly added: readonly string[];
  readonly updated: readonly string[];
  readonly removed: readonly string[];
  readonly failures: readonly { readonly path: string; readonly error: string }[];
  readonly error: string | null;
  readonly syncedAt: string;
}

async function doSync(
  deps: Deps,
  repo: ProjectRepo,
  opts: { readonly prune: boolean },
): Promise<SyncResponseEnvelope> {
  const startedAt = new Date().toISOString();
  const store = deps.secrets?.store;
  if (store === undefined) {
    const finishedAt = new Date().toISOString();
    await recordSyncRun(deps.db, {
      projectRepoId: repo.id,
      startedAt,
      finishedAt,
      status: 'failed',
      agentsAdded: 0,
      agentsUpdated: 0,
      agentsRemoved: 0,
      error: 'secrets store not configured',
    });
    await updateLastSync(deps.db, {
      id: repo.id,
      status: 'failed',
      error: 'secrets store not configured',
      syncedAt: finishedAt,
    });
    return {
      status: 'failed',
      added: [],
      updated: [],
      removed: [],
      failures: [],
      error: 'secrets store not configured',
      syncedAt: finishedAt,
    };
  }

  const result = await runSync({
    repo,
    db: deps.db,
    secrets: store,
    agentStore: deps.agentStore,
    prune: opts.prune,
  });
  const finishedAt = new Date().toISOString();
  const removedApplied = opts.prune ? result.diff.removed.length : 0;
  await recordSyncRun(deps.db, {
    projectRepoId: repo.id,
    startedAt,
    finishedAt,
    status: result.status,
    agentsAdded: result.diff.added.length,
    agentsUpdated: result.diff.updated.length,
    agentsRemoved: removedApplied,
    error: result.error ?? null,
  });
  await updateLastSync(deps.db, {
    id: repo.id,
    status: result.status,
    error: result.error ?? null,
    syncedAt: finishedAt,
  });
  return {
    status: result.status,
    added: result.diff.added,
    updated: result.diff.updated,
    removed: result.diff.removed,
    failures: result.diff.failures,
    error: result.error ?? null,
    syncedAt: finishedAt,
  };
}

/**
 * Strip secrets before returning over the wire. The webhook secret + the
 * access-token secret name are NEVER round-tripped on read.
 */
function toWire(r: ProjectRepo): Omit<ProjectRepo, 'accessTokenSecretName'> & {
  readonly hasAccessToken: boolean;
} {
  const { accessTokenSecretName, ...rest } = r;
  return { ...rest, hasAccessToken: accessTokenSecretName !== null };
}

function syncToWire(s: ProjectRepoSync) {
  return s;
}

function webhookUrlFor(provider: GitProvider, repoId: string): string {
  // We render a relative path here; the customer's tenant edge URL is
  // tenant-specific, so the API + web UI compose the absolute URL with
  // the tenant's domain (or the platform default ai.aldo.tech).
  return `/v1/webhooks/git/${provider}/${repoId}`;
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return (await req.json()) as unknown;
  } catch {
    return undefined;
  }
}

void (undefined as unknown as ProjectRepoSync);
