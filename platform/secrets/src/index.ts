/**
 * `@aldo-ai/secrets` — tenant-scoped secrets with `secret://` resolution.
 *
 * Three layers:
 *
 *   1. crypto — NaCl secretbox round-trip + fingerprint/preview/master-key
 *      helpers. No provider names; symmetric primitive only.
 *   2. store  — `SecretStore` interface plus an in-memory test
 *      implementation and a `PostgresSecretStore` that uses the shared
 *      `SqlClient` from `@aldo-ai/storage`. The Postgres store is the
 *      one wired into the API and engine in production.
 *   3. resolver — `secret://NAME` substitution at tool-call time.
 *      Strings only; tool args are walked recursively. Every successful
 *      resolve writes one audit row.
 *
 * The wire-format types live in `@aldo-ai/api-contract`. We reuse
 * `SecretSummary` here so the store and the API never drift.
 */

export {
  decodeMasterKey,
  decrypt,
  derivePreview,
  deriveFingerprint,
  encodeMasterKey,
  encrypt,
  generateMasterKey,
  loadMasterKeyFromEnv,
  MASTER_KEY_BYTES,
  NONCE_BYTES,
  type Encrypted,
  type LoadMasterKeyOptions,
} from './crypto.js';

export {
  findRefs,
  parseRefs,
  SECRET_REF_REGEX,
  type SecretRefMatch,
} from './parser.js';

export {
  hasRefs,
  resolveInArgs,
  resolveRefs,
  UnknownSecretError,
  type ResolveContext,
} from './resolver.js';

export {
  InMemorySecretStore,
  PostgresSecretStore,
  type PostgresSecretStoreOptions,
  type ResolvedSecret,
  type SecretAuditEntry,
  type SecretStore,
} from './store.js';
