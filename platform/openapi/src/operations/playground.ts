/**
 * Playground operations — multi-model prompt fan-out via SSE.
 */

import { PlaygroundRunRequest } from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, Resp422, Resp422PrivacyTier, SECURITY_BOTH } from './_shared.js';

export function registerPlaygroundOperations(reg: OpenAPIRegistry): void {
  reg.registerTag(
    'Playground',
    'Multi-model prompt fan-out — capability-class + privacy-tier driven.',
  );

  reg.registerPath({
    method: 'post',
    path: '/v1/playground/run',
    summary: 'Fan a prompt out to N models (SSE)',
    description:
      'Accepts a prompt + capability class + privacy tier. The router selects models that match the capability/tier, and the response streams interleaved frames per model. LLM-agnostic — no provider strings on the request.',
    tags: ['Playground'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: PlaygroundRunRequest } },
    },
    responses: {
      '200': {
        description: 'SSE stream of interleaved playground frames (one event per chunk).',
        content: { 'text/event-stream': { schema: { type: 'string' } } },
      },
      '401': Resp401(),
      '422': Resp422PrivacyTier(),
    },
  });
}
