/**
 * Observability operations — aggregated time-series, KPI, and trace
 * summaries for the observability surface.
 */

import { ObservabilityQuery, ObservabilitySummary } from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, SECURITY_BOTH, jsonResponse, queryParam } from './_shared.js';

export function registerObservabilityOperations(reg: OpenAPIRegistry): void {
  reg.registerTag('Observability', 'Aggregated metrics + traces for the observability surface.');

  reg.registerPath({
    method: 'get',
    path: '/v1/observability/summary',
    summary: 'Aggregate observability summary',
    description:
      'Returns KPI cards + time-series for runs, costs, latency, and error rate over the requested period.',
    tags: ['Observability'],
    security: SECURITY_BOTH,
    parameters: [queryParam('period', 'One of `day`, `week`, `month`, `quarter`.')],
    responses: {
      '200': jsonResponse('Summary payload.', ObservabilitySummary),
      '401': Resp401(),
    },
  });
}
