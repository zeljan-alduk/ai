/**
 * Typed fetch client for the ALDO AI control-plane API.
 *
 * Every response is parsed through the corresponding @aldo-ai/api-contract
 * Zod schema — never trust the wire. On parse failure or non-2xx status we
 * throw a typed `ApiClientError` that the page-level error boundary turns
 * into a clean error UI (never a stack trace).
 *
 * LLM-agnostic: this module never references a specific provider name.
 * Provider strings come back from the server as opaque values and are
 * displayed as-is.
 */

import {
  ApiError,
  AuthMeResponse,
  AuthSessionResponse,
  type BillingUsagePeriod,
  BillingUsageResponse,
  type BulkRunActionRequest,
  BulkRunActionResponse,
  CheckAgentResponse,
  type CheckoutRequest,
  CheckoutResponse,
  type CreateSavedViewRequest,
  DesignPartnerApplication,
  GetAgentResponse,
  GetRunResponse,
  GetRunTreeResponse,
  GetSubscriptionResponse,
  ListActivityResponse,
  type ListAgentsQuery,
  ListAgentsResponse,
  ListDesignPartnerApplicationsResponse,
  ListModelsResponse,
  ListNotificationsResponse,
  type ListRunsQuery,
  ListRunsResponse,
  ListSavedViewsResponse,
  ListSecretsResponse,
  type LoginRequest,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  type ObservabilityPeriod,
  ObservabilitySummary,
  type PortalRequest,
  PortalResponse,
  RunCompareResponse,
  type RunSearchRequest,
  RunSearchResponse,
  SavedView,
  type SavedViewSurface,
  type SavingsPeriod,
  SavingsResponse,
  type SetSecretRequest,
  SetSecretResponse,
  type SignupRequest,
  type SwitchTenantRequest,
  SwitchTenantResponse,
  type UpdateDesignPartnerApplicationRequest,
  type UpdateSavedViewRequest,
} from '@aldo-ai/api-contract';
import type { z } from 'zod';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

/**
 * Path prefix the Next.js auth-proxy route handler serves on. Client
 * components that call `request<T>()` are rewritten to hit this prefix
 * instead of `API_BASE` directly so the HTTP-only `aldo_session`
 * cookie can be unwrapped server-side and injected as
 * `Authorization: Bearer <token>`. The browser bundle never sees the
 * raw token. See `apps/web/app/api/auth-proxy/[...path]/route.ts`.
 */
export const AUTH_PROXY_PREFIX = '/api/auth-proxy';

/**
 * Server-side bearer-token resolver, installed at runtime by the root
 * layout (or any other server-only boundary). Pulling
 * `getSession()` directly into this module would force the client
 * bundle to depend on `next/headers`; instead we accept a setter so
 * the wiring stays one-way (server -> module). When unset (e.g.
 * during pre-render or in a client bundle) `request<T>()` skips the
 * Authorization header.
 */
let serverTokenResolver: (() => Promise<string | null>) | null = null;

/**
 * Install the server-side token resolver. Idempotent. Called by the
 * top-level layout before it fetches anything through `request<T>()`.
 * Safe to call from a server component.
 */
export function setServerTokenResolver(fn: () => Promise<string | null>): void {
  serverTokenResolver = fn;
}

async function readServerToken(): Promise<string | null> {
  if (typeof window !== 'undefined') return null;
  if (!serverTokenResolver) return null;
  try {
    return await serverTokenResolver();
  } catch {
    return null;
  }
}

export type ApiClientErrorKind = 'network' | 'http_4xx' | 'http_5xx' | 'parse' | 'envelope';

export class ApiClientError extends Error {
  readonly kind: ApiClientErrorKind;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly details: unknown;

