/**
 * Health probe — public, fast, no DB ping.
 */

import type { OpenAPIRegistry } from '../registry.js';

export function registerHealthOperations(reg: OpenAPIRegistry): void {
  reg.registerTag('Health', 'Liveness probe.');

  reg.registerPath({
    method: 'get',
    path: '/health',
    summary: 'Liveness probe',
    description: 'Returns `{ ok: true, version }`. Public — no auth.',
    tags: ['Health'],
    security: [],
    responses: {
      '200': {
        description: 'Process is alive.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                version: { type: 'string' },
              },
              required: ['ok', 'version'],
            },
            example: { ok: true, version: '0.0.0' },
          },
        },
      },
    },
  });
}
