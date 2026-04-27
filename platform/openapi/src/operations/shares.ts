/**
 * Share-link operations — public, password-gated read-only handles
 * for runs / sweeps / agents.
 */

import {
  CreateShareLinkRequest,
  CreateShareLinkResponse,
  ListShareLinksResponse,
  PublicShareLockedResponse,
  PublicShareResponse,
  ShareLink,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, Resp404, Resp422, SECURITY_BOTH, jsonResponse, pathParam } from './_shared.js';

export function registerShareOperations(reg: OpenAPIRegistry): void {
  reg.registerTag('Shares', 'Public, password-gated read-only handles for runs / sweeps / agents.');

  reg.registerPath({
    method: 'get',
    path: '/v1/shares',
    summary: 'List share links',
    description: 'Lists all share links the caller can manage.',
    tags: ['Shares'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Share-link list.', ListShareLinksResponse),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/shares',
    summary: 'Create a share link',
    description: 'Mints a public read-only handle. Optional password gating + expiry.',
    tags: ['Shares'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: CreateShareLinkRequest } },
    },
    responses: {
      '200': jsonResponse('Created.', CreateShareLinkResponse),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/shares/{id}/revoke',
    summary: 'Revoke a share link',
    description: 'Marks the share link revoked; subsequent reads return 404.',
    tags: ['Shares'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Share id.', '<share-id>')],
    responses: {
      '200': jsonResponse('Revoked.', ShareLink),
      '401': Resp401(),
      '404': Resp404('Share'),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/shares/{id}',
    summary: 'Delete a share link',
    description: 'Hard-delete; idempotent.',
    tags: ['Shares'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Share id.', '<share-id>')],
    responses: { '204': { description: 'Deleted.' }, '401': Resp401() },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/public/share/{slug}',
    summary: 'Resolve a public share slug',
    description:
      'Public route — no auth. Returns the shared resource if the slug is live (and the password supplied via `?password=` matches when one is set). Returns the locked envelope when a password is required but missing/wrong.',
    tags: ['Shares'],
    security: [],
    parameters: [pathParam('slug', 'Public share slug.', '<share-slug>')],
    responses: {
      '200': {
        description: 'Public share resolved.',
        content: {
          'application/json': {
            schema: {
              oneOf: [
                { $ref: '#/components/schemas/PublicShareResponse' },
                { $ref: '#/components/schemas/PublicShareLockedResponse' },
              ],
            },
            example: { ok: false, locked: true },
          },
        },
      },
      '404': Resp404('Share'),
    },
  });
}
