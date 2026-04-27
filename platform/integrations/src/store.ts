/**
 * Integration store — DB access + a tenant-scoped CRUD surface.
 *
 * The API uses `PostgresIntegrationStore` against the shared SqlClient
 * from `@aldo-ai/storage`. Tests use `InMemoryIntegrationStore` to
 * exercise the dispatcher without a Postgres round trip.
 *
 * Every method takes `tenantId` and the store NEVER reads / writes
 * across tenants — caller-provided tenant id is the WHERE clause on
 * every query.
 */

import { randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';
import type { Integration, IntegrationEvent, IntegrationKind } from './types.js';

export interface CreateIntegrationArgs {
  readonly tenantId: string;
  readonly kind: IntegrationKind;
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly events: readonly IntegrationEvent[];
  readonly enabled?: boolean;
}

export interface UpdateIntegrationArgs {
  readonly name?: string;
  readonly config?: Record<string, unknown>;
  readonly events?: readonly IntegrationEvent[];
  readonly enabled?: boolean;
}

export interface IntegrationStore {
  list(tenantId: string): Promise<readonly Integration[]>;
  /** Pull only the rows enabled AND subscribed to `event` — the dispatcher hot path. */
  listEnabledForEvent(tenantId: string, event: IntegrationEvent): Promise<readonly Integration[]>;
  get(tenantId: string, id: string): Promise<Integration | null>;
  create(args: CreateIntegrationArgs): Promise<Integration>;
  update(tenantId: string, id: string, args: UpdateIntegrationArgs): Promise<Integration | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  /**
   * Stamp the integration as having fired (used by the dispatcher on
   * a successful dispatch). Best-effort — failure to update doesn't
   * propagate.
   */
  markFired(tenantId: string, id: string, at: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// PostgresIntegrationStore
// ---------------------------------------------------------------------------

interface IntegrationRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly kind: string;
  readonly name: string;
  readonly config: unknown;
  readonly events: unknown;
  readonly enabled: boolean;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly last_fired_at: string | Date | null;
  readonly [k: string]: unknown;
}

function rowToIntegration(row: IntegrationRow): Integration {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind as IntegrationKind,
    name: row.name,
    config: parseJsonbObject(row.config),
    events: parseEventsArray(row.events),
    enabled: row.enabled,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    lastFiredAt: row.last_fired_at === null ? null : toIso(row.last_fired_at),
  };
}

export class PostgresIntegrationStore implements IntegrationStore {
  private readonly db: SqlClient;
  constructor(opts: { readonly client: SqlClient }) {
    this.db = opts.client;
  }

  async list(tenantId: string): Promise<readonly Integration[]> {
    const res = await this.db.query<IntegrationRow>(
      `SELECT id, tenant_id, kind, name, config, events, enabled,
              created_at, updated_at, last_fired_at
         FROM integrations
        WHERE tenant_id = $1
        ORDER BY created_at ASC, id ASC`,
      [tenantId],
    );
    return res.rows.map(rowToIntegration);
  }

  async listEnabledForEvent(
    tenantId: string,
    event: IntegrationEvent,
  ): Promise<readonly Integration[]> {
    // PostgreSQL's `ANY` over a TEXT[] handles the membership test
    // without forcing the dispatcher to fan out a SELECT per event.
    const res = await this.db.query<IntegrationRow>(
      `SELECT id, tenant_id, kind, name, config, events, enabled,
              created_at, updated_at, last_fired_at
         FROM integrations
        WHERE tenant_id = $1
          AND enabled = TRUE
          AND $2 = ANY(events)
        ORDER BY created_at ASC, id ASC`,
      [tenantId, event],
    );
    return res.rows.map(rowToIntegration);
  }

  async get(tenantId: string, id: string): Promise<Integration | null> {
    const res = await this.db.query<IntegrationRow>(
      `SELECT id, tenant_id, kind, name, config, events, enabled,
              created_at, updated_at, last_fired_at
         FROM integrations
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = res.rows[0];
    return row !== undefined ? rowToIntegration(row) : null;
  }

  async create(args: CreateIntegrationArgs): Promise<Integration> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const enabled = args.enabled ?? true;
    await this.db.query(
      `INSERT INTO integrations
         (id, tenant_id, kind, name, config, events, enabled,
          created_at, updated_at, last_fired_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, NULL)`,
      [
        id,
        args.tenantId,
        args.kind,
        args.name,
        JSON.stringify(args.config),
        args.events as unknown as string[],
        enabled,
        now,
        now,
      ],
    );
    return {
      id,
      tenantId: args.tenantId,
      kind: args.kind,
      name: args.name,
      config: args.config,
      events: [...args.events],
      enabled,
      createdAt: now,
      updatedAt: now,
      lastFiredAt: null,
    };
  }

  async update(
    tenantId: string,
    id: string,
    args: UpdateIntegrationArgs,
  ): Promise<Integration | null> {
    // Build the SET clause incrementally so callers can patch one
    // field without round-tripping the rest.
    const sets: string[] = [];
    const params: unknown[] = [];
    if (args.name !== undefined) {
      params.push(args.name);
      sets.push(`name = $${params.length}`);
    }
    if (args.config !== undefined) {
      params.push(JSON.stringify(args.config));
      sets.push(`config = $${params.length}::jsonb`);
    }
    if (args.events !== undefined) {
      params.push(args.events as unknown as string[]);
      sets.push(`events = $${params.length}`);
    }
    if (args.enabled !== undefined) {
      params.push(args.enabled);
      sets.push(`enabled = $${params.length}`);
    }
    const now = new Date().toISOString();
    params.push(now);
    sets.push(`updated_at = $${params.length}`);
    params.push(tenantId);
    const tenantIdx = params.length;
    params.push(id);
    const idIdx = params.length;
    const res = await this.db.query<IntegrationRow>(
      `UPDATE integrations
          SET ${sets.join(', ')}
        WHERE tenant_id = $${tenantIdx} AND id = $${idIdx}
        RETURNING id, tenant_id, kind, name, config, events, enabled,
                  created_at, updated_at, last_fired_at`,
      params,
    );
    const row = res.rows[0];
    return row !== undefined ? rowToIntegration(row) : null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db.query<{ id: string }>(
      `DELETE FROM integrations
        WHERE tenant_id = $1 AND id = $2
        RETURNING id`,
      [tenantId, id],
    );
    return res.rows.length > 0;
  }

  async markFired(tenantId: string, id: string, at: string): Promise<void> {
    await this.db.query(
      `UPDATE integrations
          SET last_fired_at = $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, at],
    );
  }
}

