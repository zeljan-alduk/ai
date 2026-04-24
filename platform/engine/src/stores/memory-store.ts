import type { CallContext, MemoryEntry, MemoryScope, MemoryStore } from '@meridian/types';

/**
 * In-memory, scope-aware MemoryStore for v0.
 *
 * Keys are namespaced by {tenant, scope, agentName, key} where appropriate:
 * - 'private' is scoped to the agent (tenant+agentName)
 * - 'project' and 'org' are scoped to the tenant only (shared across agents)
 * - 'session' is scoped to the runId
 *
 * Retention (TTL) is recorded on the entry but not actively swept in v0.
 * TODO(v1): periodic TTL sweep + Postgres-backed store.
 */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly data = new Map<string, MemoryEntry>();

  private compose(scope: MemoryScope, key: string, ctx: CallContext): string {
    const tenant = ctx.tenant;
    switch (scope) {
      case 'private':
        return `${tenant}::private::${ctx.agentName}::${key}`;
      case 'project':
        return `${tenant}::project::${key}`;
      case 'org':
        return `${tenant}::org::${key}`;
      case 'session':
        return `${tenant}::session::${ctx.runId}::${key}`;
    }
  }

  async get<T = unknown>(
    scope: MemoryScope,
    key: string,
    ctx: CallContext,
  ): Promise<MemoryEntry<T> | null> {
    const composed = this.compose(scope, key, ctx);
    const entry = this.data.get(composed);
    return (entry as MemoryEntry<T> | undefined) ?? null;
  }

  async put<T = unknown>(
    scope: MemoryScope,
    key: string,
    value: T,
    retention: string,
    ctx: CallContext,
  ): Promise<void> {
    const composed = this.compose(scope, key, ctx);
    const entry: MemoryEntry<T> = {
      scope,
      key,
      value,
      at: new Date().toISOString(),
      ttl: retention,
    };
    this.data.set(composed, entry);
  }

  async *scan(scope: MemoryScope, prefix: string, ctx: CallContext): AsyncIterable<MemoryEntry> {
    const composedPrefix = this.compose(scope, prefix, ctx);
    for (const [k, v] of this.data.entries()) {
      if (k.startsWith(composedPrefix)) yield v;
    }
  }

  async delete(scope: MemoryScope, key: string, ctx: CallContext): Promise<void> {
    const composed = this.compose(scope, key, ctx);
    this.data.delete(composed);
  }
}
