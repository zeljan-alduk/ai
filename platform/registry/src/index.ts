/**
 * @aldo-ai/registry — agent-spec loader, validator, and version store.
 * Implements the `AgentRegistry` interface from `@aldo-ai/types`.
 */

export { agentV1YamlSchema, type AgentV1Yaml } from './schema.js';
export { parseYaml, loadFromFile, type LoadOutcome, type LoadOk, type LoadErr } from './loader.js';
export { validate } from './validator.js';
export {
  InMemoryStorage,
  AgentNotFoundError,
  NoPromotedVersionError,
  VersionMismatchError,
  type RegistryStorage,
  type StoredVersion,
} from './storage.js';
export { PostgresStorage, type PostgresStorageOptions } from './postgres.js';
export {
  AgentRegistry,
  RegistryLoadError,
  EvidenceRejectedError,
  type RegistryOptions,
} from './registry.js';
export { assertValid, isValid, compare, latest, InvalidSemverError } from './semver.js';

// Wave 10: tenant-scoped registered-agent store.
export {
  InMemoryRegisteredAgentStore,
  PostgresRegisteredAgentStore,
  RegisteredAgentNotFoundError,
  type PostgresRegisteredAgentStoreOptions,
  type RegisteredAgent,
  type RegisteredAgentStore,
} from './stores/index.js';
export {
  copyTenantAgents,
  seedDefaultTenantFromAgency,
  seedFromDirectory,
  type CopyTenantOptions,
  type CopyTenantResult,
  type SeedDefaultTenantOptions,
  type SeedFromDirectoryOptions,
  type SeedResult,
} from './seed.js';
