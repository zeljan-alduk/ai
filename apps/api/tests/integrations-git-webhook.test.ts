/**
 * Wave-18 (Tier 3.5) — webhook signature verification unit tests.
 *
 * Covers both providers' verification surfaces directly (no HTTP round
 * trip — the route layer is exercised in the e2e test).
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyGithubSignature, verifyGitlabSignature } from '../src/integrations/git/webhook.js';

const SECRET = 'super-secret-test-value';
const BODY = JSON.stringify({ ref: 'refs/heads/main', repository: { name: 'agents' } });

function ghSig(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifyGithubSignature', () => {
  it('accepts a correct signature', () => {
    const res = verifyGithubSignature({
      secret: SECRET,
      body: BODY,
      signatureHeader: ghSig(SECRET, BODY),
    });
    expect(res.ok).toBe(true);
  });

  it('rejects a wrong-secret signature', () => {
    const res = verifyGithubSignature({
      secret: SECRET,
      body: BODY,
      signatureHeader: ghSig('different-secret', BODY),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/mismatch/);
  });

  it('rejects a tampered body', () => {
    const sig = ghSig(SECRET, BODY);
    const res = verifyGithubSignature({
      secret: SECRET,
      body: `${BODY}{}`,
      signatureHeader: sig,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a missing header', () => {
    const res = verifyGithubSignature({ secret: SECRET, body: BODY, signatureHeader: undefined });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/missing/);
  });

  it('rejects an unrecognised header format', () => {
    const res = verifyGithubSignature({
      secret: SECRET,
      body: BODY,
      signatureHeader: 'sha1=deadbeef',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/format/);
  });

  it('rejects an empty header', () => {
    const res = verifyGithubSignature({ secret: SECRET, body: BODY, signatureHeader: '' });
    expect(res.ok).toBe(false);
  });
});

describe('verifyGitlabSignature', () => {
  it('accepts an exact-match token', () => {
    const res = verifyGitlabSignature({ secret: SECRET, tokenHeader: SECRET });
    expect(res.ok).toBe(true);
  });

  it('rejects a different token', () => {
    const res = verifyGitlabSignature({ secret: SECRET, tokenHeader: 'wrong' });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/mismatch/);
  });

  it('rejects a missing token', () => {
    const res = verifyGitlabSignature({ secret: SECRET, tokenHeader: undefined });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/missing/);
  });

  it('rejects a token of different length', () => {
    const res = verifyGitlabSignature({ secret: SECRET, tokenHeader: SECRET.slice(0, -1) });
    expect(res.ok).toBe(false);
  });
});
