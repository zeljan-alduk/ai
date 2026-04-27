/**
 * Cache store interface + in-memory and Postgres implementations.
 *
 * The store is tenant-scoped at the API layer — every read and write
 * threads `tenantId`. Crossing tenants requires both a tenant-id
 * mismatch AND a SHA-256 collision, which is infeasible.
 *
 * Cached entries carry the rendered response (the full text + tool
 * calls + finish reason + usage) plus the cost saved by replaying it.
 * Cost is the cost the original call paid; on every replay we
 * accumulate that into `cost_saved_usd` so the dashboard can report
 * cumulative savings.
 *
 * LLM-agnostic: the entry stores `model` as an opaque string. We do
 * not branch on provider anywhere in this file.
 */

import type { SqlClient } from '@aldo-ai/storage';
import type { Delta } from '@aldo-ai/types';

/**
 * The on-the-wire shape of a cached response. We persist the full
 * delta sequence (so a replay can be byte-identical at the engine's
 * seam) plus a flat copy of the final text / finish reason / usage
 * for fast metrics.
 */
export interface CachedEntry {
  /** Opaque model id the original call resolved to. */
  readonly model: string;
  /**
   * The recorded delta sequence. Replays emit these in order — see
   * `middleware.ts` for the chosen replay mode (single full-text
   * delta + an end frame; see README/middleware comment).
   */
  readonly deltas: readonly Delta[];
  /** Final text (concatenation of every text delta). Convenience copy. */
  readonly text: string;
  /** Finish reason from the original call. */
  readonly finishReason: 'stop' | 'length' | 'tool_use' | 'error';
  /**
   * Original usage record. The `usd` field is what we count as the
   * "cost saved" each time this entry is hit.
   */
  readonly usage: {
    readonly provider: string;
    readonly model: string;
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly usd: number;
  };
  /** ISO timestamp of the original write. */
  readonly createdAt: string;
  /** Hit counter, post-increment. */
  readonly hitCount: number;
  /** Sum of usd saved across every replay. Includes the latest hit. */
  readonly costSavedUsd: number;
  /** ISO of the most recent hit, or null if never hit. */
  readonly lastHitAt: string | null;
  /** ISO of expiration, or null for never. */
  readonly expiresAt: string | null;
}

export interface CacheStorePutOptions {
  /** TTL in seconds; null/undefined for no expiry. */
  readonly ttlSeconds?: number | null;
}

/**
 * Predicate for `purge`. Receives the row's `model`, `createdAt`, and
 * `expiresAt`; returns `true` if the row should be deleted.
 */
export type PurgePredicate = (row: {
  readonly model: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}) => boolean;

