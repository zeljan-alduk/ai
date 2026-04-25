/**
 * Unit tests for `lib/session.ts`.
 *
 * We exercise the cookie-config helper directly (pure function) and
 * the `getSession` / `setSession` / `clearSession` round-trip via a
 * mock `next/headers` cookies() jar.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface CookieEntry {
  value: string;
  options?: Record<string, unknown>;
}

const jar = new Map<string, CookieEntry>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const v = jar.get(name);
      return v ? { name, value: v.value } : undefined;
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      jar.set(name, { value, ...(options ? { options } : {}) });
    },
  }),
}));

vi.mock('server-only', () => ({}));

beforeEach(() => {
  jar.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sessionCookieOptions', () => {
  it('uses HTTP-only, sameSite=lax, path=/, 14d max-age', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { sessionCookieOptions, SESSION_MAX_AGE_SECONDS } = await import('./session.js');
    const opts = sessionCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.path).toBe('/');
    expect(opts.maxAge).toBe(SESSION_MAX_AGE_SECONDS);
    expect(SESSION_MAX_AGE_SECONDS).toBe(14 * 24 * 60 * 60);
  });

  it('marks the cookie secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { sessionCookieOptions } = await import('./session.js');
    expect(sessionCookieOptions().secure).toBe(true);
  });

  it('keeps the cookie non-secure in development so localhost works', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const { sessionCookieOptions } = await import('./session.js');
    expect(sessionCookieOptions().secure).toBe(false);
  });
});

describe('getSession / setSession / clearSession', () => {
  it('returns null when no cookie has been set', async () => {
    const { getSession } = await import('./session.js');
    expect(await getSession()).toBeNull();
  });

  it('round-trips a token through setSession + getSession', async () => {
    const { setSession, getSession } = await import('./session.js');
    await setSession('jwt-abc-123');
    const sess = await getSession();
    expect(sess).toEqual({ token: 'jwt-abc-123' });
  });

  it('writes the cookie with the session-cookie name', async () => {
    const { setSession, SESSION_COOKIE } = await import('./session.js');
    await setSession('token-x');
    expect(SESSION_COOKIE).toBe('aldo_session');
    expect(jar.get('aldo_session')?.value).toBe('token-x');
  });

  it('clearSession blanks the cookie and getSession then returns null', async () => {
    const { setSession, clearSession, getSession } = await import('./session.js');
    await setSession('token-y');
    expect((await getSession())?.token).toBe('token-y');
    await clearSession();
    expect(await getSession()).toBeNull();
  });

  it('clearSession sets maxAge=0 so the browser expires the cookie immediately', async () => {
    const { setSession, clearSession } = await import('./session.js');
    await setSession('token-z');
    await clearSession();
    const entry = jar.get('aldo_session');
    expect(entry?.value).toBe('');
    expect((entry?.options as { maxAge?: number } | undefined)?.maxAge).toBe(0);
  });
});
