/**
 * `/v1/alerts` — Wave-14 alert rule CRUD + silence + test + tick.
 *
 * Tenant-scoped. The 60s background tick runs in `index.ts` and calls
 * `runAlertsTick(deps)` once per tick; this module exports it so a
 * test can invoke a single pass deterministically.
 *
 * Endpoints:
 *   GET    /v1/alerts                 list
 *   POST   /v1/alerts                 create
 *   GET    /v1/alerts/:id             read
 *   PATCH  /v1/alerts/:id             update
 *   DELETE /v1/alerts/:id             delete
 *   POST   /v1/alerts/:id/silence?until=ISO   silence until
 *   POST   /v1/alerts/:id/test        dry-run evaluation
 *   GET    /v1/alerts/:id/events      list recent firings
 *
 * The slack webhook channel is validated to be `https://hooks.slack.com/...`
 * at WRITE time so a misconfigured rule never POSTs anywhere else.
 */

import {
  AlertEvent,
  AlertRule,
  CreateAlertRuleRequest,
  ListAlertEventsResponse,
  ListAlertRulesResponse,
  SilenceAlertResponse,
  TestAlertResponse,
  UpdateAlertRuleRequest,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import { evaluateRule, shouldSkipForTick } from '../dashboards/alert-eval.js';
import {
  type AlertRuleRow,
  deleteAlertRule,
  getAlertRule,
  insertAlertRule,
  listAlertEventsForRule,
  listAlertRules,
  recordAlertEvent,
  silenceAlertRule,
  updateAlertRule,
} from '../dashboards/alerts-store.js';
import { dispatchAlertNotifications, isSlackWebhookUrl } from '../dashboards/notify-channels.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';

const AlertIdParam = z.object({ id: z.string().min(1) });

export function alertsRoutes(deps: Deps): Hono {
  const app = new Hono();

  // ---------- list ----------------------------------------------------------
  app.get('/v1/alerts', async (c) => {
    const auth = getAuth(c);
    const rules = await listAlertRules(deps.db, { tenantId: auth.tenantId });
    return c.json(
      ListAlertRulesResponse.parse({ rules: rules.map((r) => toWire(r, auth.userId)) }),
    );
  });

  // ---------- create --------------------------------------------------------
  app.post('/v1/alerts', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateAlertRuleRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid alerts.create body', parsed.error.issues);
    }
    validateChannels(parsed.data.notificationChannels);
    const auth = getAuth(c);
    const row = await insertAlertRule(deps.db, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      threshold: parsed.data.threshold,
      targets: parsed.data.targets ?? {},
      notificationChannels: [...parsed.data.notificationChannels],
      enabled: parsed.data.enabled ?? true,
    });
    return c.json(AlertRule.parse(toWire(row, auth.userId)), 201);
  });

  // ---------- read ----------------------------------------------------------
  app.get('/v1/alerts/:id', async (c) => {
    const idParsed = AlertIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid alert id', idParsed.error.issues);
    const auth = getAuth(c);
    const row = await getAlertRule(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (row === null) throw notFound(`alert not found: ${idParsed.data.id}`);
    return c.json(AlertRule.parse(toWire(row, auth.userId)));
  });

  // ---------- update --------------------------------------------------------
  app.patch('/v1/alerts/:id', async (c) => {
    const idParsed = AlertIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid alert id', idParsed.error.issues);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = UpdateAlertRuleRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid alerts.update body', parsed.error.issues);
    }
    if (parsed.data.notificationChannels !== undefined) {
      validateChannels(parsed.data.notificationChannels);
    }
    const auth = getAuth(c);
    const updated = await updateAlertRule(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
      patch: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.threshold !== undefined ? { threshold: parsed.data.threshold } : {}),
        ...(parsed.data.targets !== undefined ? { targets: parsed.data.targets } : {}),
        ...(parsed.data.notificationChannels !== undefined
          ? { notificationChannels: [...parsed.data.notificationChannels] }
          : {}),
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      },
    });
    if (updated === null) throw notFound(`alert not found: ${idParsed.data.id}`);
    return c.json(AlertRule.parse(toWire(updated, auth.userId)));
  });

  // ---------- delete --------------------------------------------------------
  app.delete('/v1/alerts/:id', async (c) => {
    const idParsed = AlertIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid alert id', idParsed.error.issues);
    const auth = getAuth(c);
    const removed = await deleteAlertRule(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
    });
    if (!removed) throw notFound(`alert not found: ${idParsed.data.id}`);
    return new Response(null, { status: 204 });
  });

  // ---------- silence -------------------------------------------------------
  app.post('/v1/alerts/:id/silence', async (c) => {
    const idParsed = AlertIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid alert id', idParsed.error.issues);
    const auth = getAuth(c);
    const untilParam = c.req.query('until');
    let until: string | null;
    if (untilParam === 'forever' || untilParam === undefined) {
      // 100 years out — practical "forever".
      until = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();
    } else {
      const parsed = new Date(untilParam);
      if (Number.isNaN(parsed.getTime())) {
        throw validationError('invalid until param: must be ISO timestamp or "forever"');
      }
      until = parsed.toISOString();
    }
    const updated = await silenceAlertRule(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
      until,
    });
    if (updated === null) throw notFound(`alert not found: ${idParsed.data.id}`);
    return c.json(SilenceAlertResponse.parse({ silencedUntil: until }));
  });

  // ---------- test ----------------------------------------------------------
  app.post('/v1/alerts/:id/test', async (c) => {
    const idParsed = AlertIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid alert id', idParsed.error.issues);
    const auth = getAuth(c);
    const row = await getAlertRule(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (row === null) throw notFound(`alert not found: ${idParsed.data.id}`);
    const result = await evaluateRule(deps.db, row);
    return c.json(
      TestAlertResponse.parse({
        wouldTrigger: result.crossed,
        value: result.value,
        threshold: result.threshold,
        ...(result.note !== undefined ? { note: result.note } : {}),
      }),
    );
  });

  // ---------- events --------------------------------------------------------
  app.get('/v1/alerts/:id/events', async (c) => {
    const idParsed = AlertIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid alert id', idParsed.error.issues);
    const auth = getAuth(c);
    // Tenant check via the rule lookup; events table doesn't carry a
    // tenant column directly (FK to alert_rules).
    const row = await getAlertRule(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (row === null) throw notFound(`alert not found: ${idParsed.data.id}`);
    const events = await listAlertEventsForRule(deps.db, {
      alertRuleId: row.id,
      limit: 50,
    });
    const body = ListAlertEventsResponse.parse({
      events: events.map((e) => AlertEvent.parse(e)),
    });
    return c.json(body);
  });

  return app;
}

/**
 * Validate `notification_channels` against the `'app' | 'email' |
 * 'slack:<https-url>'` shape. Pasting a non-Slack url should never
 * make it past write.
 */
function validateChannels(channels: ReadonlyArray<string>): void {
  for (const ch of channels) {
    if (ch === 'app' || ch === 'email') continue;
    if (ch.startsWith('slack:')) {
      const url = ch.slice('slack:'.length);
      if (!isSlackWebhookUrl(url)) {
        throw validationError('invalid slack webhook url: must be https://hooks.slack.com/...');
      }
      continue;
    }
    throw validationError(`unknown notification channel: ${ch}`);
  }
}

function toWire(row: AlertRuleRow, callerUserId: string): z.infer<typeof AlertRule> {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    threshold: row.threshold,
    targets: row.targets,
    notificationChannels: row.notificationChannels,
    enabled: row.enabled,
    lastTriggeredAt: row.lastTriggeredAt,
    lastSilencedAt: row.lastSilencedAt,
    createdAt: row.createdAt,
    ownedByMe: row.userId === callerUserId,
  };
}

