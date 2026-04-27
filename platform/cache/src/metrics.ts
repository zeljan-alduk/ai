/**
 * Cache metrics — hit/miss/savings reporter.
 *
 * Misses are NOT persisted (a miss is the absence of a row); the
 * middleware bumps an in-memory counter on every miss and the metrics
 * surface aggregates them with the persisted hit data.
 *
 * The miss counter is process-local. In a multi-process deploy each
 * worker reports its slice; the API endpoint sums them via the
 * shared store + the per-process counter passed in.
 *
 * LLM-agnostic.
 */

import type { CacheStore } from './store.js';

export interface CacheMetricsSnapshot {
  readonly hitCount: number;
  readonly missCount: number;
  readonly hitRate: number;
  readonly totalSavedUsd: number;
  readonly byModel: ReadonlyArray<{
    readonly model: string;
    readonly hits: number;
    readonly savedUsd: number;
  }>;
}

/**
 * Per-process miss counter. Tenant-scoped so a multi-tenant API
 * worker doesn't leak miss totals across tenants.
 */
export class MissCounter {
  private readonly counts = new Map<string, number>();

  bump(tenantId: string): void {
    this.counts.set(tenantId, (this.counts.get(tenantId) ?? 0) + 1);
  }

  get(tenantId: string): number {
    return this.counts.get(tenantId) ?? 0;
  }

  reset(tenantId: string): void {
    this.counts.delete(tenantId);
  }

  resetAll(): void {
    this.counts.clear();
  }
}

export interface CacheMetricsDeps {
  readonly store: CacheStore;
  readonly misses: MissCounter;
}

export class CacheMetrics {
  private readonly store: CacheStore;
  private readonly misses: MissCounter;

  constructor(deps: CacheMetricsDeps) {
    this.store = deps.store;
    this.misses = deps.misses;
  }

  async snapshot(tenantId: string, since: Date): Promise<CacheMetricsSnapshot> {
    const stats = await this.store.stats(tenantId, since);
    const missCount = this.misses.get(tenantId);
    const total = stats.hitCount + missCount;
    const hitRate = total === 0 ? 0 : stats.hitCount / total;
    return {
      hitCount: stats.hitCount,
      missCount,
      hitRate,
      totalSavedUsd: stats.totalSavedUsd,
      byModel: stats.byModel,
    };
  }
}