  constructor(
    kind: ApiClientErrorKind,
    message: string,
    opts: {
      status?: number;
      code?: string;
      details?: unknown;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.kind = kind;
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  // In the browser, route through the Next auth-proxy so the
  // HTTP-only session cookie can be unwrapped server-side. On the
  // server we hit the API directly and inject the Authorization
  // header inline (see `request()`).
  if (typeof window !== 'undefined') {
    const proxyUrl = new URL(`${AUTH_PROXY_PREFIX}${normalised}`, window.location.origin);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === '') continue;
        proxyUrl.searchParams.set(k, String(v));
      }
    }
    return proxyUrl.toString();
  }
  const url = new URL(normalised, API_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Build the per-request header bag, injecting `Authorization: Bearer
 * <token>` when running server-side and a session cookie is present.
 * Exported for unit testing.
 */
export async function buildRequestHeaders(
  base: HeadersInit | undefined,
): Promise<Record<string, string>> {
  const merged: Record<string, string> = {
    accept: 'application/json',
  };
  if (base) {
    if (base instanceof Headers) {
      base.forEach((v, k) => {
        merged[k.toLowerCase()] = v;
      });
    } else if (Array.isArray(base)) {
      for (const [k, v] of base) merged[k.toLowerCase()] = v;
    } else {
      for (const [k, v] of Object.entries(base)) merged[k.toLowerCase()] = String(v);
    }
  }
  // Skip token injection in the browser — the proxy route handler
  // attaches it from the cookie there.
  if (typeof window === 'undefined') {
    const token = await readServerToken();
    if (token) merged.authorization = `Bearer ${token}`;
  }
  return merged;
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const { query, ...rest } = init;
  const url = buildUrl(path, query);

  const headers = await buildRequestHeaders(rest.headers);

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers,
      // Server components: fresh fetches; keep cache off for v0.
      cache: 'no-store',
      // Browser path goes through the same-origin auth-proxy; ensure
      // the `aldo_session` cookie rides along on every request.
      credentials: typeof window === 'undefined' ? 'omit' : 'include',
    });
  } catch (err) {
    throw new ApiClientError('network', `Network error contacting API at ${url}`, {
      cause: err,
    });
  }

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
    const parsedErr = ApiError.safeParse(json);
    if (parsedErr.success) {
      throw new ApiClientError(
        res.status >= 500 ? 'http_5xx' : 'http_4xx',
        parsedErr.data.error.message,
        {
          status: res.status,
          code: parsedErr.data.error.code,
          details: parsedErr.data.error.details,
        },
      );
    }
    throw new ApiClientError(
      res.status >= 500 ? 'http_5xx' : 'http_4xx',
      `HTTP ${res.status} from ${url}`,
      { status: res.status, details: json },
    );
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiClientError('envelope', `Response from ${url} did not match the expected schema`, {
      status: res.status,
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

/* -------------------------------- Runs ---------------------------------- */

export function listRuns(query: Partial<ListRunsQuery> = {}) {
  return request('/v1/runs', ListRunsResponse, { query });
}

export function getRun(id: string) {
  return request(`/v1/runs/${encodeURIComponent(id)}`, GetRunResponse);
}

/**
 * `GET /v1/runs/:id/tree` — composite-run tree.
 *
 * Pass any run id (root, intermediate, or leaf); the API resolves the
 * root and returns the whole tree. Read-only — operators never trigger
 * subagent reruns from this endpoint. Returns HTTP 422 with code
 * `run_tree_too_deep` when the tree exceeds the max-depth cap.
 */
export function getRunTree(rootRunId: string) {
  return request(`/v1/runs/${encodeURIComponent(rootRunId)}/tree`, GetRunTreeResponse);
}

/**
 * `GET /v1/runs/compare?a=&b=` — wave-13 convenience endpoint.
 *
 * Returns both runs (full detail) + a server-derived diff in a single
 * round-trip so the comparison view doesn't fan out four parallel
 * calls. Both ids must belong to the caller's tenant; an unknown id
 * returns 404 with the standard envelope.
 */
export function compareRuns(a: string, b: string) {
  return request('/v1/runs/compare', RunCompareResponse, { query: { a, b } });
}

/**
 * Wave-13 — `GET /v1/runs/search` — full-text + multi-faceted search.
 *
 * Multi-value filter keys (`status`, `agent`, `model`, `tag`) accept
 * a string[] and we serialise them as comma-separated values
 * (compact + the API parses both forms). Returns the same
 * RunSummary[] shape plus a `total` count over the current tenant.
 */
export function searchRuns(
  query: Partial<RunSearchRequest> & { cursor?: string; limit?: number } = {},
) {
  const flat: Record<string, string | number | undefined> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) flat[k] = v.join(',');
    } else if (typeof v === 'boolean') {
      flat[k] = String(v);
    } else if (typeof v === 'number') {
      flat[k] = v;
    } else if (typeof v === 'string') {
      if (v.length > 0) flat[k] = v;
    }
  }
  return request('/v1/runs/search', RunSearchResponse, { query: flat });
}

