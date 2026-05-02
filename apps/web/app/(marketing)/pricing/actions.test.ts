/**
 * Unit tests for the `/pricing` server actions.
 *
 * Two branches matter:
 *
 *   1. Unauthenticated visitor → `redirect('/signup?plan=…&next=…')`.
 *   2. Authenticated visitor → `createCheckoutSession()` then
 *      `redirect(<stripe url>)`.
 *
 * Both branches end in a Next-thrown `redirect()` exception, so we
 * mock `next/navigation` with a sentinel error and assert on the URL
 * passed in.
 *
 * `not_configured` (HTTP 503 from the API) bounces back to /pricing
 * with a banner notice — also asserted.
 */

import { ApiClientError } from '@/lib/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class RedirectError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.url = url;
    this.name = 'RedirectError';
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

const sessionMock = vi.fn(async () => null as { token: string } | null);
vi.mock('@/lib/session', () => ({
  getSession: () => sessionMock(),
}));

interface CheckoutInput {
  readonly plan: string;
  readonly returnTo?: string;
}
const createCheckoutMock = vi.fn(async (_arg: CheckoutInput) => ({
  url: 'https://checkout.stripe.com/c/pay/cs_x',
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    createCheckoutSession: (arg: CheckoutInput) => createCheckoutMock(arg),
  };
});

vi.mock('@/lib/api-server-init', () => ({}));

beforeEach(() => {
  sessionMock.mockReset();
  createCheckoutMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startCheckoutAction — unauthenticated', () => {
  it('redirects to /signup with the plan + a next= back to /billing/checkout', async () => {
    sessionMock.mockResolvedValueOnce(null);
    const { startCheckoutAction } = await import('./actions.js');
    const fd = new FormData();
    fd.set('plan', 'team');
    let caught: RedirectError | null = null;
    try {
      await startCheckoutAction(fd);
    } catch (err) {
      caught = err as RedirectError;
    }
    expect(caught).toBeInstanceOf(RedirectError);
    expect(caught?.url).toContain('/signup?plan=team');
    expect(caught?.url).toContain(`next=${encodeURIComponent('/billing/checkout?plan=team')}`);
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it('falls back to plan=solo when the form payload is missing or invalid', async () => {
    sessionMock.mockResolvedValueOnce(null);
    const { startCheckoutAction } = await import('./actions.js');
    const fd = new FormData();
    // No `plan` field.
    let caught: RedirectError | null = null;
    try {
      await startCheckoutAction(fd);
    } catch (err) {
      caught = err as RedirectError;
    }
    expect(caught?.url).toContain('/signup?plan=solo');
  });

  it('rejects an unexpected plan value and falls back to solo', async () => {
    sessionMock.mockResolvedValueOnce(null);
    const { startCheckoutAction } = await import('./actions.js');
    const fd = new FormData();
    fd.set('plan', 'enterprise'); // not a checkout plan
    let caught: RedirectError | null = null;
    try {
      await startCheckoutAction(fd);
    } catch (err) {
      caught = err as RedirectError;
    }
    expect(caught?.url).toContain('/signup?plan=solo');
  });
});

describe('startCheckoutAction — authenticated', () => {
  it('mints a Stripe URL and redirects to it', async () => {
    sessionMock.mockResolvedValueOnce({ token: 'jwt-x' });
    createCheckoutMock.mockResolvedValueOnce({
      url: 'https://checkout.stripe.com/c/pay/cs_test_q',
    });
    const { startCheckoutAction } = await import('./actions.js');
    const fd = new FormData();
    fd.set('plan', 'solo');
    let caught: RedirectError | null = null;
    try {
      await startCheckoutAction(fd);
    } catch (err) {
      caught = err as RedirectError;
    }
    expect(createCheckoutMock).toHaveBeenCalledOnce();
    const calls = createCheckoutMock.mock.calls;
    const arg = calls[0]?.[0];
    expect(arg?.plan).toBe('solo');
    expect(arg?.returnTo).toContain('/billing/success');
    expect(arg?.returnTo).toContain('{CHECKOUT_SESSION_ID}');
    expect(caught?.url).toBe('https://checkout.stripe.com/c/pay/cs_test_q');
  });

  it('redirects to /pricing?notice=not_configured when API surfaces 503', async () => {
    sessionMock.mockResolvedValueOnce({ token: 'jwt-x' });
    createCheckoutMock.mockRejectedValueOnce(
      new ApiClientError('http_5xx', 'billing not configured', {
        status: 503,
        code: 'not_configured',
      }),
    );
    const { startCheckoutAction } = await import('./actions.js');
    const fd = new FormData();
    fd.set('plan', 'team');
    let caught: RedirectError | null = null;
    try {
      await startCheckoutAction(fd);
    } catch (err) {
      caught = err as RedirectError;
    }
    expect(caught?.url).toBe('/pricing?notice=not_configured');
  });

  it('rethrows non-not_configured ApiClientErrors so the error boundary handles them', async () => {
    sessionMock.mockResolvedValueOnce({ token: 'jwt-x' });
    const boom = new ApiClientError('http_5xx', 'stripe blew up', { status: 502 });
    createCheckoutMock.mockRejectedValueOnce(boom);
    const { startCheckoutAction } = await import('./actions.js');
    const fd = new FormData();
    fd.set('plan', 'solo');
    await expect(startCheckoutAction(fd)).rejects.toBe(boom);
  });
});
