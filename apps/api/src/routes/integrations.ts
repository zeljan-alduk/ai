/**
 * `/v1/integrations` — Wave-14C outbound integrations CRUD + test fire.
 *
 * Tenant-scoped surface. RBAC ladder:
 *   - viewer: list (with secrets redacted)
 *   - member: list (with secrets redacted)
 *   - admin/owner: full CRUD + test fire
 *
 * Endpoints:
 *   GET    /v1/integrations             list
 *   POST   /v1/integrations             create (admin)
 *   GET    /v1/integrations/:id         read
 *   PATCH  /v1/integrations/:id         update (admin)
 *   DELETE /v1/integrations/:id         delete (admin)
 *   POST   /v1/integrations/:id/test    synthetic fire against the runner (admin)
 *
 * Sensitive fields:
 *   - GitHub: `token` is encrypted at rest via @aldo-ai/secrets'
 *     master key, stored as `__enc_token` (ciphertext+nonce, base64).
 *     Reads decrypt before returning to admins; non-admins never see
 *     the field at all.
 *   - Webhook: `signingSecret` is encrypted the same way.
 *   - Slack/Discord: webhook URLs contain a path-based secret; we
 *     redact the path on read for non-admins.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import {
  CreateIntegrationRequest,
  type IntegrationContract,
  IntegrationResponse,
  ListIntegrationsResponse,
  TestFireResponse,
  UpdateIntegrationRequest,
} from '@aldo-ai/api-contract';
import {
  type IntegrationKind,
  type Integration as IntegrationRow,
  PostgresIntegrationStore,
  getRunner,
} from '@aldo-ai/integrations';
import { decrypt, encrypt, loadMasterKeyFromEnv } from '@aldo-ai/secrets';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth, requireRole, roleAllows } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';

const IdParam = z.object({ id: z.string().min(1) });

/**
 * Per-kind list of fields that must be encrypted at rest when present
 * in the config blob. The route swaps the cleartext into `__enc_<field>`
 * (a base64 envelope) before insert/update so the DB row never holds
 * the plaintext. On read the envelope is decoded back.
 */
const ENCRYPTED_FIELDS: Record<IntegrationKind, readonly string[]> = {
  slack: [],
  github: ['token'],
  webhook: ['signingSecret'],
  discord: [],
  // MISSING_PIECES §14-B
  telegram: ['botToken'],
  email: ['apiKey'],
};

