/**
 * Crypto helpers for `@aldo-ai/secrets`.
 *
 * We use NaCl `secretbox` (xsalsa20-poly1305) via `tweetnacl` — the same
 * primitive Signal / Wire / age use under the hood. It's authenticated,
 * fast, and trivial to call: a single 32-byte symmetric key plus a fresh
 * 24-byte nonce per message. The master key lives in the process env
 * (`ALDO_SECRETS_MASTER_KEY`) and is loaded via `loadMasterKeyFromEnv`.
 *
 * In addition to encrypt/decrypt we expose two purely-derivative helpers:
 *   - `deriveFingerprint(plaintext)` — sha256(plaintext), base64. Stable
 *     across re-encryptions of the same value, lets the API surface a
 *     "did this change?" signal without ever returning the plaintext.
 *   - `derivePreview(plaintext)` — last 4 chars (UTF-8). Lets humans
 *     eyeball "yep, that's the right key" without exposing the rest.
 *
 * No provider name appears anywhere in this module — it's a generic
 * symmetric-encryption box, not a wrapper around any vendor's KMS.
 */

import { createHash, randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';

export const MASTER_KEY_BYTES = 32;
export const NONCE_BYTES = nacl.secretbox.nonceLength; // 24

export interface Encrypted {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
}

/**
 * Encrypt `plaintext` under `key` using NaCl secretbox. Generates a
 * fresh random nonce per call; callers are expected to persist both
 * `ciphertext` and `nonce`.
 */
export function encrypt(plaintext: string, key: Uint8Array): Encrypted {
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error(`master key must be ${MASTER_KEY_BYTES} bytes, got ${key.length}`);
  }
  const nonce = new Uint8Array(randomBytes(NONCE_BYTES));
  const msg = new TextEncoder().encode(plaintext);
  const ciphertext = nacl.secretbox(msg, nonce, key);
  return { ciphertext, nonce };
}

/**
 * Decrypt a (ciphertext, nonce) pair previously produced by `encrypt`.
 * Throws on auth failure — never returns garbage.
 */
export function decrypt(enc: Encrypted, key: Uint8Array): string {
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error(`master key must be ${MASTER_KEY_BYTES} bytes, got ${key.length}`);
  }
  const opened = nacl.secretbox.open(enc.ciphertext, enc.nonce, key);
  if (opened === null) {
    throw new Error('secret decryption failed: bad key or tampered ciphertext');
  }
  return new TextDecoder().decode(opened);
}

/**
 * sha256(plaintext), base64. Used only for change-detection on the
 * write path so the API can return a stable identifier without ever
 * persisting or echoing the plaintext.
 */
export function deriveFingerprint(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('base64');
}

/**
 * The last 4 chars of `plaintext`, used for human "is this the right
 * key?" verification. Returns the entire string when shorter than 4
 * chars, since we'd reveal it anyway by not redacting.
 */
export function derivePreview(plaintext: string): string {
  if (plaintext.length <= 4) return plaintext;
  return plaintext.slice(-4);
}

/**
 * Generate a fresh master key. Used by the API/CLI bootstrapping in
 * dev mode when `ALDO_SECRETS_MASTER_KEY` is unset; production refuses
 * to start in that case.
 */
export function generateMasterKey(): Uint8Array {
  return new Uint8Array(randomBytes(MASTER_KEY_BYTES));
}

/** Encode a 32-byte key as base64 — the env-var format. */
export function encodeMasterKey(key: Uint8Array): string {
  return Buffer.from(key).toString('base64');
}

/** Decode a base64 master key. Throws if it isn't exactly 32 bytes. */
export function decodeMasterKey(encoded: string): Uint8Array {
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length !== MASTER_KEY_BYTES) {
    throw new Error(
      `ALDO_SECRETS_MASTER_KEY must decode to ${MASTER_KEY_BYTES} bytes, got ${buf.length}`,
    );
  }
  return new Uint8Array(buf);
}

export interface LoadMasterKeyOptions {
  /** Pull from this env bag instead of `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * If true and the env var is missing, generate a key and warn instead
   * of throwing. Production callers MUST pass `false`.
   */
  readonly allowDevFallback?: boolean;
  /** Override stderr writer (tests). */
  readonly warn?: (msg: string) => void;
}

/**
 * Resolve the server-side master key from the environment.
 *
 * - `ALDO_SECRETS_MASTER_KEY` set → decode + return.
 * - missing AND `allowDevFallback === true` → generate, warn, return.
 * - missing AND `allowDevFallback === false` (production) → throw.
 *
 * The throw vs. warn split is intentional: production must refuse to
 * boot with no key, but `aldo dev` and tests should keep working out
 * of the box.
 */
export function loadMasterKeyFromEnv(opts: LoadMasterKeyOptions = {}): Uint8Array {
  const env = opts.env ?? process.env;
  const raw = env.ALDO_SECRETS_MASTER_KEY;
  if (typeof raw === 'string' && raw.length > 0) {
    return decodeMasterKey(raw);
  }
  if (opts.allowDevFallback === true) {
    const key = generateMasterKey();
    const warn = opts.warn ?? ((m) => process.stderr.write(`${m}\n`));
    warn(
      'warning: ALDO_SECRETS_MASTER_KEY is unset; generated an ephemeral key for dev. ' +
        'Set it explicitly before persisting any secrets.',
    );
    return key;
  }
  throw new Error(
    'ALDO_SECRETS_MASTER_KEY is required: 32-byte key, base64-encoded. ' +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
  );
}