/**
 * Wave-13 — `POST /v1/runs/bulk` — bulk action on a list of run ids.
 * Single transaction; returns the affected-row count.
 */
export function bulkRunAction(req: BulkRunActionRequest) {
  return request('/v1/runs/bulk', BulkRunActionResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/* ------------------------------- Saved views --------------------------- */

/**
 * Wave-13 — `GET /v1/views?surface=runs|agents|eval|observability`.
 *
 * Tenant + user scoped. Includes both views the caller authored and
 * shared views from other members of the same tenant.
 */
export function listSavedViews(query: { surface: SavedViewSurface }) {
  return request('/v1/views', ListSavedViewsResponse, { query });
}

/** Wave-13 — `POST /v1/views` — create a saved view. */
export function createSavedView(req: CreateSavedViewRequest) {
  return request('/v1/views', SavedView, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/** Wave-13 — `PATCH /v1/views/:id` — rename / re-save / flip share. */
export function updateSavedView(id: string, req: UpdateSavedViewRequest) {
  return request(`/v1/views/${encodeURIComponent(id)}`, SavedView, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/** Wave-13 — `DELETE /v1/views/:id`. Returns void on 204. */
export async function deleteSavedView(id: string): Promise<void> {
  const url = buildUrl(`/v1/views/${encodeURIComponent(id)}`);
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

/* ------------------------------- Agents --------------------------------- */

export function listAgents(query: Partial<ListAgentsQuery> = {}) {
  return request('/v1/agents', ListAgentsResponse, { query });
}

export function getAgent(name: string) {
  return request(`/v1/agents/${encodeURIComponent(name)}`, GetAgentResponse);
}

/**
 * `POST /v1/agents/:name/check` — operator dry-run.
 *
 * Read-only. Asks the API to simulate a routing decision against the
 * live model catalog and return per-class filter outcomes. The result
 * is rendered inline by the routing-dry-run card on the agent page.
 */
export function checkAgent(name: string) {
  return request(`/v1/agents/${encodeURIComponent(name)}/check`, CheckAgentResponse, {
    method: 'POST',
  });
}

/* ------------------------------- Models --------------------------------- */

export function listModels() {
  return request('/v1/models', ListModelsResponse);
}

/**
 * `GET /v1/models/savings?period=7d|30d|90d` — wave-12 "cloud spend you
 * saved by going local" aggregation. Cross-tenant safe, defaults to 30d.
 * Only counts savings where the local model had a genuinely-equivalent
 * cloud model in the catalog at probe time.
 */
export function getModelSavings(query: { period?: SavingsPeriod } = {}) {
  return request('/v1/models/savings', SavingsResponse, { query });
}

/* ----------------------------- Observability ---------------------------- */

/**
 * `GET /v1/observability/summary?period=24h|7d|30d` — wave-12 KPIs +
 * privacy-router decision feed + sandbox/guards activity feed +
 * local-vs-cloud breakdown, all in one round-trip. Authed and
 * tenant-scoped.
 */
export function getObservabilitySummary(query: { period?: ObservabilityPeriod } = {}) {
  return request('/v1/observability/summary', ObservabilitySummary, { query });
}

/* ------------------------------- Secrets -------------------------------- */

export function listSecrets() {
  return request('/v1/secrets', ListSecretsResponse);
}

export function setSecret(req: SetSecretRequest) {
  return request('/v1/secrets', SetSecretResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/**
 * DELETE /v1/secrets/:name. Returns void on 204; throws ApiClientError
 * on any non-2xx (404 when the secret is already gone, 4xx for invalid
 * names, 5xx for store failures). Mirrors the contract surface — never
 * touches the raw value.
 */
export async function deleteSecret(name: string): Promise<void> {
  const url = buildUrl(`/v1/secrets/${encodeURIComponent(name)}`);
  const headers = await buildRequestHeaders(undefined);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'DELETE',
      headers,
      cache: 'no-store',
      credentials: typeof window === 'undefined' ? 'omit' : 'include',
    });
  } catch (err) {
    throw new ApiClientError('network', `Network error contacting API at ${url}`, {
      cause: err,
    });
  }

  if (res.status === 204) return;

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
    const parsedErr = ApiError.safeParse(json);
    if (parsedErr.success) {
      throw new ApiClientError(
        res.status >= 500 ? 'http_5xx' : 'http_4xx',
        parsedErr.data.error.message,
        {
          status: res.status,
          code: parsedErr.data.error.code,
          details: parsedErr.data.error.details,
        },
      );
    }
    throw new ApiClientError(
      res.status >= 500 ? 'http_5xx' : 'http_4xx',
      `HTTP ${res.status} from ${url}`,
      { status: res.status, details: json },
    );
  }

  // 2xx other than 204 — accept silently.
}

/* -------------------------------- Auth ---------------------------------- */

/**
 * `POST /v1/auth/signup` — create a new user + tenant. The returned
 * token is the new session credential; callers store it via
 * `lib/session.setSession()`.
 */
export function signup(req: SignupRequest) {
  return request('/v1/auth/signup', AuthSessionResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/** `POST /v1/auth/login`. */
export function login(req: LoginRequest) {
  return request('/v1/auth/login', AuthSessionResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/**
 * `GET /v1/auth/me` — server-side session probe. Used by pages that
 * need the current user/tenant in their render. A 401 here means the
 * cookie is stale; pages bubble the `ApiClientError` up to the
 * middleware-friendly redirect path.
 */
export function getAuthMe() {
  return request('/v1/auth/me', AuthMeResponse);
}

/** `POST /v1/auth/switch-tenant`. Returns a fresh JWT scoped to the new tenant. */
export function switchTenant(req: SwitchTenantRequest) {
  return request('/v1/auth/switch-tenant', SwitchTenantResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/* ------------------------- Design-partner admin ------------------------ */

/**
 * `GET /v1/admin/design-partner-applications` — admin only. Listed
 * newest-first. Optional `status` filter narrows to one workflow
 * state (`new` | `contacted` | `accepted` | `declined`).
 */
export function listDesignPartnerApplications(query: { status?: string } = {}) {
  return request('/v1/admin/design-partner-applications', ListDesignPartnerApplicationsResponse, {
    query,
  });
}

/**
 * `PATCH /v1/admin/design-partner-applications/:id` — admin only.
 * Updates status and/or admin notes. The API stamps `reviewed_by` +
 * `reviewed_at` from the authenticated session.
 */
export function updateDesignPartnerApplication(
  id: string,
  body: UpdateDesignPartnerApplicationRequest,
) {
  return request(
    `/v1/admin/design-partner-applications/${encodeURIComponent(id)}`,
    DesignPartnerApplication,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

/* ------------------------------ Billing --------------------------------- */

/**
 * `GET /v1/billing/subscription` — caller's tenant subscription. The
 * response shape is the same in placeholder mode and live mode; only
 * the trial countdown changes. The `/v1/billing/checkout` endpoint
 * returns a typed `not_configured` error when STRIPE_* env vars are
 * unset; the `/billing` page switches on that to render a banner
 * instead of an error UI.
 */
export function getSubscription() {
  return request('/v1/billing/subscription', GetSubscriptionResponse);
}

/**
 * `GET /v1/billing/usage` — aggregated cost analytics for the caller's
 * tenant over the requested period. ORTHOGONAL to subscription state:
 * always returns 200 (or auth/validation errors) regardless of whether
 * Stripe is configured. The `/billing` analytics charts call this
 * directly even in placeholder mode.
 *
 * Provider-agnostic: the response keys on `model` (opaque string) and
 * `agent` (the agent name); never on a provider enum.
 */
export function getBillingUsage(query: { period?: BillingUsagePeriod } = {}) {
  return request('/v1/billing/usage', BillingUsageResponse, { query });
}

/**
 * `POST /v1/billing/checkout` — mint a Stripe Checkout URL. Throws an
 * `ApiClientError` with `code === 'not_configured'` (HTTP 503) when
 * billing isn't wired in this environment; pages that consume this
 * function should catch and render a placeholder.
 */
export function createCheckoutSession(req: CheckoutRequest) {
  return request('/v1/billing/checkout', CheckoutResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/**
 * `POST /v1/billing/portal` — mint a Stripe Billing Portal URL. Same
 * `not_configured` semantics as checkout. Used by the "Manage
 * subscription" button on /billing.
 */
export function createPortalSession(req: PortalRequest = {}) {
  return request('/v1/billing/portal', PortalResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/**
 * `POST /v1/auth/logout` — best-effort server-side invalidation.
 * Returns 204; the cookie is cleared regardless of whether this
 * succeeds (the server may already consider the JWT expired).
 */
export async function logout(): Promise<void> {
  const url = buildUrl('/v1/auth/logout');
  const headers = await buildRequestHeaders({ 'content-type': 'application/json' });
  try {
    await fetch(url, {
      method: 'POST',
      headers,
      cache: 'no-store',
      credentials: typeof window === 'undefined' ? 'omit' : 'include',
    });
  } catch {
    // Network errors during logout should never block the client; the
    // cookie clear in `clearSession()` is what actually matters for the
    // user.
  }
}

/* ---------------------------- Notifications ---------------------------- */

/**
 * `GET /v1/notifications` — wave-13 bell-popover + /notifications page.
 * Pagination is intentionally limited (max 100 per call); the page
 * doesn't need a cursor — older rows are reachable via /activity if
 * the user wants the full history.
 */
export function listNotificationsApi(
  query: { unreadOnly?: boolean; kind?: string; limit?: number } = {},
) {
  const q: Record<string, string | number | undefined> = {};
  if (query.unreadOnly !== undefined) q.unreadOnly = query.unreadOnly ? 'true' : 'false';
  if (query.kind !== undefined) q.kind = query.kind;
  if (query.limit !== undefined) q.limit = query.limit;
  return request('/v1/notifications', ListNotificationsResponse, { query: q });
}

export function markNotificationReadApi(id: string) {
  return request(
    `/v1/notifications/${encodeURIComponent(id)}/mark-read`,
    MarkNotificationReadResponse,
    {
      method: 'POST',
    },
  );
}

export function markAllNotificationsReadApi() {
  return request('/v1/notifications/mark-all-read', MarkAllNotificationsReadResponse, {
    method: 'POST',
  });
}

/* ----------------------------- Activity feed --------------------------- */

export function listActivityApi(
  query: {
    actorUserId?: string;
    verb?: string;
    since?: string;
    until?: string;
    cursor?: string;
    limit?: number;
  } = {},
) {
  const q: Record<string, string | number | undefined> = {};
  if (query.actorUserId !== undefined) q.actorUserId = query.actorUserId;
  if (query.verb !== undefined) q.verb = query.verb;
  if (query.since !== undefined) q.since = query.since;
  if (query.until !== undefined) q.until = query.until;
  if (query.cursor !== undefined) q.cursor = query.cursor;
  if (query.limit !== undefined) q.limit = query.limit;
  return request('/v1/activity', ListActivityResponse, { query: q });
}

/* ---------------------------- Annotations ----------------------------- */
//
// Wave 14 (Engineer 14D). The `<CommentsThread>` UI uses these helpers
// to drive a 15s poll on the runs / sweeps / agents detail pages.

export async function listAnnotationsApi(query: {
  targetKind: 'run' | 'sweep' | 'agent';
  targetId: string;
}) {
  const { ListAnnotationsResponse } = await import('@aldo-ai/api-contract');
  return request('/v1/annotations', ListAnnotationsResponse, {
    query: { targetKind: query.targetKind, targetId: query.targetId },
  });
}

export async function createAnnotationApi(req: {
  targetKind: 'run' | 'sweep' | 'agent';
  targetId: string;
  body: string;
  parentId?: string;
}) {
  const { Annotation } = await import('@aldo-ai/api-contract');
  const { z } = await import('zod');
  return request('/v1/annotations', z.object({ annotation: Annotation }), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function updateAnnotationApi(id: string, body: string) {
  const { Annotation } = await import('@aldo-ai/api-contract');
  const { z } = await import('zod');
  return request(
    `/v1/annotations/${encodeURIComponent(id)}`,
    z.object({ annotation: Annotation }),
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    },
  );
}

export async function deleteAnnotationApi(id: string): Promise<void> {
  const url = buildUrl(`/v1/annotations/${encodeURIComponent(id)}`);
  const headers = await buildRequestHeaders(undefined);
  const res = await fetch(url, {
    method: 'DELETE',
    headers,
    cache: 'no-store',
    credentials: typeof window === 'undefined' ? 'omit' : 'include',
  });
  if (!res.ok && res.status !== 204) {
    throw new ApiClientError('http_4xx', `DELETE failed: ${res.status}`, { status: res.status });
  }
}

export async function toggleReactionApi(
  annotationId: string,
  kind: 'thumbs_up' | 'thumbs_down' | 'eyes' | 'check',
) {
  const { ToggleReactionResponse } = await import('@aldo-ai/api-contract');
  return request(
    `/v1/annotations/${encodeURIComponent(annotationId)}/reactions`,
    ToggleReactionResponse,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind }),
    },
  );
}

/* ----------------------------- Share links ---------------------------- */
//
// Wave 14 (Engineer 14D). The Share dialog on /runs/[id], /eval/sweeps/[id]
// and /agents/[name] uses these helpers to mint, list, and revoke
// public share-link slugs.

export async function listSharesApi(
  query: {
    targetKind?: 'run' | 'sweep' | 'agent';
    targetId?: string;
  } = {},
) {
  const { ListShareLinksResponse } = await import('@aldo-ai/api-contract');
  const q: Record<string, string | number | undefined> = {};
  if (query.targetKind !== undefined) q.targetKind = query.targetKind;
  if (query.targetId !== undefined) q.targetId = query.targetId;
  return request('/v1/shares', ListShareLinksResponse, { query: q });
}

export async function createShareApi(req: {
  targetKind: 'run' | 'sweep' | 'agent';
  targetId: string;
  expiresInHours?: number;
  password?: string;
}) {
  const { CreateShareLinkResponse } = await import('@aldo-ai/api-contract');
  return request('/v1/shares', CreateShareLinkResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function revokeShareApi(id: string) {
  const { ShareLink } = await import('@aldo-ai/api-contract');
  const { z } = await import('zod');
  return request(`/v1/shares/${encodeURIComponent(id)}/revoke`, z.object({ share: ShareLink }), {
    method: 'POST',
  });
}

export async function deleteShareApi(id: string): Promise<void> {
  const url = buildUrl(`/v1/shares/${encodeURIComponent(id)}`);
  const headers = await buildRequestHeaders(undefined);
  const res = await fetch(url, {
    method: 'DELETE',
    headers,
    cache: 'no-store',
    credentials: typeof window === 'undefined' ? 'omit' : 'include',
  });
  if (!res.ok && res.status !== 204) {
    throw new ApiClientError('http_4xx', `DELETE failed: ${res.status}`, { status: res.status });
  }
}
