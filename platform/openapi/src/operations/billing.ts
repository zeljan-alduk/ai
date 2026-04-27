/**
 * Billing operations — Stripe-backed subscription management. Some
 * routes are placeholder-friendly: when STRIPE_* env vars are unset
 * the API returns 503 `not_configured` instead of 500.
 */

import {
  BillingUsageResponse,
  CheckoutRequest,
  CheckoutResponse,
  GetSubscriptionResponse,
  PortalRequest,
  PortalResponse,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import {
  Resp401,
  Resp422,
  SECURITY_BOTH,
  errorResponse,
  jsonResponse,
  queryParam,
} from './_shared.js';

export function registerBillingOperations(reg: OpenAPIRegistry): void {
  reg.registerTag('Billing', 'Stripe subscriptions, checkout, customer portal, usage rollups.');

  const Resp503NotConfigured = errorResponse(
    'Billing is not wired up in this deploy (STRIPE_* env vars unset).',
    'not_configured',
    'billing not configured',
  );

  reg.registerPath({
    method: 'get',
    path: '/v1/billing/subscription',
    summary: 'Fetch the current tenant subscription',
    description:
      'Returns the subscription status (trial, active, past-due, etc.) and the trial end date.',
    tags: ['Billing'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Subscription detail.', GetSubscriptionResponse),
      '401': Resp401(),
      '503': Resp503NotConfigured,
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/billing/usage',
    summary: 'Per-period usage rollup',
    description: 'Aggregates usage by day, model, and agent for the requested period.',
    tags: ['Billing'],
    security: SECURITY_BOTH,
    parameters: [queryParam('period', 'One of `day`, `week`, `month`, `quarter`.')],
    responses: { '200': jsonResponse('Usage rollup.', BillingUsageResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/billing/checkout',
    summary: 'Start a Stripe Checkout session',
    description: 'Returns a Stripe Checkout URL. The web client redirects to it.',
    tags: ['Billing'],
    security: SECURITY_BOTH,
    request: { required: true, content: { 'application/json': { schema: CheckoutRequest } } },
    responses: {
      '200': jsonResponse('Checkout session created.', CheckoutResponse),
      '401': Resp401(),
      '422': Resp422(),
      '503': Resp503NotConfigured,
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/billing/portal',
    summary: 'Open the Stripe customer portal',
    description:
      'Returns a portal URL for the active subscription. Used for plan + payment-method management.',
    tags: ['Billing'],
    security: SECURITY_BOTH,
    request: { required: true, content: { 'application/json': { schema: PortalRequest } } },
    responses: {
      '200': jsonResponse('Portal URL.', PortalResponse),
      '401': Resp401(),
      '503': Resp503NotConfigured,
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/billing/webhook',
    summary: 'Stripe webhook receiver',
    description:
      'Public route — auth is by the Stripe-Signature HMAC header, not the bearer token. The handler verifies the signature against the raw body BEFORE touching state.',
    tags: ['Billing'],
    security: [],
    request: {
      required: true,
      content: {
        'application/json': { schema: { type: 'object', additionalProperties: true } },
      },
      description: 'Stripe event envelope.',
    },
    responses: {
      '200': jsonResponse('Event accepted.', {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
      }),
      '400': errorResponse('Bad signature or replay.', 'http_error', 'invalid signature'),
      '503': Resp503NotConfigured,
    },
  });
}
