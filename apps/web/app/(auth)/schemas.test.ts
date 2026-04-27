/**
 * Unit tests for the auth form schemas + the `next=` redirect
 * whitelist.
 */

import { describe, expect, it } from 'vitest';
import { LoginFormSchema, PASSWORD_MIN_LEN, SignupFormSchema, safeNextPath } from './schemas.js';

describe('SignupFormSchema', () => {
  it('accepts a valid payload', () => {
    const r = SignupFormSchema.safeParse({
      email: 'alice@example.test',
      password: 'a-strong-passphrase',
      tenantName: 'Acme Robotics',
    });
    expect(r.success).toBe(true);
  });

  it('rejects short passwords matching the API minimum', () => {
    const r = SignupFormSchema.safeParse({
      email: 'alice@example.test',
      password: 'short',
      tenantName: 'Acme',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'password')).toBe(true);
    }
    // Sanity-check the constant lines up with the brief (12 chars).
    expect(PASSWORD_MIN_LEN).toBeGreaterThanOrEqual(12);
  });

  it('rejects malformed emails', () => {
    const r = SignupFormSchema.safeParse({
      email: 'not-an-email',
      password: 'a-strong-passphrase',
      tenantName: 'Acme',
    });
    expect(r.success).toBe(false);
  });

  it('trims the email and tenantName', () => {
    const r = SignupFormSchema.safeParse({
      email: '  alice@example.test  ',
      password: 'a-strong-passphrase',
      tenantName: '  Acme  ',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe('alice@example.test');
      expect(r.data.tenantName).toBe('Acme');
    }
  });

  it('rejects an empty tenantName', () => {
    const r = SignupFormSchema.safeParse({
      email: 'a@b.test',
      password: 'a-strong-passphrase',
      tenantName: '   ',
    });
    expect(r.success).toBe(false);
  });
});

describe('LoginFormSchema', () => {
  it('accepts a non-empty password', () => {
    const r = LoginFormSchema.safeParse({ email: 'a@b.test', password: 'x' });
    expect(r.success).toBe(true);
  });
  it('rejects an empty password', () => {
    const r = LoginFormSchema.safeParse({ email: 'a@b.test', password: '' });
    expect(r.success).toBe(false);
  });
  it('rejects a malformed email', () => {
    const r = LoginFormSchema.safeParse({ email: 'nope', password: 'x' });
    expect(r.success).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('accepts same-origin relative paths', () => {
    expect(safeNextPath('/runs')).toBe('/runs');
    expect(safeNextPath('/agents/foo')).toBe('/agents/foo');
    expect(safeNextPath('/runs?cursor=abc')).toBe('/runs?cursor=abc');
  });

  it('rejects null and empty', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath('')).toBeNull();
  });

  it('rejects protocol-relative URLs', () => {
    expect(safeNextPath('//evil.example/foo')).toBeNull();
  });

  it('rejects absolute URLs with a scheme', () => {
    expect(safeNextPath('https://evil.example/foo')).toBeNull();
    expect(safeNextPath('javascript:alert(1)')).toBeNull();
  });

  it('rejects paths that bounce back into the auth flow', () => {
    expect(safeNextPath('/login')).toBeNull();
    expect(safeNextPath('/signup')).toBeNull();
    expect(safeNextPath('/login?next=/runs')).toBeNull();
  });

  it('rejects bare relative paths without a leading slash', () => {
    expect(safeNextPath('runs')).toBeNull();
  });
});