export interface CacheStore {
  /** Read an entry. Returns null when missing or expired. */
  get(tenantId: string, key: string): Promise<CachedEntry | null>;
  /** Write an entry. Overwrites any prior entry under the same key. */
  set(
    tenantId: string,
    key: string,
    entry: Omit<CachedEntry, 'createdAt' | 'hitCount' | 'costSavedUsd' | 'lastHitAt' | 'expiresAt'>,
    opts?: CacheStorePutOptions,
  ): Promise<void>;
  /**
   * Increment hit_count, last_hit_at, and accumulate cost_saved_usd
   * for the entry under (tenantId, key). No-op if the entry is missing.
   * Returns the new hit count, or 0 if there was nothing to update.
   */
  recordHit(tenantId: string, key: string, savedUsd: number): Promise<number>;
  /** Delete entries matching `pred`. Returns the count removed. */
  purge(tenantId: string, pred: PurgePredicate): Promise<number>;
  /** Drop every entry for the tenant. Returns the count removed. */
  purgeAll(tenantId: string): Promise<number>;
  /** Flush expired rows. Returns the count removed. */
  sweepExpired(tenantId: string, now?: Date): Promise<number>;
  /**
   * Aggregate hit/miss/savings stats for `tenantId` since `since`.
   * Misses are NOT stored (a miss is the absence of a row); we count
   * them separately on the middleware side. This method only reports
   * the persisted dimension: hits + saved + per-model breakdown.
   */
  stats(
    tenantId: string,
    since: Date,
  ): Promise<{
    readonly hitCount: number;
    readonly totalSavedUsd: number;
    readonly byModel: ReadonlyArray<{
      readonly model: string;
      readonly hits: number;
      readonly savedUsd: number;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// InMemoryCacheStore — dev / tests.
// ---------------------------------------------------------------------------

interface MemRow extends CachedEntry {
  readonly tenantId: string;
  readonly key: string;
}

export class InMemoryCacheStore implements CacheStore {
  private readonly rows = new Map<string, MemRow>();
  private readonly clock: () => Date;

  constructor(opts: { readonly clock?: () => Date } = {}) {
    this.clock = opts.clock ?? (() => new Date());
  }

  private mk(tenantId: string, key: string): string {
    return `${tenantId}::${key}`;
  }

  async get(tenantId: string, key: string): Promise<CachedEntry | null> {
    const row = this.rows.get(this.mk(tenantId, key));
    if (row === undefined) return null;
    if (row.expiresAt !== null && new Date(row.expiresAt) <= this.clock()) {
      this.rows.delete(this.mk(tenantId, key));
      return null;
    }
    return row;
  }

  async set(
    tenantId: string,
    key: string,
    entry: Omit<CachedEntry, 'createdAt' | 'hitCount' | 'costSavedUsd' | 'lastHitAt' | 'expiresAt'>,
    opts: CacheStorePutOptions = {},
  ): Promise<void> {
    const now = this.clock();
    const ttl = opts.ttlSeconds ?? null;
    const expiresAt = ttl !== null ? new Date(now.getTime() + ttl * 1000).toISOString() : null;
    this.rows.set(this.mk(tenantId, key), {
      tenantId,
      key,
      model: entry.model,
      deltas: entry.deltas,
      text: entry.text,
      finishReason: entry.finishReason,
      usage: entry.usage,
      createdAt: now.toISOString(),
      hitCount: 0,
      costSavedUsd: 0,
      lastHitAt: null,
      expiresAt,
    });
  }

  async recordHit(tenantId: string, key: string, savedUsd: number): Promise<number> {
    const row = this.rows.get(this.mk(tenantId, key));
    if (row === undefined) return 0;
    const next: MemRow = {
      ...row,
      hitCount: row.hitCount + 1,
      costSavedUsd: row.costSavedUsd + savedUsd,
      lastHitAt: this.clock().toISOString(),
    };
    this.rows.set(this.mk(tenantId, key), next);
    return next.hitCount;
  }

  async purge(tenantId: string, pred: PurgePredicate): Promise<number> {
    let removed = 0;
    for (const [k, row] of [...this.rows.entries()]) {
      if (row.tenantId !== tenantId) continue;
      if (pred({ model: row.model, createdAt: row.createdAt, expiresAt: row.expiresAt })) {
        this.rows.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  async purgeAll(tenantId: string): Promise<number> {
    let removed = 0;
    for (const [k, row] of [...this.rows.entries()]) {
      if (row.tenantId !== tenantId) continue;
      this.rows.delete(k);
      removed += 1;
    }
    return removed;
  }

  async sweepExpired(tenantId: string, now: Date = this.clock()): Promise<number> {
    let removed = 0;
    for (const [k, row] of [...this.rows.entries()]) {
      if (row.tenantId !== tenantId) continue;
      if (row.expiresAt !== null && new Date(row.expiresAt) <= now) {
        this.rows.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  async stats(tenantId: string, since: Date) {
    let hitCount = 0;
    let totalSavedUsd = 0;
    const byModel = new Map<string, { hits: number; savedUsd: number }>();
    for (const row of this.rows.values()) {
      if (row.tenantId !== tenantId) continue;
      if (row.lastHitAt === null) continue;
      if (new Date(row.lastHitAt) < since) continue;
      hitCount += row.hitCount;
      totalSavedUsd += row.costSavedUsd;
      const slot = byModel.get(row.model) ?? { hits: 0, savedUsd: 0 };
      slot.hits += row.hitCount;
      slot.savedUsd += row.costSavedUsd;
      byModel.set(row.model, slot);
    }
    return {
      hitCount,
      totalSavedUsd,
      byModel: [...byModel.entries()]
        .map(([model, v]) => ({ model, hits: v.hits, savedUsd: v.savedUsd }))
        .sort((a, b) => b.hits - a.hits),
    };
  }
}

// ---------------------------------------------------------------------------
// PostgresCacheStore — production wiring against migration 017.
// ---------------------------------------------------------------------------

interface CacheRow {
  readonly tenant_id: string;
  readonly key: string;
  readonly model: string;
  readonly response: unknown;
  readonly usage: unknown;
  readonly cost_saved_usd: string | number;
  readonly hit_count: number | string;
  readonly created_at: string | Date;
  readonly last_hit_at: string | Date | null;
  readonly expires_at: string | Date | null;
  readonly [k: string]: unknown;
}

function rowToEntry(row: CacheRow): CachedEntry {
  const response = parseJsonObject(row.response) as {
    deltas?: readonly Delta[];
    text?: string;
    finishReason?: 'stop' | 'length' | 'tool_use' | 'error';
  };
  const usage = parseJsonObject(row.usage) as {
    provider?: string;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    usd?: number;
  };
  return {
    model: row.model,
    deltas: response.deltas ?? [],
    text: typeof response.text === 'string' ? response.text : '',
    finishReason:
      response.finishReason === 'length' ||
      response.finishReason === 'tool_use' ||
      response.finishReason === 'error'
        ? response.finishReason
        : 'stop',
    usage: {
      provider: typeof usage.provider === 'string' ? usage.provider : '',
      model: typeof usage.model === 'string' ? usage.model : row.model,
      tokensIn: typeof usage.tokensIn === 'number' ? usage.tokensIn : 0,
      tokensOut: typeof usage.tokensOut === 'number' ? usage.tokensOut : 0,
      usd: typeof usage.usd === 'number' ? usage.usd : 0,
    },
    createdAt: toIso(row.created_at),
    hitCount: Number(row.hit_count),
    costSavedUsd: Number(row.cost_saved_usd),
    lastHitAt: row.last_hit_at === null ? null : toIso(row.last_hit_at),
    expiresAt: row.expires_at === null ? null : toIso(row.expires_at),
  };
}

export class PostgresCacheStore implements CacheStore {
  private readonly db: SqlClient;
  constructor(opts: { readonly client: SqlClient }) {
    this.db = opts.client;
  }

  async get(tenantId: string, key: string): Promise<CachedEntry | null> {
    const res = await this.db.query<CacheRow>(
      `SELECT tenant_id, key, model, response, usage, cost_saved_usd,
              hit_count, created_at, last_hit_at, expires_at
         FROM llm_response_cache
        WHERE tenant_id = $1 AND key = $2`,
      [tenantId, key],
    );
    const row = res.rows[0];
    if (row === undefined) return null;
    const entry = rowToEntry(row);
    if (entry.expiresAt !== null && new Date(entry.expiresAt) <= new Date()) {
      // Lazy-evict expired rows on read; saves the caller a separate
      // sweep call. Best-effort.
      await this.db.query('DELETE FROM llm_response_cache WHERE tenant_id = $1 AND key = $2', [
        tenantId,
        key,
      ]);
      return null;
    }
    return entry;
  }

  async set(
    tenantId: string,
    key: string,
    entry: Omit<CachedEntry, 'createdAt' | 'hitCount' | 'costSavedUsd' | 'lastHitAt' | 'expiresAt'>,
    opts: CacheStorePutOptions = {},
  ): Promise<void> {
    const now = new Date();
    const ttl = opts.ttlSeconds ?? null;
    const expiresAt = ttl !== null ? new Date(now.getTime() + ttl * 1000).toISOString() : null;
    const responseJson = JSON.stringify({
      deltas: entry.deltas,
      text: entry.text,
      finishReason: entry.finishReason,
    });
    const usageJson = JSON.stringify(entry.usage);
    await this.db.query(
      `INSERT INTO llm_response_cache
         (tenant_id, key, model, response, usage,
          cost_saved_usd, hit_count, created_at, last_hit_at, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 0, 0, $6, NULL, $7)
       ON CONFLICT (tenant_id, key) DO UPDATE
         SET model          = EXCLUDED.model,
             response       = EXCLUDED.response,
             usage          = EXCLUDED.usage,
             cost_saved_usd = 0,
             hit_count      = 0,
             created_at     = EXCLUDED.created_at,
             last_hit_at    = NULL,
             expires_at     = EXCLUDED.expires_at`,
      [tenantId, key, entry.model, responseJson, usageJson, now.toISOString(), expiresAt],
    );
  }

  async recordHit(tenantId: string, key: string, savedUsd: number): Promise<number> {
    const res = await this.db.query<{ hit_count: number | string }>(
      `UPDATE llm_response_cache
          SET hit_count      = hit_count + 1,
              cost_saved_usd = cost_saved_usd + $3,
              last_hit_at    = $4
        WHERE tenant_id = $1 AND key = $2
        RETURNING hit_count`,
      [tenantId, key, savedUsd.toFixed(6), new Date().toISOString()],
    );
    const row = res.rows[0];
    return row !== undefined ? Number(row.hit_count) : 0;
  }

  async purge(tenantId: string, pred: PurgePredicate): Promise<number> {
    // The predicate is JS — fetch the candidate set then DELETE by
    // primary key. Acceptable: purge is an explicit admin action,
    // not a hot path.
    const res = await this.db.query<{
      key: string;
      model: string;
      created_at: string | Date;
      expires_at: string | Date | null;
    }>(
      `SELECT key, model, created_at, expires_at
         FROM llm_response_cache
        WHERE tenant_id = $1`,
      [tenantId],
    );
    let removed = 0;
    for (const row of res.rows) {
      if (
        pred({
          model: row.model,
          createdAt: toIso(row.created_at),
          expiresAt: row.expires_at === null ? null : toIso(row.expires_at),
        })
      ) {
        await this.db.query('DELETE FROM llm_response_cache WHERE tenant_id = $1 AND key = $2', [
          tenantId,
          row.key,
        ]);
        removed += 1;
      }
    }
    return removed;
  }

  async purgeAll(tenantId: string): Promise<number> {
    const res = await this.db.query(
      'DELETE FROM llm_response_cache WHERE tenant_id = $1 RETURNING key',
      [tenantId],
    );
    return res.rowCount;
  }

  async sweepExpired(tenantId: string, now: Date = new Date()): Promise<number> {
    const res = await this.db.query(
      `DELETE FROM llm_response_cache
        WHERE tenant_id = $1
          AND expires_at IS NOT NULL
          AND expires_at <= $2
        RETURNING key`,
      [tenantId, now.toISOString()],
    );
    return res.rowCount;
  }

  async stats(tenantId: string, since: Date) {
    const res = await this.db.query<{
      model: string;
      hits: string | number;
      saved: string | number;
    }>(
      `SELECT model,
              COALESCE(SUM(hit_count), 0)        AS hits,
              COALESCE(SUM(cost_saved_usd), 0)   AS saved
         FROM llm_response_cache
        WHERE tenant_id = $1
          AND last_hit_at IS NOT NULL
          AND last_hit_at >= $2
        GROUP BY model
        ORDER BY hits DESC`,
      [tenantId, since.toISOString()],
    );
    let hitCount = 0;
    let totalSavedUsd = 0;
    const byModel = res.rows.map((r) => {
      const hits = Number(r.hits);
      const savedUsd = Number(r.saved);
      hitCount += hits;
      totalSavedUsd += savedUsd;
      return { model: r.model, hits, savedUsd };
    });
    return { hitCount, totalSavedUsd, byModel };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseJsonObject(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
    return {};
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

function toIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}
