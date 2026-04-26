/**
 * `/v1/api-keys` — wave-13 programmatic credentials surface.
 *
 *   GET    /v1/api-keys             list (no secrets)
 *   POST   /v1/api-keys             create — full secret returned ONCE
 *   POST   /v1/api-keys/:id/revoke  soft-revoke (sets revoked_at)
 *   DELETE /v1/api-keys/:id         hard-delete
 *
 * Owner-or-admin only — viewers + members see 403 `forbidden`. Every
 * mutation appends a row to `audit_log`. The plain key is shown ONCE
 * on creation; subsequent reads return only the prefix + scopes +
 * timestamps.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import {
  type ApiKey as ApiKeyWire,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  ListApiKeysResponse,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  type ApiKeyRecord,
  KNOWN_SCOPES,
  createApiKey,
  deleteApiKey,
  findApiKeyById,
  listApiKeys,
  revokeApiKey,
} from '../auth/api-keys.js';
import { recordAudit } from '../auth/audit.js';
import { getAuth, requireRole } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';

const IdParam = z.object({ id: z.string().min(1) });

function toWire(k: ApiKeyRecord): ApiKeyWire {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: [...k.scopes],
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
  };
}

export function apiKeysRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/api-keys', async (c) => {
    requireRole(c, 'admin');
    const tenantId = getAuth(c).tenantId;
    const rows = await listApiKeys(deps.db, tenantId);
    const body = ListApiKeysResponse.parse({ keys: rows.map(toWire) });
    return c.json(body);
  });

  app.post('/v1/api-keys', async (c) => {
    requireRole(c, 'admin');
    const auth = getAuth(c);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateApiKeyRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid api-key payload', parsed.error.issues);
    }
    // Reject scopes the API doesn't know about so a typo doesn't
    // silently grant nothing — the UI uses the same source list.
    const unknownScopes = parsed.data.scopes.filter(
      (s) => !KNOWN_SCOPES.includes(s as (typeof KNOWN_SCOPES)[number]),
    );
    if (unknownScopes.length > 0) {
      throw validationError(`unknown scopes: ${unknownScopes.join(', ')}`, {
        knownScopes: [...KNOWN_SCOPES],
      });
    }
    const created = await createApiKey(deps.db, {
      tenantId: auth.tenantId,
      createdBy: auth.userId,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      ...(parsed.data.expiresInDays !== undefined
        ? { expiresInDays: parsed.data.expiresInDays }
        : {}),
    });
    await recordAudit(deps.db, c, {
      verb: 'api_key.create',
      objectKind: 'api_key',
      objectId: created.record.id,
      metadata: {
        name: created.record.name,
        scopes: [...created.record.scopes],
        expiresAt: created.record.expiresAt,
      },
    });
    const body = CreateApiKeyResponse.parse({
      key: created.key,
      apiKey: toWire(created.record),
    });
    return c.json(body, 201);
  });

  app.post('/v1/api-keys/:id/revoke', async (c) => {
    requireRole(c, 'admin');
    const parsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!parsed.success) {
      throw validationError('invalid api-key id', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const existing = await findApiKeyById(deps.db, tenantId, parsed.data.id);
    if (existing === null) {
      throw notFound(`api-key not found: ${parsed.data.id}`);
    }
    const ok = await revokeApiKey(deps.db, tenantId, parsed.data.id);
    if (!ok) {
      // Already revoked — still 200 so the UI is idempotent on
      // accidental double-clicks.
      const refreshed = await findApiKeyById(deps.db, tenantId, parsed.data.id);
      return c.json({ apiKey: toWire(refreshed ?? existing) });
    }
    const refreshed = await findApiKeyById(deps.db, tenantId, parsed.data.id);
    await recordAudit(deps.db, c, {
      verb: 'api_key.revoke',
      objectKind: 'api_key',
      objectId: parsed.data.id,
      metadata: { name: existing.name },
    });
    return c.json({ apiKey: toWire(refreshed ?? existing) });
  });

  app.delete('/v1/api-keys/:id', async (c) => {
    requireRole(c, 'admin');
    const parsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!parsed.success) {
      throw validationError('invalid api-key id', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;
    const existing = await findApiKeyById(deps.db, tenantId, parsed.data.id);
    if (existing === null) {
      throw notFound(`api-key not found: ${parsed.data.id}`);
    }
    await deleteApiKey(deps.db, tenantId, parsed.data.id);
    await recordAudit(deps.db, c, {
      verb: 'api_key.delete',
      objectKind: 'api_key',
      objectId: parsed.data.id,
      metadata: { name: existing.name },
    });
    return c.body(null, 204);
  });

  return app;
}
