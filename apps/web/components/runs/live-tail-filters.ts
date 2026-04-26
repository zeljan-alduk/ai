/**
 * Pure logic for the wave-13 live-event-tail filter chips.
 *
 * Extracted from the React component so vitest can pin behaviour
 * without mounting the DOM. The functions are used by:
 *
 *   - apps/web/app/runs/[id]/live/page.tsx (server component shell)
 *   - apps/web/components/runs/live-tail.tsx (client island)
 *   - apps/web/components/runs/live-tail.test.ts (this file's tests)
 *
 * LLM-agnostic: filtering keys on event TYPE + SPAN PATH; never on a
 * provider name. The token-stream visualisation is keyed on `runId +
 * spanPath` so a switch from cloud → local model never clears the
 * stream mid-flight.
 */

export type LiveEventCategory = 'model_call' | 'tool_call' | 'span' | 'error' | 'other';

export interface LiveEvent {
  readonly id: string;
  readonly runId: string;
  /** Wire-shape `RunEvent.type` (free-form). */
  readonly type: string;
  readonly at: string;
  readonly payload: unknown;
}

/**
 * Bucket an event into one of five categories the filter chips know
 * about. Any event whose type doesn't match a known prefix lands in
 * `other` so the chip set stays bounded.
 */
export function categorize(type: string): LiveEventCategory {
  // Model-related events: deltas, stream starts, completion records.
  if (
    type === 'model_call' ||
    type === 'model_delta' ||
    type === 'model_stream_started' ||
    type === 'model_stream_finished' ||
    type === 'completion' ||
    type === 'message'
  ) {
    return 'model_call';
  }
  if (type === 'tool_call' || type === 'tool_result' || type === 'mcp_call') {
    return 'tool_call';
  }
  if (
    type === 'span' ||
    type === 'span.start' ||
    type === 'span.end' ||
    type === 'run.started' ||
    type === 'run.completed' ||
    type === 'run.cancelled' ||
    type.startsWith('composite.')
  ) {
    return 'span';
  }
  if (type === 'error' || type === 'policy_decision') {
    return 'error';
  }
  return 'other';
}

/**
 * Best-effort span path extractor. Reads `payload.spanPath` /
 * `payload.span` / `payload.path` first (engine-author choice); falls
 * back to "agent.name". Returns the empty string when nothing is
 * recoverable so chip filters with `agent.architect.*` never match
 * an empty path.
 */
