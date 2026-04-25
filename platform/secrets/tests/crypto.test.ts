/**
 * Crypto round-trip + master-key acquisition tests.
 *
 * The interesting properties are:
 *   - encrypt -> decrypt is the identity for valid keys,
 *   - decrypt rejects tampered ciphertext (NaCl secretbox is authenticated),
 *   - fingerprint is stable for the same plaintext,
 *   - preview is the last 4 chars,
 *   - loadMasterKeyFromEnv refuses to fall back in production mode but
 *     accepts a generated key in dev mode (with a warning).
 */

import { describe, expect, it } from 'vitest';
import {
  decodeMasterKey,
  decrypt,
  derivePreview,
  deriveFingerprint,
  encodeMasterKey,
  encrypt,
  generateMasterKey,
  loadMasterKeyFromEnv,
  MASTER_KEY_BYTES,
} from '../src/crypto.js';

describe('crypto', () => {
  it('round-trips plaintext through secretbox', () => {
    const key = generateMasterKey();
    const enc = encrypt('sk-not-a-real-key-1234', key);
    const back = decrypt(enc, key);
    expect(back).toBe('sk-not-a-real-key-1234');
  });

  it('decrypt fails when ciphertext is tampered', () => {
    const key = generateMasterKey();
    const enc = encrypt('hello world', key);
    const tampered = new Uint8Array(enc.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(() => decrypt({ ciphertext: tampered, nonce: enc.nonce }, key)).toThrow(/decryption/);
  });

  it('decrypt fails when key is wrong', () => {
    const k1 = generateMasterKey();
    const k2 = generateMasterKey();
    const enc = encrypt('hello', k1);
    expect(() => decrypt(enc, k2)).toThrow(/decryption/);
  });

  it('derives a stable fingerprint for the same plaintext', () => {
    const fp1 = deriveFingerprint('correct horse battery staple');
    const fp2 = deriveFingerprint('correct horse battery staple');
    const fp3 = deriveFingerprint('different value');
    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fp3);
  });

  it('preview returns the last 4 chars', () => {
    expect(derivePreview('sk-abc1234')).toBe('1234');
    expect(derivePreview('xy')).toBe('xy');
  });

  it('encodes + decodes a master key via base64', () => {
    const k = generateMasterKey();
    const encoded = encodeMasterKey(k);
    const back = decodeMasterKey(encoded);
    expect(Array.from(back)).toEqual(Array.from(k));
    expect(back.length).toBe(MASTER_KEY_BYTES);
  });

  it('decodeMasterKey rejects wrong-length input', () => {
    expect(() => decodeMasterKey(Buffer.from('too-short').toString('base64'))).toThrow(
      /must decode to 32 bytes/,
    );
  });

  it('loadMasterKeyFromEnv reads ALDO_SECRETS_MASTER_KEY', () => {
    const k = generateMasterKey();
    const env = { ALDO_SECRETS_MASTER_KEY: encodeMasterKey(k) };
    const back = loadMasterKeyFromEnv({ env });
    expect(Array.from(back)).toEqual(Array.from(k));
  });

  it('loadMasterKeyFromEnv refuses to start in production when key missing', () => {
    expect(() => loadMasterKeyFromEnv({ env: {} })).toThrow(/ALDO_SECRETS_MASTER_KEY is required/);
  });

  it('loadMasterKeyFromEnv generates a dev key + warns when allowDevFallback', () => {
    let warned = '';
    const k = loadMasterKeyFromEnv({
      env: {},
      allowDevFallback: true,
      warn: (m) => {
        warned = m;
      },
    });
    expect(k.length).toBe(MASTER_KEY_BYTES);
    expect(warned).toMatch(/ALDO_SECRETS_MASTER_KEY is unset/);
  });
});
