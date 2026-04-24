/**
 * @meridian/registry — agent-spec loader, validator, and version store.
 * Implements the `AgentRegistry` interface from `@meridian/types`.
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
