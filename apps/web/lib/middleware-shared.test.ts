/**
 * Unit tests for the middleware route-guard helpers.
 *
 * The Next middleware itself is exercised via these pure helpers
 * because instantiating a `NextRequest` with a real cookie store is
 * heavyweight and the interesting logic — what counts as public, how
 * we encode the redirect — is in this module.
 */

import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME, isPublicPath, redirectToLogin } from './middleware-shared.js';

describe('SESSION_COOKIE_NAME', () => {
  it('matches the cookie name session.ts writes', () => {
    expect(SESSION_COOKIE_NAME).toBe('aldo_session');
  });
});

describe('isPublicPath', () => {
  it('treats /login and /signup as public', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/signup')).toBe(true);
  });
  it('treats /api/health as public', () => {
    expect(isPublicPath('/api/health')).toBe(true);
  });
  it('treats Next internals and the favicon as public', () => {
    expect(isPublicPath('/_next/static/foo.js')).toBe(true);
    expect(isPublicPath('/favicon.ico')).toBe(true);
  });
  it('rejects /runs and other protected paths', () => {
    expect(isPublicPath('/runs')).toBe(false);
    expect(isPublicPath('/runs/abc-123')).toBe(false);
    expect(isPublicPath('/agents')).toBe(false);
    expect(isPublicPath('/secrets/new')).toBe(false);
  });
  it('rejects spoofed prefixes that are not the canonical route', () => {
    // `/loginx` should NOT be treated as public.
    expect(isPublicPath('/loginx')).toBe(false);
    expect(isPublicPath('/signup-foo')).toBe(false);
  });

  // Wave-11 marketing surface — the public face of the product.
  describe('marketing routes', () => {
    it('treats the marketing homepage / as public', () => {
      expect(isPublicPath('/')).toBe(true);
    });
    it('treats /pricing, /about, /security, /design-partner, /docs as public', () => {
      expect(isPublicPath('/pricing')).toBe(true);
      expect(isPublicPath('/about')).toBe(true);
      expect(isPublicPath('/security')).toBe(true);
      expect(isPublicPath('/design-partner')).toBe(true);
      expect(isPublicPath('/docs')).toBe(true);
    });
    it('treats query strings on marketing routes as public (e.g. /pricing?plan=team)', () => {
      expect(isPublicPath('/pricing?plan=team')).toBe(true);
      expect(isPublicPath('/design-partner?ref=hn')).toBe(true);
    });
    it('does NOT treat the homepage as a wildcard parent of protected routes', () => {
      // Defensive: `pathname.startsWith('/')` is true for every URL,
      // so `/` MUST be matched as an exact-only public path.
      expect(isPublicPath('/runs')).toBe(false);
      expect(isPublicPath('/agents/system-architect')).toBe(false);
    });
    it('rejects spoofed marketing prefixes (e.g. /pricingx, /aboutus)', () => {
      expect(isPublicPath('/pricingx')).toBe(false);
      expect(isPublicPath('/aboutus')).toBe(false);
      expect(isPublicPath('/securityz')).toBe(false);
    });
  });
});

interface FakeRequest {
  nextUrl: URL & { clone: () => URL };
}

function fakeReq(path: string, search = ''): FakeRequest {
  const url = new URL(`https://app.example.test${path}${search}`) as URL & {
    clone: () => URL;
  };
  url.clone = () => new URL(url.toString()) as URL & { clone: () => URL };
  return { nextUrl: url };
}

describe('redirectToLogin', () => {
  it('redirects to /login with a `next` query carrying the original path', () => {
    const req = fakeReq('/runs/abc');
    // @ts-expect-error — fakeReq is a structural stand-in for NextRequest.
    const res = redirectToLogin(req);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain(`next=${encodeURIComponent('/runs/abc')}`);
  });

  it('preserves the original query string in the next= target', () => {
    const req = fakeReq('/runs', '?cursor=abc&limit=10');
    // @ts-expect-error — see above.
    const res = redirectToLogin(req);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain(`next=${encodeURIComponent('/runs?cursor=abc&limit=10')}`);
  });

  it('uses a 3xx status', () => {
    const req = fakeReq('/agents');
    // @ts-expect-error — see above.
    const res = redirectToLogin(req);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  });

  it('does not echo /login or /signup back into next= (defensive)', () => {
    const reqA = fakeReq('/login');
    // @ts-expect-error — see above.
    const resA = redirectToLogin(reqA);
    expect(resA.headers.get('location') ?? '').not.toContain('next=');
    const reqB = fakeReq('/signup');
    // @ts-expect-error — see above.
    const resB = redirectToLogin(reqB);
    expect(resB.headers.get('location') ?? '').not.toContain('next=');
  });
});
