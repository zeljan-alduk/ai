/**
 * Annotation operations — threaded comments + reactions, plus the
 * activity feed wrapper for org-wide visibility.
 */

import {
  Annotation,
  AnnotationFeedResponse,
  CreateAnnotationRequest,
  ListAnnotationsResponse,
  ToggleReactionRequest,
  ToggleReactionResponse,
  UpdateAnnotationRequest,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, Resp404, Resp422, SECURITY_BOTH, jsonResponse, pathParam } from './_shared.js';

export function registerAnnotationOperations(reg: OpenAPIRegistry): void {
  reg.registerTag('Annotations', 'Threaded comments + reactions on runs, sweeps, and agents.');

  reg.registerPath({
    method: 'get',
    path: '/v1/annotations',
    summary: 'List annotations',
    description:
      'Lists annotations for a target (run, sweep, agent). Filter by `targetKind` + `targetId`.',
    tags: ['Annotations'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Annotation list.', ListAnnotationsResponse),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/annotations',
    summary: 'Create an annotation',
    description: 'Posts a new annotation (top-level or reply via `parentId`).',
    tags: ['Annotations'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: CreateAnnotationRequest } },
    },
    responses: { '200': jsonResponse('Created.', Annotation), '401': Resp401(), '422': Resp422() },
  });

  reg.registerPath({
    method: 'patch',
    path: '/v1/annotations/{id}',
    summary: 'Edit an annotation',
    description: 'Edits the body of an annotation. Author-only.',
    tags: ['Annotations'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Annotation id.', '<annotation-id>')],
    request: {
      required: true,
      content: { 'application/json': { schema: UpdateAnnotationRequest } },
    },
    responses: {
      '200': jsonResponse('Updated.', Annotation),
      '401': Resp401(),
      '404': Resp404('Annotation'),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/annotations/{id}',
    summary: 'Delete an annotation',
    description: 'Soft-deletes the annotation.',
    tags: ['Annotations'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Annotation id.', '<annotation-id>')],
    responses: { '204': { description: 'Deleted.' }, '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/annotations/{id}/reactions',
    summary: 'Toggle a reaction on an annotation',
    description: 'Adds or removes a reaction (👍 / 👀 / ❤️ / 🚀) by the caller.',
    tags: ['Annotations'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Annotation id.', '<annotation-id>')],
    request: {
      required: true,
      content: { 'application/json': { schema: ToggleReactionRequest } },
    },
    responses: {
      '200': jsonResponse('Reaction toggled.', ToggleReactionResponse),
      '401': Resp401(),
      '404': Resp404('Annotation'),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/annotations/feed',
    summary: 'Recent annotations across the org',
    description: 'Cross-resource feed of recent annotations, used by the activity surface.',
    tags: ['Annotations'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Annotation feed.', AnnotationFeedResponse),
      '401': Resp401(),
    },
  });
}
