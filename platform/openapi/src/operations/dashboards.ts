/**
 * Dashboard operations — list, create, update, delete + materialise
 * widget data.
 */

import {
  CreateDashboardRequest,
  Dashboard,
  DashboardDataPayload,
  ListDashboardsResponse,
  UpdateDashboardRequest,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, Resp404, Resp422, SECURITY_BOTH, jsonResponse, pathParam } from './_shared.js';

export function registerDashboardOperations(reg: OpenAPIRegistry): void {
  reg.registerTag('Dashboards', 'Custom dashboards: KPI cards, time-series, heatmaps, pies, bars.');

  reg.registerPath({
    method: 'get',
    path: '/v1/dashboards',
    summary: 'List dashboards',
    description: 'Returns every dashboard the caller can read.',
    tags: ['Dashboards'],
    security: SECURITY_BOTH,
    responses: { '200': jsonResponse('Dashboard list.', ListDashboardsResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/dashboards',
    summary: 'Create a dashboard',
    description: 'Creates a new dashboard with widgets + layout.',
    tags: ['Dashboards'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: CreateDashboardRequest } },
    },
    responses: {
      '200': jsonResponse('Created.', Dashboard),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/dashboards/{id}',
    summary: 'Fetch a dashboard',
    description: 'Returns the dashboard spec.',
    tags: ['Dashboards'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Dashboard id.', '<dashboard-id>')],
    responses: {
      '200': jsonResponse('Dashboard.', Dashboard),
      '401': Resp401(),
      '404': Resp404('Dashboard'),
    },
  });

  reg.registerPath({
    method: 'patch',
    path: '/v1/dashboards/{id}',
    summary: 'Update a dashboard',
    description: 'Partial update of dashboard metadata, widgets, or layout.',
    tags: ['Dashboards'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Dashboard id.', '<dashboard-id>')],
    request: {
      required: true,
      content: { 'application/json': { schema: UpdateDashboardRequest } },
    },
    responses: {
      '200': jsonResponse('Updated.', Dashboard),
      '401': Resp401(),
      '404': Resp404('Dashboard'),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/dashboards/{id}',
    summary: 'Delete a dashboard',
    description: 'Hard-deletes the dashboard. Idempotent.',
    tags: ['Dashboards'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Dashboard id.', '<dashboard-id>')],
    responses: { '204': { description: 'Deleted.' }, '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/dashboards/{id}/data',
    summary: 'Materialise widget data',
    description: "Runs the dashboard's widget queries and returns a per-widget data payload.",
    tags: ['Dashboards'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Dashboard id.', '<dashboard-id>')],
    responses: {
      '200': jsonResponse('Widget data payload.', DashboardDataPayload),
      '401': Resp401(),
      '404': Resp404('Dashboard'),
    },
  });
}
