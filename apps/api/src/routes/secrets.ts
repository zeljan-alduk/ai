/**
 * `/v1/secrets` — tenant-scoped secrets CRUD.
 *
 *   GET    /v1/secrets          → ListSecretsResponse  (no values)
 *   POST   /v1/secrets          → SetSecretResponse    (one summary)
 *   DELETE /v1/secrets/:name    → 204
 *
 * Auth is intentionally absent in v0; tenant scoping lands with the
 * orchestrator wave. Until then every request is treated as the same
 * `tenant-default` tenant — same convention every other v0 route
 * follows.
 *
 * The raw secret value flows in only through the `POST` body and never
 * back. List + Set responses carry the redacted summary
 * (`SecretSummary`) from `@aldo-ai/api-contract`. The `referencedBy`
 * field is populated by a future spec-scan (engineer-B's parser) and
 * is wire-stable as `[]` for now.
 *
 * LLM-agnostic: secrets are opaque blobs; provider names never appear
 * in this file or in the responses we shape.
 */

import {
  ListSecretsResponse,
  type SecretSummary,
  SetSecretRequest,
  SetSecretResponse,
} from '@aldo-ai/api-contract';
import type { SecretStore } from '@aldo-ai/secrets';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';

const SecretNameParam = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/, {
    message: 'secret names are SCREAMING_SNAKE_CASE',
  }),
});

/** v0 single-tenant constant. Flips to a real tenant-id once auth lands. */
const DEFAULT_TENANT = 'tenant-default';

export function secretsRoutes(deps: Deps): Hono {
  const app = new Hono();
  const tenantId = deps.tenantId ?? DEFAULT_TENANT;

  app.get('/v1/secrets', async (c) => {
    const store = requireStore(deps);
    const summaries = await store.list(tenantId);
    const body = ListSecretsResponse.parse({
      secrets: summaries.map(toWireSummary),
    });
    return c.json(body);
  });

  app.post('/v1/secrets', async (c) => {
    const store = requireStore(deps);
    const raw = await safeJson(c.req.raw);
    const parsed = SetSecretRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid secret payload', parsed.error.issues);
    }
    const summary = await store.set(tenantId, parsed.data.name, parsed.data.value);
    const body = SetSecretResponse.parse(toWireSummary(summary));
    return c.json(body);
  });

  app.delete('/v1/secrets/:name', async (c) => {
    const store = requireStore(deps);
    const parsed = SecretNameParam.safeParse({ name: c.req.param('name') });
    if (!parsed.success) {
      throw validationError('invalid secret name', parsed.error.issues);
    }
    const removed = await store.delete(tenantId, parsed.data.name);
    if (!removed) {
      throw notFound(`secret not found: ${parsed.data.name}`);
    }
    return c.body(null, 204);
  });

  return app;
}

/**
 * Throws a 503 if the host hasn't wired a SecretStore. We never want to
 * 200 on a list/set that was silently dropped.
 */
function requireStore(deps: Deps): SecretStore {
  const store = deps.secrets?.store;
  if (!store) {
    throw new Error('secrets store is not configured');
  }
  return store;
}

/** Cast through the shared zod schema so any drift fails loudly. */
function toWireSummary(s: SecretSummary): SecretSummary {
  return {
    name: s.name,
    fingerprint: s.fingerprint,
    preview: s.preview,
    referencedBy: [...s.referencedBy],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/**
 * Read JSON body without exploding on empty / malformed input — the
 * Zod parser gives a much better error than Hono's default `c.req.json()`
 * exception, so we degrade to `{}` and let validation fail.
 */
async function safeJson(req: Request): Promise<unknown> {
  try {
    return (await req.json()) as unknown;
  } catch {
    return {};
  }
}
