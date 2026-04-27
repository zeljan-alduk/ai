/**
 * Helpers shared across the per-resource `registerXxxOperations` files.
 *
 * Three goals:
 *   1. Keep operation files focused on their resource — no boilerplate
 *      for "what does a 401 look like" repeated 50 times.
 *   2. Make the wire-format error envelope a single source of truth:
 *      every error response references `ApiError` from the components
 *      store.
 *   3. Surface privacy-tier behaviour as response examples so an
 *      integrator skimming the spec sees the platform contract before
 *      they reach the prose docs (CLAUDE.md non-negotiable #3).
 */

import { ApiError } from '@aldo-ai/api-contract';
import type { OpenAPIRegistry, ParameterSpec, ResponseSpec } from '../registry.js';

/** Response: `200` JSON pointing at a registered schema. */
export function jsonResponse(
  description: string,
  schema: Parameters<OpenAPIRegistry['resolveSchema']>[0],
  example?: unknown,
): ResponseSpec {
  return {
    description,
    content: {
      'application/json': example !== undefined ? { schema, example } : { schema },
    },
  };
}

/**
 * Standard 4xx/5xx envelopes. Reused everywhere; the spec gets a single
 * `ApiError` ref and every error code carries a representative example.
 */
export function errorResponse(description: string, code: string, message: string): ResponseSpec {
  return {
    description,
    content: {
      'application/json': {
        schema: ApiError,
        example: { error: { code, message } },
      },
    },
  };
}

/** Standard 401. Used on every authenticated route. */
export const Resp401 = (): ResponseSpec =>
  errorResponse('Authentication required.', 'unauthenticated', 'authentication required');

/** Standard 403. */
export const Resp403 = (): ResponseSpec =>
  errorResponse(
    'The caller is authenticated but cannot reach the resource.',
    'forbidden',
    'forbidden',
  );

/** Standard 404. */
export const Resp404 = (resource: string): ResponseSpec =>
  errorResponse(`${resource} not found.`, 'not_found', `${resource.toLowerCase()} not found`);

/** Standard 422 validation error. */
export const Resp422 = (): ResponseSpec =>
  errorResponse(
    'Request validation failed (Zod schema mismatch).',
    'validation_error',
    'invalid request body',
  );

/** Standard privacy-tier 422 — tier the agent declared cannot be routed. */
export const Resp422PrivacyTier = (): ResponseSpec => ({
  description: "Run cannot be routed under the agent's privacy tier (CLAUDE.md non-negotiable #3).",
  content: {
    'application/json': {
      schema: ApiError,
      example: {
        error: {
          code: 'privacy_tier_unroutable',
          message: 'no eligible model for sensitive privacy tier',
          details: {
            agentName: '<agent-name>',
            privacyTier: 'sensitive',
            requiredCapability: 'reasoning',
            attempted: ['ollama:llama-3.3', 'mlx:phi-4'],
          },
        },
      },
    },
  },
});

/** Standard 402 — billing trial expired or payment required. */
export const Resp402 = (): ResponseSpec =>
  errorResponse(
    'Billing trial expired or no active subscription.',
    'trial_expired',
    'trial expired',
  );

/** Path parameter — required, string. */
export function pathParam(name: string, description: string, example?: string): ParameterSpec {
  return {
    name,
    in: 'path',
    required: true,
    description,
    schema: { type: 'string' },
    ...(example !== undefined ? { example } : {}),
  };
}

/** Query parameter — optional, string by default. */
export function queryParam(
  name: string,
  description: string,
  schema: ParameterSpec['schema'] = { type: 'string' },
  required = false,
): ParameterSpec {
  return { name, in: 'query', required, description, schema };
}

export const SECURITY_BEARER = [{ BearerAuth: [] as string[] }];
export const SECURITY_API_KEY = [{ ApiKeyAuth: [] as string[] }];
export const SECURITY_BOTH = [{ BearerAuth: [] as string[] }, { ApiKeyAuth: [] as string[] }];
