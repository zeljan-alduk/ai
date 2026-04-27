/**
 * Saved-view operations — user-defined preset filters across runs / sweeps / etc.
 */

import {
  CreateSavedViewRequest,
  ListSavedViewsResponse,
  SavedView,
  UpdateSavedViewRequest,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import {
  Resp401,
  Resp404,
  Resp422,
  SECURITY_BOTH,
  jsonResponse,
  pathParam,
  queryParam,
} from './_shared.js';

export function registerViewOperations(reg: OpenAPIRegistry): void {
  reg.registerTag(
    'Saved Views',
    'User-defined preset filters on the runs, sweeps, and dashboards surfaces.',
  );

  reg.registerPath({
    method: 'get',
    path: '/v1/views',
    summary: 'List saved views',
    description: 'Lists saved views for the caller, optionally filtered by `surface`.',
    tags: ['Saved Views'],
    security: SECURITY_BOTH,
    parameters: [queryParam('surface', 'Restrict to one surface (e.g. `runs`).')],
    responses: { '200': jsonResponse('Saved views.', ListSavedViewsResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/views',
    summary: 'Create a saved view',
    description: 'Creates a new saved view.',
    tags: ['Saved Views'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: CreateSavedViewRequest } },
    },
    responses: { '200': jsonResponse('Created.', SavedView), '401': Resp401(), '422': Resp422() },
  });

  reg.registerPath({
    method: 'patch',
    path: '/v1/views/{id}',
    summary: 'Update a saved view',
    description: 'Partial update.',
    tags: ['Saved Views'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'View id.', '<view-id>')],
    request: {
      required: true,
      content: { 'application/json': { schema: UpdateSavedViewRequest } },
    },
    responses: {
      '200': jsonResponse('Updated.', SavedView),
      '401': Resp401(),
      '404': Resp404('View'),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/views/{id}',
    summary: 'Delete a saved view',
    description: 'Hard-delete; idempotent.',
    tags: ['Saved Views'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'View id.', '<view-id>')],
    responses: { '204': { description: 'Deleted.' }, '401': Resp401() },
  });
}
