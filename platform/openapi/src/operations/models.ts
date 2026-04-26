/**
 * Models operations — list available models, savings analysis.
 *
 * LLM-agnostic: model + provider strings are opaque to the client. The
 * spec does NOT enumerate provider names.
 */

import { ListModelsResponse, SavingsResponse } from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, SECURITY_BOTH, jsonResponse, queryParam } from './_shared.js';

export function registerModelOperations(reg: OpenAPIRegistry): void {
  reg.registerTag(
    'Models',
    'Live model catalog (frontier + local discovery) + savings analytics. LLM-agnostic — provider strings are opaque.',
  );

  reg.registerPath({
    method: 'get',
    path: '/v1/models',
    summary: 'List available models',
    description:
      'Returns the merged model catalog: cloud models from the registry + locally-running models discovered on the request host (Ollama, llama.cpp, vLLM, MLX, TGI). Each entry includes capability classes, context window, pricing, and a privacy-tier compatibility flag.',
    tags: ['Models'],
    security: SECURITY_BOTH,
    responses: { '200': jsonResponse('Model catalog.', ListModelsResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/models/savings',
    summary: 'Estimated savings analysis',
    description:
      'Compares actual run cost to the cheapest router-eligible alternative model for the same capability class. Aggregated by period.',
    tags: ['Models'],
    security: SECURITY_BOTH,
    parameters: [
      queryParam('period', 'One of `day`, `week`, `month`, `quarter`.', { type: 'string' }),
    ],
    responses: { '200': jsonResponse('Savings rollup.', SavingsResponse), '401': Resp401() },
  });
}
