/**
 * Password hashing for the auth module.
 *
 * Argon2id (the default in `@node-rs/argon2`) — memory-hard, side-channel
 * resistant, OWASP-recommended for password storage. We rely on the
 * library's defaults (memoryCost=4096 KiB, timeCost=3) which match the
 * RFC 9106 minimum recommendations; tuning higher costs MVP for
 * sub-100ms login latency on cheap dev hardware. We can crank the cost
 * later without a migration — verifying old hashes still works because
 * argon2 self-describes its parameters in the encoded string.
 *
 * The exposed surface is intentionally minimal:
 *   - `hashPassword(plain)` -> encoded argon2id string
 *   - `verifyPassword(encoded, plain)` -> boolean
 *   - `assertPasswordPolicy(plain)` -> throws on policy violations
 *
 * MVP password policy:
 *   - minimum 12 characters (per the brief).
 *   - server-side enforcement is the load-bearing one; client-side
 *     validation is Engineer N's job.
 *
 * LLM-agnostic: nothing in this file knows or cares about provider keys.
 */

import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/** Per the brief: minimum 12 chars. Raise this in a future wave. */
export const MIN_PASSWORD_LENGTH = 12;

export class PasswordPolicyError extends Error {
  public readonly reason: 'too_short';
  constructor(reason: 'too_short', message: string) {
    super(message);
    this.name = 'PasswordPolicyError';
    this.reason = reason;
  }
}

/**
 * Throws when `password` doesn't meet the server-side policy. Routes
 * call this BEFORE hashing — there's no point spending CPU on a value
 * the policy will reject anyway.
 */
export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      'too_short',
      `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}

/** Hash a plaintext password using the library's secure defaults. */
export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain);
}

/**
 * Verify a previously-hashed password. Returns false on mismatch and
 * on every form of decode error — verify NEVER throws on a wrong
 * password (timing is constant) or a malformed hash. Callers can
 * always treat false as "invalid credentials".
 */
export async function verifyPassword(encoded: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(encoded, plain);
  } catch {
    return false;
  }
}
