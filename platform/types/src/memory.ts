import type { MemoryScope } from './agent.js';
import type { CallContext } from './context.js';

export interface MemoryEntry<T = unknown> {
  readonly scope: MemoryScope;
  readonly key: string;
  readonly value: T;
  readonly at: string;
  readonly ttl?: string; // ISO 8601 duration
}

export interface MemoryStore {
  get<T = unknown>(
    scope: MemoryScope,
    key: string,
    ctx: CallContext,
  ): Promise<MemoryEntry<T> | null>;

  put<T = unknown>(
    scope: MemoryScope,
    key: string,
    value: T,
    retention: string,
    ctx: CallContext,
  ): Promise<void>;

  scan(scope: MemoryScope, prefix: string, ctx: CallContext): AsyncIterable<MemoryEntry>;

  delete(scope: MemoryScope, key: string, ctx: CallContext): Promise<void>;
}
