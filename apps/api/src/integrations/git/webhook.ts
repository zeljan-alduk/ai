/**
 * Push-webhook signature verification for the wave-18 Git integration
 * (Tier 3.5).
 *
 * Two providers, two signature schemes:
 *
 *   - GitHub: HMAC-SHA256 of the raw request body using the configured
 *     secret. Sent as `X-Hub-Signature-256: sha256=<hex>`. Constant-time
 *     compared. The legacy `X-Hub-Signature` (sha1) header is NOT
 *     accepted — GitHub still sends it for back-compat but documents
 *     sha256 as preferred and modern.
 *
 *   - GitLab: cleartext token compared to `X-Gitlab-Token`. GitLab does
 *     NOT sign the body. Best-effort here too: we constant-time compare
 *     the bytes so a timing-attack against a shorter token doesn't leak
 *     length.
 *
 * Both verifiers take the RAW request body bytes (not parsed JSON) so
 * we don't accidentally re-serialise and break the signature. The route
 * handler reads `c.req.raw.text()` (or `arrayBuffer()`) and hands the
 * bytes here.
 *
 * Constant-time string compare: Node's `crypto.timingSafeEqual` requires
 * equal-length buffers, so we early-return false on a length mismatch
 * (no information leak — the attacker already controls the input
 * length they send).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifyResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export function verifyGithubSignature(args: {
  readonly secret: string;
  readonly body: string;
  readonly signatureHeader: string | undefined;
}): VerifyResult {
  if (typeof args.signatureHeader !== 'string' || args.signatureHeader.length === 0) {
    return { ok: false, reason: 'missing X-Hub-Signature-256 header' };
  }
  const match = /^sha256=([a-f0-9]+)$/i.exec(args.signatureHeader);
  if (match === null || match[1] === undefined) {
    return { ok: false, reason: 'invalid X-Hub-Signature-256 format (expected sha256=<hex>)' };
  }
  const expected = createHmac('sha256', args.secret).update(args.body).digest('hex');
  return constantTimeStringEq(expected, match[1].toLowerCase())
    ? { ok: true }
    : { ok: false, reason: 'signature mismatch' };
}

export function verifyGitlabSignature(args: {
  readonly secret: string;
  readonly tokenHeader: string | undefined;
}): VerifyResult {
  if (typeof args.tokenHeader !== 'string' || args.tokenHeader.length === 0) {
    return { ok: false, reason: 'missing X-Gitlab-Token header' };
  }
  return constantTimeStringEq(args.secret, args.tokenHeader)
    ? { ok: true }
    : { ok: false, reason: 'token mismatch' };
}

/**
 * Pad-aware constant-time compare. The Node primitive throws on a length
 * mismatch; we explicitly return false in that case. The fallback path
 * uses a `Buffer.alloc(...)` zero-fill so the timingSafeEqual call still
 * runs over the longer length — the attacker always sees the same
 * overall code path regardless of input length.
 */
function constantTimeStringEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Run the compare against a same-length zero buffer so the timing
    // profile doesn't change between length-mismatch and content-mismatch.
    timingSafeEqual(ab, Buffer.alloc(ab.length));
    return false;
  }
  return timingSafeEqual(ab, bb);
}