// ---------------------------------------------------------------------------
// Background tick — runs every 60s in production via setInterval.
// ---------------------------------------------------------------------------

export interface RunAlertsTickArgs {
  readonly deps: Deps;
  /** Test seam — defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
}

/**
 * Evaluate every enabled rule across every tenant. Multi-instance safe:
 * each rule write is gated by a Postgres advisory lock keyed on the
 * rule id so only one API instance fires per rule per tick.
 *
 * Returns the set of rule ids that crossed threshold this tick (mostly
 * for test assertions).
 */
export async function runAlertsTick(args: RunAlertsTickArgs): Promise<readonly string[]> {
  const fired: string[] = [];
  // Pull every tenant's enabled rules in one query — index-friendly
  // (`idx_alert_rules_enabled` is partial on enabled = true).
  const res = await args.deps.db.query<{
    id: string;
    tenant_id: string;
    user_id: string;
    name: string;
    kind: string;
    threshold: unknown;
    targets: unknown;
    notification_channels: string[] | null;
    enabled: boolean;
    last_triggered_at: string | Date | null;
    last_silenced_at: string | Date | null;
    created_at: string | Date;
  }>(
    `SELECT id, tenant_id, user_id, name, kind, threshold, targets,
            notification_channels, enabled, last_triggered_at,
            last_silenced_at, created_at
       FROM alert_rules
      WHERE enabled = true`,
  );
  for (const r of res.rows) {
    const rule: AlertRuleRow = {
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      name: r.name,
      kind: r.kind as AlertRuleRow['kind'],
      threshold: parseObj(r.threshold) as AlertRuleRow['threshold'],
      targets: parseObj(r.targets) as AlertRuleRow['targets'],
      notificationChannels: Array.isArray(r.notification_channels) ? r.notification_channels : [],
      enabled: r.enabled,
      lastTriggeredAt:
        r.last_triggered_at === null ? null : new Date(r.last_triggered_at).toISOString(),
      lastSilencedAt:
        r.last_silenced_at === null ? null : new Date(r.last_silenced_at).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
    };
    if (shouldSkipForTick(rule)) continue;

    // Postgres advisory lock — keyed on a stable hash of the rule id so
    // only one instance fires per rule per tick. `pg_try_advisory_lock`
    // returns false immediately if another instance already holds it.
    // We release after the rule's evaluation is done.
    const lockKey = hashLockKey(rule.id);
    let acquired = true;
    try {
      const lockRes = await args.deps.db.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [lockKey],
      );
      acquired = lockRes.rows[0]?.acquired ?? false;
    } catch {
      // pglite supports `pg_try_advisory_lock`-as-a-noop in some versions;
      // when the call fails entirely we fall back to optimistic eval.
      acquired = true;
    }
    if (!acquired) continue;

    try {
      const evald = await evaluateRule(args.deps.db, rule);
      if (!evald.crossed) continue;
      const delivered = await dispatchAlertNotifications({
        db: args.deps.db,
        mailer: args.deps.mailer,
        tenantId: rule.tenantId,
        userId: rule.userId,
        rule: {
          id: rule.id,
          name: rule.name,
          kind: rule.kind,
          threshold: rule.threshold,
          targets: rule.targets,
          notificationChannels: rule.notificationChannels,
        },
        value: evald.value,
        dimensions: evald.dimensions,
        ...(args.fetch !== undefined ? { fetch: args.fetch } : {}),
      });
      await recordAlertEvent(args.deps.db, {
        alertRuleId: rule.id,
        value: evald.value,
        dimensions: evald.dimensions,
        notifiedChannels: delivered,
      });
      fired.push(rule.id);
    } catch (err) {
      console.error('[alerts] eval failed', rule.id, err);
    } finally {
      try {
        await args.deps.db.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      } catch {
        // ignore unlock errors — see above.
      }
    }
  }
  return fired;
}

function parseObj(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v) as unknown;
      if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
        return p as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

/**
 * Project a rule id (UUID-like string) into a 32-bit signed int that
 * `pg_try_advisory_lock(int)` accepts. djb2 with a final modulo —
 * collisions are tolerable (the wrong rule pair just contends an
 * extra lock that releases at the end of one tick).
 */
export function hashLockKey(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i += 1) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  // Map into a positive 31-bit so it round-trips through pg's int4.
  return Math.abs(h) % 0x7fffffff;
}
