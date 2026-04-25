/**
 * Config-loader tests.
 *
 * `loadBillingConfig` should be `{ configured: true }` only when ALL
 * five env vars are non-empty strings, otherwise `{ configured: false }`
 * with a per-key boolean breakdown for boot logging.
 */

import { describe, expect, it } from 'vitest';
import { describeBillingConfig, loadBillingConfig } from '../src/index.js';

describe('loadBillingConfig', () => {
  it('returns not_configured on a fully empty env', () => {
    const cfg = loadBillingConfig({});
    expect(cfg.configured).toBe(false);
    if (!cfg.configured) {
      expect(cfg.present.stripeSecretKey).toBe(false);
      expect(cfg.present.priceSolo).toBe(false);
      expect(cfg.present.priceTeam).toBe(false);
      expect(cfg.present.webhookSigningSecret).toBe(false);
      expect(cfg.present.portalReturnUrl).toBe(false);
    }
  });

  it('treats empty-string env values as unset', () => {
    const cfg = loadBillingConfig({
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SIGNING_SECRET: '',
      STRIPE_PRICE_SOLO: '',
      STRIPE_PRICE_TEAM: '',
      STRIPE_BILLING_PORTAL_RETURN_URL: '',
    });
    expect(cfg.configured).toBe(false);
  });

  it('treats whitespace-only env values as unset', () => {
    const cfg = loadBillingConfig({
      STRIPE_SECRET_KEY: '   ',
      STRIPE_WEBHOOK_SIGNING_SECRET: 'whsec_x',
      STRIPE_PRICE_SOLO: 'price_a',
      STRIPE_PRICE_TEAM: 'price_b',
      STRIPE_BILLING_PORTAL_RETURN_URL: 'https://example.com',
    });
    expect(cfg.configured).toBe(false);
  });

  it('returns not_configured if any single var is missing', () => {
    const partial = loadBillingConfig({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SIGNING_SECRET: 'whsec_x',
      STRIPE_PRICE_SOLO: 'price_a',
      // STRIPE_PRICE_TEAM intentionally missing
      STRIPE_BILLING_PORTAL_RETURN_URL: 'https://example.com',
    });
    expect(partial.configured).toBe(false);
    if (!partial.configured) {
      expect(partial.present.priceTeam).toBe(false);
      expect(partial.present.priceSolo).toBe(true);
    }
  });

  it('returns configured:true when all five env vars are populated', () => {
    const cfg = loadBillingConfig({
      STRIPE_SECRET_KEY: 'sk_test_abc',
      STRIPE_WEBHOOK_SIGNING_SECRET: 'whsec_abc',
      STRIPE_PRICE_SOLO: 'price_solo',
      STRIPE_PRICE_TEAM: 'price_team',
      STRIPE_BILLING_PORTAL_RETURN_URL: 'https://app.example.com/billing',
    });
    expect(cfg.configured).toBe(true);
    if (cfg.configured) {
      expect(cfg.stripeSecretKey).toBe('sk_test_abc');
      expect(cfg.webhookSigningSecret).toBe('whsec_abc');
      expect(cfg.prices.solo).toBe('price_solo');
      expect(cfg.prices.team).toBe('price_team');
      expect(cfg.portalReturnUrl).toBe('https://app.example.com/billing');
    }
  });

  it('describes a configured deploy without leaking values', () => {
    const cfg = loadBillingConfig({
      STRIPE_SECRET_KEY: 'sk_test_supersecret',
      STRIPE_WEBHOOK_SIGNING_SECRET: 'whsec_supersecret',
      STRIPE_PRICE_SOLO: 'price_solo',
      STRIPE_PRICE_TEAM: 'price_team',
      STRIPE_BILLING_PORTAL_RETURN_URL: 'https://app.example.com',
    });
    const desc = describeBillingConfig(cfg);
    expect(desc).toContain('configured: yes');
    expect(desc).not.toContain('supersecret');
  });

  it('describes a partial deploy listing which prices are set', () => {
    const cfg = loadBillingConfig({
      STRIPE_PRICE_SOLO: 'price_solo',
    });
    const desc = describeBillingConfig(cfg);
    expect(desc).toContain('configured: no');
    expect(desc).toContain('solo=set');
    expect(desc).toContain('team=unset');
  });
});
