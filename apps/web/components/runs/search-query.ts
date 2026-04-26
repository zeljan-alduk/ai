/**
 * Pure URL <-> RunSearchQuery serialiser for the /runs page.
 *
 * Exported as a standalone module so it's vitest-friendly without
 * pulling in React or Next.js. The web /runs page reads/writes this
 * shape from the URL on every navigation so a saved view (a JSONB
 * blob on the API) round-trips through the URL deterministically.
 *
 * LLM-agnostic: filter values are opaque strings — never enumerated
 * against a specific provider name.
 */

export interface RunSearchQuery {
  q?: string | undefined;
  status?: string[] | undefined;
  agent?: string[] | undefined;
  model?: string[] | undefined;
  tag?: string[] | undefined;
  cost_gte?: number | undefined;
  cost_lte?: number | undefined;
  duration_gte?: number | undefined;
  duration_lte?: number | undefined;
  started_after?: string | undefined;
  started_before?: string | undefined;
  has_children?: boolean | undefined;
  has_failed_event?: boolean | undefined;
  include_archived?: boolean | undefined;
  /** Active saved-view id (so the URL re-pins the dropdown). */
  view?: string | undefined;
  /** Pagination cursor — round-trips as opaque base64. */
  cursor?: string | undefined;
}

/**
 * Parse a `URLSearchParams` (or Next.js `searchParams` object) into a
 * `RunSearchQuery`. Multi-value keys (`status`, `agent`, `model`,
 * `tag`) accept either repeated params (`?status=running&status=failed`)
 * or comma-separated values (`?status=running,failed`). Empty values
 * are dropped.
 */
export function parseRunSearchQuery(
  raw: URLSearchParams | Record<string, string | string[] | undefined>,
): RunSearchQuery {
  const params: URLSearchParams = raw instanceof URLSearchParams ? raw : recordToParams(raw);
  const q: RunSearchQuery = {};
  const text = params.get('q');
  if (text !== null && text.length > 0) q.q = text;

  const multi = (key: 'status' | 'agent' | 'model' | 'tag'): string[] | undefined => {
    const all = params.getAll(key);
    const tokens: string[] = [];
    for (const v of all) {
      for (const t of v.split(',')) {
        const trimmed = t.trim();
        if (trimmed.length > 0) tokens.push(trimmed);
      }
    }
    return tokens.length > 0 ? tokens : undefined;
  };
  const status = multi('status');
  if (status) q.status = status;
  const agent = multi('agent');
  if (agent) q.agent = agent;
  const model = multi('model');
  if (model) q.model = model;
  const tag = multi('tag');
  if (tag) q.tag = tag;

  const num = (key: keyof RunSearchQuery): number | undefined => {
    const v = params.get(key as string);
    if (v === null || v.length === 0) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const costGte = num('cost_gte');
  if (costGte !== undefined) q.cost_gte = costGte;
  const costLte = num('cost_lte');
  if (costLte !== undefined) q.cost_lte = costLte;
  const durGte = num('duration_gte');
  if (durGte !== undefined) q.duration_gte = durGte;
  const durLte = num('duration_lte');
  if (durLte !== undefined) q.duration_lte = durLte;

  const sa = params.get('started_after');
  if (sa !== null && sa.length > 0) q.started_after = sa;
  const sb = params.get('started_before');
  if (sb !== null && sb.length > 0) q.started_before = sb;

  const bool = (
    key: 'has_children' | 'has_failed_event' | 'include_archived',
  ): boolean | undefined => {
    const v = params.get(key);
    if (v === null) return undefined;
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return undefined;
  };
  const hc = bool('has_children');
  if (hc !== undefined) q.has_children = hc;
  const hfe = bool('has_failed_event');
  if (hfe !== undefined) q.has_failed_event = hfe;
  const ia = bool('include_archived');
  if (ia !== undefined) q.include_archived = ia;

  const view = params.get('view');
  if (view !== null && view.length > 0) q.view = view;
  const cursor = params.get('cursor');
  if (cursor !== null && cursor.length > 0) q.cursor = cursor;
  return q;
}

/**
 * Serialise a `RunSearchQuery` back into a `URLSearchParams`. Multi-
 * value keys are emitted as comma-separated values (more compact than
 * repeated keys, and the parser accepts both).
 *
 * Order is deterministic so two structurally-equal queries always
 * stringify to the same URL — important for shareable links and for
 * the "this URL matches the active saved view" check.
 */
export function serializeRunSearchQuery(q: RunSearchQuery): URLSearchParams {
  const out = new URLSearchParams();
  if (q.q && q.q.length > 0) out.set('q', q.q);
  if (q.status && q.status.length > 0) out.set('status', q.status.join(','));
  if (q.agent && q.agent.length > 0) out.set('agent', q.agent.join(','));
  if (q.model && q.model.length > 0) out.set('model', q.model.join(','));
  if (q.tag && q.tag.length > 0) out.set('tag', q.tag.join(','));
  if (q.cost_gte !== undefined) out.set('cost_gte', String(q.cost_gte));
  if (q.cost_lte !== undefined) out.set('cost_lte', String(q.cost_lte));
  if (q.duration_gte !== undefined) out.set('duration_gte', String(q.duration_gte));
  if (q.duration_lte !== undefined) out.set('duration_lte', String(q.duration_lte));
  if (q.started_after) out.set('started_after', q.started_after);
  if (q.started_before) out.set('started_before', q.started_before);
  if (q.has_children !== undefined) out.set('has_children', String(q.has_children));
  if (q.has_failed_event !== undefined) out.set('has_failed_event', String(q.has_failed_event));
  if (q.include_archived !== undefined) out.set('include_archived', String(q.include_archived));
  if (q.view) out.set('view', q.view);
  if (q.cursor) out.set('cursor', q.cursor);
  return out;
}

/**
 * Strip the `cursor` + `view` keys for storage. A saved view should
 * NOT carry the active page's pagination cursor or its own id (that's
 * a tautology); both are surface-state, not filter-state.
 */
export function toSavedViewQuery(q: RunSearchQuery): RunSearchQuery {
  const { cursor: _cursor, view: _view, ...rest } = q;
  void _cursor;
  void _view;
  return rest;
}

/** True iff `q` carries no active filter (i.e. would render every run). */
export function isEmptyQuery(q: RunSearchQuery): boolean {
  const filterKeys: Array<keyof RunSearchQuery> = [
    'q',
    'status',
    'agent',
    'model',
    'tag',
    'cost_gte',
    'cost_lte',
    'duration_gte',
    'duration_lte',
    'started_after',
    'started_before',
    'has_children',
    'has_failed_event',
    'include_archived',
  ];
  for (const k of filterKeys) {
    const v = q[k];
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'string' && v.length === 0) continue;
    return false;
  }
  return true;
}

function recordToParams(rec: Record<string, string | string[] | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(rec)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const one of v) p.append(k, one);
    } else {
      p.append(k, v);
    }
  }
  return p;
}