export function integrationsRoutes(deps: Deps): Hono {
  const app = new Hono();
  const store = new PostgresIntegrationStore({ client: deps.db });
  // Master key is reused from the wave-7 secrets path. Boot fails if
  // production lacks the env var; dev gets an ephemeral one with a
  // warning (mirrors the SecretStore wiring in deps.ts).
  const masterKey = loadMasterKeyFromEnv({
    env: deps.env,
    allowDevFallback: deps.env.NODE_ENV !== 'production',
  });

  // ---------- list ----------------------------------------------------------
  app.get('/v1/integrations', async (c) => {
    const auth = getAuth(c);
    const rows = await store.list(auth.tenantId);
    const showSecrets = roleAllows(auth.role, 'admin');
    const body = ListIntegrationsResponse.parse({
      integrations: rows.map((r) => toWire(r, masterKey, showSecrets)),
    });
    return c.json(body);
  });

  // ---------- read ----------------------------------------------------------
  app.get('/v1/integrations/:id', async (c) => {
    const idParsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid integration id', idParsed.error.issues);
    const auth = getAuth(c);
    const row = await store.get(auth.tenantId, idParsed.data.id);
    if (row === null) throw notFound(`integration not found: ${idParsed.data.id}`);
    const showSecrets = roleAllows(auth.role, 'admin');
    return c.json(IntegrationResponse.parse({ integration: toWire(row, masterKey, showSecrets) }));
  });

  // ---------- create --------------------------------------------------------
  app.post('/v1/integrations', async (c) => {
    requireRole(c, 'admin');
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateIntegrationRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid integrations.create body', parsed.error.issues);
    }
    // Per-kind shape validation via the runner registry. The runner
    // throws with a human-readable message when the blob is malformed.
    try {
      getRunner(parsed.data.kind).validateConfig(parsed.data.config);
    } catch (err) {
      throw validationError(
        err instanceof Error ? err.message : 'config rejected by runner',
        undefined,
      );
    }
    const auth = getAuth(c);
    const sealed = sealConfig(parsed.data.kind, parsed.data.config, masterKey);
    const row = await store.create({
      tenantId: auth.tenantId,
      kind: parsed.data.kind,
      name: parsed.data.name,
      config: sealed,
      events: [...parsed.data.events],
      enabled: parsed.data.enabled,
    });
    return c.json(IntegrationResponse.parse({ integration: toWire(row, masterKey, true) }), 201);
  });

  // ---------- update --------------------------------------------------------
  app.patch('/v1/integrations/:id', async (c) => {
    requireRole(c, 'admin');
    const idParsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid integration id', idParsed.error.issues);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = UpdateIntegrationRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid integrations.update body', parsed.error.issues);
    }
    const auth = getAuth(c);
    const existing = await store.get(auth.tenantId, idParsed.data.id);
    if (existing === null) throw notFound(`integration not found: ${idParsed.data.id}`);
    // If the caller supplied a new config, validate against the
    // existing kind (kind itself is immutable post-create — to switch
    // kinds, delete + recreate so secrets aren't moved across runners).
    let sealedConfig: Record<string, unknown> | undefined;
    if (parsed.data.config !== undefined) {
      try {
        getRunner(existing.kind).validateConfig(parsed.data.config);
      } catch (err) {
        throw validationError(
          err instanceof Error ? err.message : 'config rejected by runner',
          undefined,
        );
      }
      sealedConfig = sealConfig(existing.kind, parsed.data.config, masterKey);
    }
    const updated = await store.update(auth.tenantId, idParsed.data.id, {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(sealedConfig !== undefined ? { config: sealedConfig } : {}),
      ...(parsed.data.events !== undefined ? { events: [...parsed.data.events] } : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
    });
    if (updated === null) throw notFound(`integration not found: ${idParsed.data.id}`);
    return c.json(IntegrationResponse.parse({ integration: toWire(updated, masterKey, true) }));
  });

  // ---------- delete --------------------------------------------------------
  app.delete('/v1/integrations/:id', async (c) => {
    requireRole(c, 'admin');
    const idParsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid integration id', idParsed.error.issues);
    const auth = getAuth(c);
    const removed = await store.delete(auth.tenantId, idParsed.data.id);
    if (!removed) throw notFound(`integration not found: ${idParsed.data.id}`);
    return new Response(null, { status: 204 });
  });

  // ---------- test fire ----------------------------------------------------
  app.post('/v1/integrations/:id/test', async (c) => {
    requireRole(c, 'admin');
    const idParsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid integration id', idParsed.error.issues);
    const auth = getAuth(c);
    const row = await store.get(auth.tenantId, idParsed.data.id);
    if (row === null) throw notFound(`integration not found: ${idParsed.data.id}`);
    const decrypted = unsealConfig(row.kind, row.config, masterKey);
    const runner = getRunner(row.kind);
    const result = await runner.dispatch(
      {
        event: 'run_completed',
        tenantId: auth.tenantId,
        title: 'ALDO AI test event',
        body: 'This is a synthetic test fire from the integrations settings page.',
        link: null,
        metadata: { synthetic: true },
        occurredAt: new Date().toISOString(),
      },
      decrypted,
    );
    if (result.ok) {
      // Stamp last_fired_at so the UI shows the test as a successful
      // delivery. Best-effort.
      void store.markFired(auth.tenantId, row.id, new Date().toISOString());
    }
    return c.json(
      TestFireResponse.parse({
        ok: result.ok,
        ...(result.statusCode !== undefined ? { statusCode: result.statusCode } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
        ...(result.timedOut === true ? { timedOut: true } : {}),
      }),
    );
  });

  return app;
}

