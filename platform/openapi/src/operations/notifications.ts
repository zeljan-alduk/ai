/**
 * Notification operations + the cross-resource activity feed + the
 * SSE live-tail.
 */

import {
  ListActivityResponse,
  ListNotificationsResponse,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, Resp404, SECURITY_BOTH, jsonResponse, pathParam, queryParam } from './_shared.js';

export function registerNotificationOperations(reg: OpenAPIRegistry): void {
  reg.registerTag('Notifications', 'Per-user notification inbox + activity feed + SSE live-tail.');

  reg.registerPath({
    method: 'get',
    path: '/v1/notifications',
    summary: 'List notifications for the current user',
    description: 'Cursor-paginated. Filter by `read` state.',
    tags: ['Notifications'],
    security: SECURITY_BOTH,
    parameters: [
      queryParam('read', 'When `true`, only read; when `false`, only unread.', { type: 'boolean' }),
    ],
    responses: {
      '200': jsonResponse('Notifications page.', ListNotificationsResponse),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/notifications/{id}/mark-read',
    summary: 'Mark a notification read',
    description: 'Idempotent.',
    tags: ['Notifications'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Notification id.', '<notification-id>')],
    responses: {
      '200': jsonResponse('Marked read.', MarkNotificationReadResponse),
      '401': Resp401(),
      '404': Resp404('Notification'),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/notifications/mark-all-read',
    summary: 'Mark all notifications read',
    description: 'Bulk operation; returns the count affected.',
    tags: ['Notifications'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Marked all.', MarkAllNotificationsReadResponse),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/activity',
    summary: 'Activity feed',
    description:
      'Cross-resource activity events (annotation posted, run completed, alert fired, …).',
    tags: ['Notifications'],
    security: SECURITY_BOTH,
    responses: { '200': jsonResponse('Activity page.', ListActivityResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/sse/events',
    summary: 'SSE live-tail of activity events',
    description: 'Server-sent event stream of new activity for the caller. One frame per event.',
    tags: ['Notifications'],
    security: SECURITY_BOTH,
    responses: {
      '200': {
        description: 'SSE stream.',
        content: { 'text/event-stream': { schema: { type: 'string' } } },
      },
      '401': Resp401(),
    },
  });
}
