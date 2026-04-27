/**
 * Wave-14 web client helpers for dashboards + alerts.
 *
 * Lives in its own module to keep the additive surface easy to review;
 * everything goes through the same `request<T>()` helper as `api.ts`.
 *
 * LLM-agnostic: provider strings are opaque on the wire.
 */

import type {
  AlertRule,
  CreateAlertRuleRequest,
  CreateDashboardRequest,
  Dashboard,
  DashboardWidget,
  ListAlertEventsResponse,
  ListAlertRulesResponse,
  ListDashboardsResponse,
  SilenceAlertResponse,
  TestAlertResponse,
  UpdateAlertRuleRequest,
  UpdateDashboardRequest,
} from '@aldo-ai/api-contract';
import {
  AlertRule as AlertRuleSchema,
  Dashboard as DashboardSchema,
  ListAlertEventsResponse as ListAlertEventsResponseSchema,
  ListAlertRulesResponse as ListAlertRulesResponseSchema,
  ListDashboardsResponse as ListDashboardsResponseSchema,
  SilenceAlertResponse as SilenceAlertResponseSchema,
  TestAlertResponse as TestAlertResponseSchema,
} from '@aldo-ai/api-contract';
import { AUTH_PROXY_PREFIX, ApiClientError, buildRequestHeaders } from './api.js';

function buildUrl(path: string): string {
  if (typeof window === 'undefined') {
    const base = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
    return `${base}${path}`;
  }
  return `${AUTH_PROXY_PREFIX}${path}`;
}

async function jsonRequest<T>(
  path: string,
  schema: { parse: (v: unknown) => T; safeParse: (v: unknown) => { success: boolean } },
  init: RequestInit = {},
): Promise<T> {
  const headers = await buildRequestHeaders(init.headers);
  const url = buildUrl(path);
  const res = await fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
    credentials: typeof window === 'undefined' ? 'omit' : 'include',
  });
  const text = await res.text();
  let json: unknown = undefined;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new ApiClientError('parse', `Invalid JSON from ${url}`, {
        status: res.status,
        cause: err,
      });
    }
  }
  if (!res.ok) {
    throw new ApiClientError(res.status >= 500 ? 'http_5xx' : 'http_4xx', `HTTP ${res.status}`, {
      status: res.status,
      details: json,
    });
  }
  return schema.parse(json);
}

// --------------------------------------------------------------------------
// Dashboards
// --------------------------------------------------------------------------

export function listDashboards(): Promise<ListDashboardsResponse> {
  return jsonRequest('/v1/dashboards', ListDashboardsResponseSchema);
}

export function getDashboard(id: string): Promise<Dashboard> {
  return jsonRequest(`/v1/dashboards/${encodeURIComponent(id)}`, DashboardSchema);
}

export function createDashboard(req: CreateDashboardRequest): Promise<Dashboard> {
  return jsonRequest('/v1/dashboards', DashboardSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function updateDashboard(id: string, req: UpdateDashboardRequest): Promise<Dashboard> {
  return jsonRequest(`/v1/dashboards/${encodeURIComponent(id)}`, DashboardSchema, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function deleteDashboard(id: string): Promise<void> {
  const url = buildUrl(`/v1/dashboards/${encodeURIComponent(id)}`);
  const headers = await buildRequestHeaders(undefined);
  const res = await fetch(url, {
    method: 'DELETE',
    headers,
    cache: 'no-store',
    credentials: typeof window === 'undefined' ? 'omit' : 'include',
  });
  if (res.status === 204) return;
  if (!res.ok) {
    throw new ApiClientError(res.status >= 500 ? 'http_5xx' : 'http_4xx', `HTTP ${res.status}`);
  }
}

export function getDashboardData(
  id: string,
  layout?: ReadonlyArray<DashboardWidget>,
): Promise<{ widgets: Record<string, unknown> }> {
  return jsonRequest<{ widgets: Record<string, unknown> }>(
    `/v1/dashboards/${encodeURIComponent(id)}/data`,
    {
      parse: (v: unknown) => v as { widgets: Record<string, unknown> },
      safeParse: (v: unknown) => ({ success: typeof v === 'object' && v !== null }),
    },
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(layout !== undefined ? { layout } : {}),
    },
  );
}

// --------------------------------------------------------------------------
// Alert rules
// --------------------------------------------------------------------------

export function listAlertRules(): Promise<ListAlertRulesResponse> {
  return jsonRequest('/v1/alerts', ListAlertRulesResponseSchema);
}

export function createAlertRule(req: CreateAlertRuleRequest): Promise<AlertRule> {
  return jsonRequest('/v1/alerts', AlertRuleSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function updateAlertRule(id: string, req: UpdateAlertRuleRequest): Promise<AlertRule> {
  return jsonRequest(`/v1/alerts/${encodeURIComponent(id)}`, AlertRuleSchema, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function deleteAlertRule(id: string): Promise<void> {
  const url = buildUrl(`/v1/alerts/${encodeURIComponent(id)}`);
  const headers = await buildRequestHeaders(undefined);
  const res = await fetch(url, {
    method: 'DELETE',
    headers,
    cache: 'no-store',
    credentials: typeof window === 'undefined' ? 'omit' : 'include',
  });
  if (res.status === 204) return;
  if (!res.ok) {
    throw new ApiClientError(res.status >= 500 ? 'http_5xx' : 'http_4xx', `HTTP ${res.status}`);
  }
}

export function silenceAlertRule(id: string, until: string): Promise<SilenceAlertResponse> {
  const qs = new URLSearchParams({ until }).toString();
  return jsonRequest(
    `/v1/alerts/${encodeURIComponent(id)}/silence?${qs}`,
    SilenceAlertResponseSchema,
    { method: 'POST' },
  );
}

export function testAlertRule(id: string): Promise<TestAlertResponse> {
  return jsonRequest(`/v1/alerts/${encodeURIComponent(id)}/test`, TestAlertResponseSchema, {
    method: 'POST',
  });
}

export function listAlertEvents(id: string): Promise<ListAlertEventsResponse> {
  return jsonRequest(`/v1/alerts/${encodeURIComponent(id)}/events`, ListAlertEventsResponseSchema);
}