// ---------------------------------------------------------------------------
// Encryption envelope — wraps sensitive fields as base64 ciphertext+nonce.
// ---------------------------------------------------------------------------

interface SealedField {
  readonly __enc: true;
  readonly ciphertext: string;
  readonly nonce: string;
}

function isSealed(v: unknown): v is SealedField {
  if (v === null || typeof v !== 'object') return false;
  const o = v as { __enc?: unknown; ciphertext?: unknown; nonce?: unknown };
  return o.__enc === true && typeof o.ciphertext === 'string' && typeof o.nonce === 'string';
}

function sealConfig(
  kind: IntegrationKind,
  cfg: Record<string, unknown>,
  key: Uint8Array,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cfg };
  for (const field of ENCRYPTED_FIELDS[kind]) {
    const v = out[field];
    if (typeof v === 'string' && v.length > 0) {
      const enc = encrypt(v, key);
      out[field] = {
        __enc: true,
        ciphertext: Buffer.from(enc.ciphertext).toString('base64'),
        nonce: Buffer.from(enc.nonce).toString('base64'),
      } satisfies SealedField;
    }
  }
  return out;
}

function unsealConfig(
  kind: IntegrationKind,
  cfg: Record<string, unknown>,
  key: Uint8Array,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cfg };
  for (const field of ENCRYPTED_FIELDS[kind]) {
    const v = out[field];
    if (isSealed(v)) {
      try {
        out[field] = decrypt(
          {
            ciphertext: new Uint8Array(Buffer.from(v.ciphertext, 'base64')),
            nonce: new Uint8Array(Buffer.from(v.nonce, 'base64')),
          },
          key,
        );
      } catch {
        // Surface a placeholder so the runner's validateConfig fails
        // cleanly rather than the dispatcher crashing.
        out[field] = '';
      }
    }
  }
  return out;
}

/**
 * Wire envelope for the API response. Decrypts (when allowed) and
 * redacts secret-bearing fields when the caller is below admin.
 */
function toWire(
  row: IntegrationRow,
  key: Uint8Array,
  showSecrets: boolean,
): z.infer<typeof IntegrationContract> {
  const config = showSecrets ? unsealConfig(row.kind, row.config, key) : redactConfig(row);
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    config,
    events: [...row.events],
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastFiredAt: row.lastFiredAt,
  };
}

/**
 * Strip everything sensitive from the config before handing it to a
 * non-admin. Slack/Discord webhook URLs are reduced to host+path
 * placeholder; GitHub tokens are dropped; webhook signing secrets
 * are dropped.
 */
function redactConfig(row: IntegrationRow): Record<string, unknown> {
  const cfg = row.config;
  switch (row.kind) {
    case 'slack':
    case 'discord': {
      const url = typeof cfg.webhookUrl === 'string' ? cfg.webhookUrl : '';
      let safe = '';
      try {
        const u = new URL(url);
        safe = `${u.origin}/…`;
      } catch {
        safe = '…';
      }
      return { webhookUrl: safe, ...(cfg.channel !== undefined ? { channel: cfg.channel } : {}) };
    }
    case 'github':
      return {
        repo: cfg.repo ?? '',
        issueNumber: cfg.issueNumber ?? null,
        // Token redacted entirely.
      };
    case 'webhook': {
      const url = typeof cfg.url === 'string' ? cfg.url : '';
      let safe = '';
      try {
        const u = new URL(url);
        safe = `${u.origin}/…`;
      } catch {
        safe = '…';
      }
      return { url: safe };
    }
    // MISSING_PIECES §14-B
    case 'telegram':
      return {
        // Bot token redacted entirely; chatId is non-secret (it's a
        // public-ish identifier within the bot's reach).
        chatId: cfg.chatId ?? null,
      };
    case 'email':
      return {
        provider: cfg.provider ?? 'resend',
        from: cfg.from ?? '',
        to: cfg.to ?? '',
        // apiKey redacted entirely.
      };
  }
}
