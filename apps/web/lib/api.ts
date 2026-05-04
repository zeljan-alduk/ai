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
 *
 * Concurrency: pages MUST use `boundedAll()` (exported below) instead of
 * raw Promise.all when fanning out many SSR fetches against the API.
 * Vercel's serverless DNS resolver caps out around ~30 concurrent lookups
 * per cold-boot — past that, fetches return HTTP 503 with body "DNS cache
 * overflow". Batching to 6 keeps us well under the limit.
 */

/** Run async operations with bounded concurrency. Preserves order. */
export async function boundedAll<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      // biome-ignore lint/style/noNonNullAssertion: idx < length guarantees defined
      out[idx] = await fn(items[idx]!, idx);
    }
  });
  await Promise.all(workers);
  return out;
}

import {
  ApiError,
  AuthMeResponse,
  AuthSessionResponse,
  type BillingUsagePeriod,
  BillingUsageResponse,
  BulkCreateDatasetExamplesResponse,
  type BulkRunActionRequest,
  BulkRunActionResponse,
  CheckAgentResponse,
  type CheckoutRequest,
  CheckoutResponse,
  ClusterSweepResponse,
  type CreateDatasetExampleRequest,
  type CreateDatasetRequest,
  type CreateEvaluatorRequest,
  type CreateProjectRequest,
  type CreatePromptRequest,
  type CreatePromptVersionRequest,
  type CreateSavedViewRequest,
  Dataset,
  DatasetExample,
  DesignPartnerApplication,
  Evaluator,
  GetAgentResponse,
  GetPlaygroundRunResponse,
  GetPromptResponse,
  GetPromptVersionResponse,
  GetRunResponse,
  GetRunTreeResponse,
  GetSubscriptionResponse,
  ListActivityResponse,
  type ListAgentsQuery,
  ListAgentsResponse,
  ListDatasetExamplesResponse,
  ListDatasetsResponse,
  ListDesignPartnerApplicationsResponse,
  ListEvaluatorsResponse,
  ListFailureClustersResponse,
  ListModelsResponse,
  ListNotificationsResponse,
  ListProjectsResponse,
  ListPromptVersionsResponse,
  ListPromptsResponse,
  type ListRunsQuery,
  ListRunsResponse,
  ListSavedViewsResponse,
  ListSecretsResponse,
  type LoginRequest,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  type ObservabilityPeriod,
  ObservabilitySummary,
  PopularTagsResponse,
  type PortalRequest,
  PortalResponse,
  Project,
  PromptDiffResponse,
  type PromptTestRequest,
  PromptTestResponse,
  RunCompareResponse,
  type RunSearchRequest,
  RunSearchResponse,
  RunTagsResponse,
  SavedView,
  type SavedViewSurface,
  type SavingsPeriod,
  SavingsResponse,
  type SetSecretRequest,
  SetSecretResponse,
  type SignupRequest,
  type SpendGroupBy,
  SpendResponse,
  type SpendWindow,
  type StartPlaygroundRunRequest,
  StartPlaygroundRunResponse,
  type SwitchTenantRequest,
  SwitchTenantResponse,
  type TestEvaluatorRequest,
  TestEvaluatorResponse,
  type UpdateDatasetExampleRequest,
  type UpdateDatasetRequest,
  type UpdateDesignPartnerApplicationRequest,
  type UpdateEvaluatorRequest,
  type UpdateProjectRequest,
  type UpdatePromptRequest,
  type UpdateSavedViewRequest,
} from '@aldo-ai/api-contract';
import { z } from 'zod';

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

/* ------------------------------- Threads ------------------------------- */
//
// Wave-19 — chat-style multi-run grouping over runs.thread_id (migration 026).
// `/threads` UI uses these to drive the list page and the per-thread chat
// transcript view.

export async function listThreadsApi(
  query: { project?: string; cursor?: string; limit?: number } = {},
) {
  const { ListThreadsResponse } = await import('@aldo-ai/api-contract');
  const q: Record<string, string | number | undefined> = {};
  if (query.project !== undefined) q.project = query.project;
  if (query.cursor !== undefined) q.cursor = query.cursor;
  if (query.limit !== undefined) q.limit = query.limit;
  return request('/v1/threads', ListThreadsResponse, { query: q });
}

export async function getThreadApi(id: string) {
  const { GetThreadResponse } = await import('@aldo-ai/api-contract');
  return request(`/v1/threads/${encodeURIComponent(id)}`, GetThreadResponse);
}