export function spanPathOf(event: LiveEvent): string {
  const p = event.payload;
  if (p === null || typeof p !== 'object') return '';
  const obj = p as Record<string, unknown>;
  for (const k of ['spanPath', 'span', 'path']) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  // Composite-strategy events carry `payload.agent.name`.
  const agent = obj.agent;
  if (agent !== null && typeof agent === 'object') {
    const name = (agent as Record<string, unknown>).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

/**
 * Best-effort agent name extractor for the per-agent filter dropdown.
 * Handles the most-common payload shapes the engine emits today.
 */
export function agentNameOf(event: LiveEvent): string | null {
  const p = event.payload;
  if (p === null || typeof p !== 'object') return null;
  const obj = p as Record<string, unknown>;
  const direct = obj.agentName;
  if (typeof direct === 'string') return direct;
  const ref = obj.ref;
  if (ref !== null && typeof ref === 'object') {
    const name = (ref as Record<string, unknown>).name;
    if (typeof name === 'string') return name;
  }
  const agent = obj.agent;
  if (agent !== null && typeof agent === 'object') {
    const name = (agent as Record<string, unknown>).name;
    if (typeof name === 'string') return name;
  }
  if (typeof agent === 'string') return agent;
  return null;
}

export interface LiveFilters {
  readonly categories: ReadonlySet<LiveEventCategory>;
  /** Restrict to this agent (or null = all). */
  readonly agentName: string | null;
}

/**
 * Apply the filter chip selection to a buffer of events. An empty
 * `categories` set treats EVERY event as visible (= no chip selected
 * yet); the alternative behaviour ("show nothing when nothing is
 * checked") would be confusing on first load.
 */
export function applyFilters(
  events: ReadonlyArray<LiveEvent>,
  filters: LiveFilters,
): ReadonlyArray<LiveEvent> {
  const out: LiveEvent[] = [];
  for (const ev of events) {
    if (filters.categories.size > 0) {
      const cat = categorize(ev.type);
      if (!filters.categories.has(cat)) continue;
    }
    if (filters.agentName !== null) {
      if (agentNameOf(ev) !== filters.agentName) continue;
    }
    out.push(ev);
  }
  return out;
}

/**
 * Pull a one-line summary out of an event payload for the terminal
 * stream. Falls back to a JSON one-liner so the operator always sees
 * something. Truncates to 240 chars so a stuck-loop run doesn't
 * blow out the row height.
 */
export function summarize(event: LiveEvent): string {
  const cat = categorize(event.type);
  const p = event.payload;
  if (p === null || typeof p !== 'object') {
    return cat === 'other' ? event.type : `${event.type}`;
  }
  const obj = p as Record<string, unknown>;
  switch (cat) {
    case 'model_call': {
      const model = obj.model;
      const provider = obj.provider;
      const tokens = obj.tokensIn ?? obj.tokens_in;
      const text = obj.text ?? obj.delta ?? obj.content;
      const head: string[] = [];
      if (typeof provider === 'string') head.push(provider);
      if (typeof model === 'string') head.push(model);
      if (typeof tokens === 'number') head.push(`${tokens} in`);
      if (typeof text === 'string' && text.length > 0) head.push(JSON.stringify(text.slice(0, 80)));
      return head.length === 0 ? oneLine(p) : head.join(' · ');
    }
    case 'tool_call': {
      const name = obj.name ?? obj.tool;
      const args = obj.args ?? obj.input ?? obj.arguments;
      if (typeof name === 'string') {
        return args === undefined ? name : `${name}(${oneLine(args).slice(0, 120)})`;
      }
      return oneLine(p);
    }
    case 'error': {
      const msg = obj.message ?? obj.reason ?? obj.code;
      if (typeof msg === 'string') return msg.slice(0, 240);
      return oneLine(p);
    }
    case 'span': {
      const name = obj.name ?? obj.kind ?? obj.spanPath;
      if (typeof name === 'string') return name;
      return oneLine(p);
    }
    default:
      return oneLine(p);
  }
}

function oneLine(p: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(p);
  } catch {
    s = String(p);
  }
  return s.length > 240 ? `${s.slice(0, 237)}...` : s;
}

// ---------------------------------------------------------------------------
// Token-level streaming buffer (model_delta).
// ---------------------------------------------------------------------------

/**
 * Reducer-style state for the per-(model+span) streaming-text panels.
 *
 * Each `model_delta` event carries `delta` text and a model+span
 * identity. We accumulate per stream id; on `finished: true` we lock
 * the entry so the UI shows a checkmark.
 *
 * The reducer is pure so we can pin behaviour without React.
 */
export interface StreamingBuffer {
  readonly streams: ReadonlyArray<StreamingEntry>;
}

export interface StreamingEntry {
  readonly id: string;
  readonly model: string;
  readonly spanPath: string;
  readonly text: string;
  readonly finished: boolean;
}

export const emptyStreamingBuffer: StreamingBuffer = { streams: [] };

export function reduceStreamingBuffer(state: StreamingBuffer, event: LiveEvent): StreamingBuffer {
  if (event.type !== 'model_delta' && event.type !== 'model_stream_finished') {
    return state;
  }
  const p = event.payload;
  if (p === null || typeof p !== 'object') return state;
  const obj = p as Record<string, unknown>;
  const model = typeof obj.model === 'string' ? obj.model : 'model';
  const spanPath = spanPathOf(event);
  const id = `${model}:${spanPath}`;
  const delta =
    typeof obj.delta === 'string' ? obj.delta : typeof obj.text === 'string' ? obj.text : '';
  const finished = event.type === 'model_stream_finished' || obj.finished === true;
  const next = state.streams.slice();
  const existingIdx = next.findIndex((s) => s.id === id);
  if (existingIdx === -1) {
    next.push({ id, model, spanPath, text: delta, finished });
    return { streams: next };
  }
  const existing = next[existingIdx];
  if (existing === undefined) return state;
  next[existingIdx] = {
    ...existing,
    text: existing.text + delta,
    finished: existing.finished || finished,
  };
  return { streams: next };
}
