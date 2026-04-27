/**
 * Alert operations — alert rules + their event log.
 */

import {
  AlertRule,
  CreateAlertRuleRequest,
  ListAlertEventsResponse,
  ListAlertRulesResponse,
  SilenceAlertResponse,
  TestAlertResponse,
  UpdateAlertRuleRequest,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, Resp404, Resp422, SECURITY_BOTH, jsonResponse, pathParam } from './_shared.js';

export function registerAlertOperations(reg: OpenAPIRegistry): void {
  reg.registerTag('Alerts', 'Alert rules + event log + manual silencing/test.');

  reg.registerPath({
    method: 'get',
    path: '/v1/alerts',
    summary: 'List alert rules',
    description: 'Returns every alert rule for the tenant.',
    tags: ['Alerts'],
    security: SECURITY_BOTH,
    responses: { '200': jsonResponse('Alert rules.', ListAlertRulesResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/alerts',
    summary: 'Create an alert rule',
    description: 'Creates a new alert rule (with thresholds + targets).',
    tags: ['Alerts'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: CreateAlertRuleRequest } },
    },
    responses: { '200': jsonResponse('Created.', AlertRule), '401': Resp401(), '422': Resp422() },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/alerts/{id}',
    summary: 'Fetch one alert rule',
    description: 'Returns the alert rule by id.',
    tags: ['Alerts'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Alert rule id.', '<alert-id>')],
    responses: {
      '200': jsonResponse('Alert rule.', AlertRule),
      '401': Resp401(),
      '404': Resp404('Alert'),
    },
  });

  reg.registerPath({
    method: 'patch',
    path: '/v1/alerts/{id}',
    summary: 'Update an alert rule',
    description: 'Partial update of an alert rule.',
    tags: ['Alerts'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Alert rule id.', '<alert-id>')],
    request: {
      required: true,
      content: { 'application/json': { schema: UpdateAlertRuleRequest } },
    },
    responses: {
      '200': jsonResponse('Updated.', AlertRule),
      '401': Resp401(),
      '404': Resp404('Alert'),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/alerts/{id}',
    summary: 'Delete an alert rule',
    description: 'Hard-deletes the rule.',
    tags: ['Alerts'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Alert rule id.', '<alert-id>')],
    responses: { '204': { description: 'Deleted.' }, '401': Resp401() },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/alerts/{id}/events',
    summary: 'List events for an alert rule',
    description: 'Returns the recent firing/clearing events for the rule.',
    tags: ['Alerts'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Alert rule id.', '<alert-id>')],
    responses: {
      '200': jsonResponse('Event list.', ListAlertEventsResponse),
      '401': Resp401(),
      '404': Resp404('Alert'),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/alerts/{id}/silence',
    summary: 'Silence an alert rule',
    description: 'Suppresses firings for the configured silence window.',
    tags: ['Alerts'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Alert rule id.', '<alert-id>')],
    responses: {
      '200': jsonResponse('Silenced.', SilenceAlertResponse),
      '401': Resp401(),
      '404': Resp404('Alert'),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/alerts/{id}/test',
    summary: 'Trigger a test fire',
    description: "Sends a synthetic event through the rule's targets to verify wiring.",
    tags: ['Alerts'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Alert rule id.', '<alert-id>')],
    responses: {
      '200': jsonResponse('Test fired.', TestAlertResponse),
      '401': Resp401(),
      '404': Resp404('Alert'),
    },
  });
}