export async function getThreadTimelineApi(id: string) {
  const { GetThreadTimelineResponse } = await import('@aldo-ai/api-contract');
  return request(`/v1/threads/${encodeURIComponent(id)}/timeline`, GetThreadTimelineResponse);
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

/**
 * Wave-4 — `GET /v1/runs/tags/popular` — top-N most-used tags in
 * the caller's tenant + run counts. Drives the filter-bar autocomplete
 * + the inline editor's suggestion list.
 */
export function popularRunTags(opts: { limit?: number } = {}) {
  return request('/v1/runs/tags/popular', PopularTagsResponse, {
    query: { limit: opts.limit ?? 50 },
  });
}

/** Wave-4 — `POST /v1/runs/:id/tags` — replace the run's tag list. */
export function replaceRunTags(runId: string, tags: ReadonlyArray<string>) {
  return request(`/v1/runs/${encodeURIComponent(runId)}/tags`, RunTagsResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tags: [...tags] }),
  });
}

/** Wave-4 — `POST /v1/runs/:id/tags/add` — append a single tag. */
export function addRunTag(runId: string, tag: string) {
  return request(`/v1/runs/${encodeURIComponent(runId)}/tags/add`, RunTagsResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag }),
  });
}

/** Wave-4 — `DELETE /v1/runs/:id/tags/:tag` — remove a single tag. */
export function removeRunTag(runId: string, tag: string) {
  return request(
    `/v1/runs/${encodeURIComponent(runId)}/tags/${encodeURIComponent(tag)}`,
    RunTagsResponse,
    { method: 'DELETE' },
  );
}

/* ------------------------------- Approvals ----------------------------- */
//
// MISSING_PIECES #9 — approval-gate API.
// Lists pending approvals for a run + applies an approve/reject decision.

export async function listRunApprovals(runId: string) {
  const { ListPendingApprovalsResponse } = await import('@aldo-ai/api-contract');
  return request(
    `/v1/runs/${encodeURIComponent(runId)}/approvals`,
    ListPendingApprovalsResponse,
  );
}