// ---------------------------------------------------------------------------
// InMemoryIntegrationStore — test harness.
// ---------------------------------------------------------------------------

export class InMemoryIntegrationStore implements IntegrationStore {
  private readonly rows = new Map<string, Integration>();

  async list(tenantId: string): Promise<readonly Integration[]> {
    return [...this.rows.values()]
      .filter((r) => r.tenantId === tenantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async listEnabledForEvent(
    tenantId: string,
    event: IntegrationEvent,
  ): Promise<readonly Integration[]> {
    const all = await this.list(tenantId);
    return all.filter((r) => r.enabled && r.events.includes(event));
  }

  async get(tenantId: string, id: string): Promise<Integration | null> {
    const r = this.rows.get(id);
    return r !== undefined && r.tenantId === tenantId ? r : null;
  }

  async create(args: CreateIntegrationArgs): Promise<Integration> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const row: Integration = {
      id,
      tenantId: args.tenantId,
      kind: args.kind,
      name: args.name,
      config: { ...args.config },
      events: [...args.events],
      enabled: args.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      lastFiredAt: null,
    };
    this.rows.set(id, row);
    return row;
  }

  async update(
    tenantId: string,
    id: string,
    args: UpdateIntegrationArgs,
  ): Promise<Integration | null> {
    const cur = this.rows.get(id);
    if (cur === undefined || cur.tenantId !== tenantId) return null;
    const next: Integration = {
      ...cur,
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.config !== undefined ? { config: { ...args.config } } : {}),
      ...(args.events !== undefined ? { events: [...args.events] } : {}),
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(id, next);
    return next;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const cur = this.rows.get(id);
    if (cur === undefined || cur.tenantId !== tenantId) return false;
    this.rows.delete(id);
    return true;
  }

  async markFired(tenantId: string, id: string, at: string): Promise<void> {
    const cur = this.rows.get(id);
    if (cur === undefined || cur.tenantId !== tenantId) return;
    this.rows.set(id, { ...cur, lastFiredAt: at });
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseJsonbObject(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

function parseEventsArray(v: unknown): IntegrationEvent[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string') as IntegrationEvent[];
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((x) => typeof x === 'string') as IntegrationEvent[];
      }
    } catch {
      // fall through
    }
  }
  return [];
}

function toIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}
