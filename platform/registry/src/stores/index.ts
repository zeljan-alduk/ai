/**
 * Tenant-scoped registered-agent stores.
 *
 * Re-exports the wave-10 store interface and its in-memory + Postgres
 * implementations so callers (apps/api, the eval gate) can pick the
 * right one for their environment.
 */

export type {
  ListOptions,
  RegisterOptions,
  RegisteredAgent,
  RegisteredAgentStore,
} from './types.js';
export {
  InMemoryRegisteredAgentStore,
  RegisteredAgentNotFoundError,
} from './in-memory.js';
export {
  PostgresRegisteredAgentStore,
  type PostgresRegisteredAgentStoreOptions,
} from './postgres.js';