export async function approveRunCall(
  runId: string,
  body: { callId: string; reason?: string },
) {
  const { ApprovalDecisionResponse } = await import('@aldo-ai/api-contract');
  return request(
    `/v1/runs/${encodeURIComponent(runId)}/approve`,
    ApprovalDecisionResponse,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export async function rejectRunCall(
  runId: string,
  body: { callId: string; reason: string },
) {
  const { ApprovalDecisionResponse } = await import('@aldo-ai/api-contract');
  return request(
    `/v1/runs/${encodeURIComponent(runId)}/reject`,
    ApprovalDecisionResponse,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
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

/* ------------------------------- Spend ---------------------------------- */

/**
 * `GET /v1/spend?project=&window=&since=&until=&groupBy=` — Wave-4
 * cost + spend analytics. One round-trip returns totals + four
 * top-row cards (today / WTD / MTD / active runs) + a dense (zero-
 * filled) timeseries + ONE breakdown axis. The `/observability/spend`
 * page issues 3 calls in parallel (one per breakdown axis) and keeps
 * the cards/timeseries from the first.
 *
 * LLM-agnostic: every breakdown key is opaque (model id, capability
 * class, agent name, project slug). The contract carries no provider
 * brand strings.
 */
export function getSpend(query: {
  project?: string;
  window?: SpendWindow;
  since?: string;
  until?: string;
  groupBy?: SpendGroupBy;
}) {
  return request('/v1/spend', SpendResponse, { query });
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
 * `PATCH /v1/billing/subscription` — update tenant-visible subscription
 * fields. Wave 3 — only supports `retentionDays` today (and only on
 * the enterprise plan; the API returns 403 with code
 * `retention_override_not_allowed` for other plans, which the calling
 * server action translates to a `?notice=retention_blocked` redirect).
 */
export async function updateSubscription(body: { retentionDays: number | null }) {
  const { UpdateSubscriptionResponse } = await import('@aldo-ai/api-contract');
  return request('/v1/billing/subscription', UpdateSubscriptionResponse, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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

/* ------------------------------- Datasets ------------------------------ */
//
// Wave 16 (Engineer 16B). Thin wrappers around `/v1/datasets/*` and
// `/v1/datasets/:id/examples`. Engineer 16A owns the API routes; this
// module only renders + posts.

const DatasetEnvelope = z.object({ dataset: Dataset });
const DatasetExampleEnvelope = z.object({ example: DatasetExample });

export function listDatasets(query: { tag?: string; q?: string } = {}) {
  const q: Record<string, string | number | undefined> = {};
  if (query.tag !== undefined) q.tag = query.tag;
  if (query.q !== undefined) q.q = query.q;
  return request('/v1/datasets', ListDatasetsResponse, { query: q });
}

export function getDataset(id: string) {
  return request(`/v1/datasets/${encodeURIComponent(id)}`, DatasetEnvelope);
}

export function createDataset(req: CreateDatasetRequest) {
  return request('/v1/datasets', DatasetEnvelope, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function updateDataset(id: string, req: UpdateDatasetRequest) {
  return request(`/v1/datasets/${encodeURIComponent(id)}`, DatasetEnvelope, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function deleteDataset(id: string): Promise<void> {
  const url = buildUrl(`/v1/datasets/${encodeURIComponent(id)}`);
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

export function listDatasetExamples(
  id: string,
  query: { split?: string; q?: string; cursor?: string; limit?: number } = {},
) {
  const q: Record<string, string | number | undefined> = {};
  if (query.split !== undefined) q.split = query.split;
  if (query.q !== undefined) q.q = query.q;
  if (query.cursor !== undefined) q.cursor = query.cursor;
  if (query.limit !== undefined) q.limit = query.limit;
  return request(`/v1/datasets/${encodeURIComponent(id)}/examples`, ListDatasetExamplesResponse, {
    query: q,
  });
}

export function createDatasetExample(id: string, req: CreateDatasetExampleRequest) {
  return request(`/v1/datasets/${encodeURIComponent(id)}/examples`, DatasetExampleEnvelope, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function updateDatasetExample(
  datasetId: string,
  exampleId: string,
  req: UpdateDatasetExampleRequest,
) {
  return request(
    `/v1/datasets/${encodeURIComponent(datasetId)}/examples/${encodeURIComponent(exampleId)}`,
    DatasetExampleEnvelope,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    },
  );
}

/**
 * `POST /v1/datasets/:id/import` — multipart upload of a CSV or JSONL
 * file. We accept a `File` from the browser file input; the API
 * detects the format from the filename. Returns the bulk-import
 * summary (inserted / skipped / per-row errors).
 */
export async function importDatasetExamples(id: string, file: File) {
  const url = buildUrl(`/v1/datasets/${encodeURIComponent(id)}/import`);
  const headers = await buildRequestHeaders(undefined);
  // Don't set Content-Type — let the browser pick the boundary.
  (headers as Record<string, string | undefined>)['content-type'] = undefined;
  const form = new FormData();
  form.append('file', file);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
      cache: 'no-store',
      credentials: typeof window === 'undefined' ? 'omit' : 'include',
    });
  } catch (err) {
    throw new ApiClientError('network', `Network error contacting API at ${url}`, { cause: err });
  }
  const text = await res.text();
  let json: unknown;
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
  const parsed = BulkCreateDatasetExamplesResponse.safeParse(json);
  if (!parsed.success) {
    throw new ApiClientError('envelope', `Bad import response from ${url}`, {
      status: res.status,
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

/* ----------------------------- Evaluators ------------------------------ */

const EvaluatorEnvelope = z.object({ evaluator: Evaluator });

export function listEvaluators() {
  return request('/v1/evaluators', ListEvaluatorsResponse);
}

export function createEvaluator(req: CreateEvaluatorRequest) {
  return request('/v1/evaluators', EvaluatorEnvelope, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function updateEvaluator(id: string, req: UpdateEvaluatorRequest) {
  return request(`/v1/evaluators/${encodeURIComponent(id)}`, EvaluatorEnvelope, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function deleteEvaluator(id: string): Promise<void> {
  const url = buildUrl(`/v1/evaluators/${encodeURIComponent(id)}`);
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

export function testEvaluator(req: TestEvaluatorRequest) {
  // The endpoint accepts both a saved evaluator (req.evaluatorId) or
  // an inline kind+config. The "test before save" panel uses inline.
  const path = req.evaluatorId
    ? `/v1/evaluators/${encodeURIComponent(req.evaluatorId)}/test`
    : '/v1/evaluators/test';
  return request(path, TestEvaluatorResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/* -------------------------- Failure clusters --------------------------- */

export function listFailureClusters(sweepId: string) {
  return request(
    `/v1/eval/sweeps/${encodeURIComponent(sweepId)}/clusters`,
    ListFailureClustersResponse,
  );
}

export function clusterSweepFailures(sweepId: string) {
  return request(`/v1/eval/sweeps/${encodeURIComponent(sweepId)}/cluster`, ClusterSweepResponse, {
    method: 'POST',
  });
}

/* ------------------------------- Projects ----------------------------- */
//
// Wave 17. Foundation only — agents/runs/datasets are not yet scoped
// by project_id. The /projects page and create dialog use these
// directly; the project picker in the top nav comes once entity
// scoping lands.

const ProjectEnvelope = z.object({ project: Project });

export function listProjects(opts: { includeArchived?: boolean } = {}) {
  const q: Record<string, string | number | undefined> = {};
  if (opts.includeArchived) q.archived = '1';
  return request('/v1/projects', ListProjectsResponse, { query: q });
}

export function getProjectBySlug(slug: string) {
  return request(`/v1/projects/${encodeURIComponent(slug)}`, ProjectEnvelope);
}

export function createProject(req: CreateProjectRequest) {
  return request('/v1/projects', ProjectEnvelope, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function updateProject(slug: string, req: UpdateProjectRequest) {
  return request(`/v1/projects/${encodeURIComponent(slug)}`, ProjectEnvelope, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/* ----------------------- Eval scorer playground ----------------------- */
//
// Wave-3 (Tier-3.1). Bulk-evaluate one evaluator against one dataset
// in a Braintrust-style three-pane panel. Server returns a transient
// run id; the page polls the detail endpoint every ~1.5s until the
// status is terminal (mirrors `/eval/sweeps/[id]`'s polling shape).

export function startPlaygroundRun(req: StartPlaygroundRunRequest) {
  return request('/v1/eval/playground/run', StartPlaygroundRunResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function getPlaygroundRun(id: string, init?: { signal?: AbortSignal }) {
  return request(
    `/v1/eval/playground/runs/${encodeURIComponent(id)}`,
    GetPlaygroundRunResponse,
    init?.signal !== undefined ? { signal: init.signal } : {},
  );
}

/* ------------------------------- Prompts ------------------------------ */
//
// Wave-4 (Tier-4) — prompts as first-class entities. Closes Vellum +
// LangSmith Hub. Versioned prompt bodies, diff, playground; agent
// specs gain an additive `promptRef` slot in the spec contract.

export function listPrompts(query: { project?: string } = {}) {
  const q: Record<string, string | number | undefined> = {};
  if (query.project !== undefined) q.project = query.project;
  return request('/v1/prompts', ListPromptsResponse, { query: q });
}

export function getPrompt(id: string) {
  return request(`/v1/prompts/${encodeURIComponent(id)}`, GetPromptResponse);
}

export function createPrompt(req: CreatePromptRequest) {
  return request('/v1/prompts', GetPromptResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function updatePrompt(id: string, req: UpdatePromptRequest) {
  return request(`/v1/prompts/${encodeURIComponent(id)}`, GetPromptResponse, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function deletePrompt(id: string): Promise<void> {
  const url = buildUrl(`/v1/prompts/${encodeURIComponent(id)}`);
  const headers = await buildRequestHeaders(undefined);
  const res = await fetch(url, {
    method: 'DELETE',
    headers,
    cache: 'no-store',
    credentials: typeof window === 'undefined' ? 'omit' : 'include',
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    let parsedErr: unknown;
    try {
      parsedErr = JSON.parse(text);
    } catch {
      parsedErr = undefined;
    }
    const apiErr = ApiError.safeParse(parsedErr);
    throw new ApiClientError(
      res.status >= 500 ? 'http_5xx' : 'http_4xx',
      apiErr.success ? apiErr.data.error.message : `DELETE failed: ${res.status}`,
      {
        status: res.status,
        ...(apiErr.success
          ? { code: apiErr.data.error.code, details: apiErr.data.error.details }
          : {}),
      },
    );
  }
}

export function listPromptVersions(id: string) {
  return request(`/v1/prompts/${encodeURIComponent(id)}/versions`, ListPromptVersionsResponse);
}

export function getPromptVersion(id: string, version: number) {
  return request(
    `/v1/prompts/${encodeURIComponent(id)}/versions/${version}`,
    GetPromptVersionResponse,
  );
}

export function createPromptVersion(id: string, req: CreatePromptVersionRequest) {
  return request(`/v1/prompts/${encodeURIComponent(id)}/versions`, GetPromptVersionResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function getPromptDiff(id: string, from: number, to: number) {
  return request(`/v1/prompts/${encodeURIComponent(id)}/diff`, PromptDiffResponse, {
    query: { from, to },
  });
}

export function testPrompt(id: string, req: PromptTestRequest) {
  return request(`/v1/prompts/${encodeURIComponent(id)}/test`, PromptTestResponse, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}
