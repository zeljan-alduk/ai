'use client';

/**
 * Wave-13 live event tail — client island for `/runs/[id]/live`.
 *
 * Subscribes to the API SSE endpoint at `/v1/sse/events?stream=run/<id>`
 * via the browser's built-in `EventSource` (no library needed; built-in
 * exponential-backoff reconnect is handled for us).
 *
 * Visual:
 *   - filter chips at the top (model/tool/span/error + agent dropdown)
 *   - a "stick to bottom" toggle, "pause" toggle, "clear" action
 *   - terminal-style monospace stream — each row carries a colored
 *     event-type badge, span path, and a one-line summary
 *   - a token-streaming sidebar that displays per-(model, span)
 *     streaming text as it arrives, with a soft cursor and a
 *     check-mark on completion
 *
 * The component holds a buffer of up to 1,000 events; older events
 * scroll off the top so a long-running run doesn't blow out browser
 * memory. The bell-popover does NOT subscribe here — it has its own
 * SSE stream on `?stream=notifications`.
 *
 * LLM-agnostic: we color event categories, never providers.
 */

import {
  type LiveEvent,
  type LiveEventCategory,
  type LiveFilters,
  agentNameOf,
  applyFilters,
  categorize,
  emptyStreamingBuffer,
  reduceStreamingBuffer,
  spanPathOf,
  summarize,
} from '@/components/runs/live-tail-filters';
import { Button } from '@/components/ui/button';
import { formatAbsolute, formatRelativeTime } from '@/lib/format';
import type { RunStatus } from '@aldo-ai/api-contract';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const MAX_BUFFERED_EVENTS = 1_000;

const CATEGORY_COLORS: Record<LiveEventCategory, string> = {
  model_call: 'bg-sky-100 text-sky-800 border-sky-200',
  tool_call: 'bg-violet-100 text-violet-800 border-violet-200',
  span: 'bg-slate-100 text-slate-700 border-slate-200',
  error: 'bg-red-100 text-red-800 border-red-200',
  other: 'bg-zinc-100 text-zinc-600 border-zinc-200',
};

const CATEGORY_LABELS: Record<LiveEventCategory, string> = {
  model_call: 'model',
  tool_call: 'tool',
  span: 'span',
  error: 'error',
  other: 'other',
};

export interface LiveTailProps {
  readonly runId: string;
  readonly initialStatus: RunStatus;
}

export function LiveTail({ runId, initialStatus }: LiveTailProps) {
  const [events, setEvents] = useState<readonly LiveEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [filterCategories, setFilterCategories] = useState<ReadonlySet<LiveEventCategory>>(
    new Set(),
  );
  const [filterAgent, setFilterAgent] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'connecting' | 'open' | 'closed'>(
    'connecting',
  );

  // Pause buffer — events arriving while paused stash here until the
  // user un-pauses, then they all flush at once.
  const pauseBuffer = useRef<LiveEvent[]>([]);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const tailRef = useRef<HTMLDivElement | null>(null);

  // Open the SSE channel.
  useEffect(() => {
    if (initialStatus !== 'running' && initialStatus !== 'queued') {
      // Run already terminal — no live events to stream.
      setConnectionState('closed');
      return undefined;
    }
    const url = `/api/auth-proxy/v1/sse/events?stream=${encodeURIComponent(`run/${runId}`)}`;
    const es = new EventSource(url, { withCredentials: true });
    setConnectionState('connecting');
    es.addEventListener('open', () => setConnectionState('open'));
    es.addEventListener('error', () => setConnectionState('closed'));
    const onEvent = (e: MessageEvent<string>) => {
      let data: unknown = null;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (data === null || typeof data !== 'object') return;
      const ev: LiveEvent = {
        id:
          (data as { id?: unknown }).id !== undefined
            ? String((data as { id: string }).id)
            : Math.random().toString(36).slice(2, 12),
        runId: String((data as { runId?: unknown }).runId ?? runId),
        type: String((data as { type?: unknown }).type ?? 'unknown'),
        at:
          typeof (data as { at?: unknown }).at === 'string'
            ? String((data as { at: string }).at)
            : new Date().toISOString(),
        payload: (data as { payload?: unknown }).payload ?? data,
      };
      // Read pause state through a ref so the SSE subscription doesn't
      // tear down + rebuild on every pause toggle.
      if (pausedRef.current) {
        pauseBuffer.current.push(ev);
      } else {
        setEvents((prev) => appendCapped(prev, ev));
      }
    };
    es.addEventListener('run_event', onEvent as EventListener);
    return () => {
      es.close();
    };
  }, [runId, initialStatus]);

  // Stick-to-bottom: every time `events` grows, scroll the tail.
  // We intentionally read `events` only as a trigger; the scroll target
  // is the ref. Biome wants the dep list trimmed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: events is the trigger, not an input
  useEffect(() => {
    if (!stickToBottom) return;
    const node = tailRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [events, stickToBottom]);

  // Streaming buffer for `model_delta` events — pure reducer over
  // every event we've seen.
  const streamingBuffer = useMemo(() => {
    let state = emptyStreamingBuffer;
    for (const ev of events) state = reduceStreamingBuffer(state, ev);
    return state;
  }, [events]);

  const filters: LiveFilters = useMemo(
    () => ({ categories: filterCategories, agentName: filterAgent }),
    [filterCategories, filterAgent],
  );
  const visibleEvents = useMemo(() => applyFilters(events, filters), [events, filters]);

  const knownAgents = useMemo(() => {
    const set = new Set<string>();
    for (const ev of events) {
      const name = agentNameOf(ev);
      if (name !== null) set.add(name);
    }
    return Array.from(set).sort();
  }, [events]);

  const togglePaused = useCallback(() => {
    setPaused((prev) => {
      if (prev) {
        // Flush pause buffer.
        const buffered = pauseBuffer.current.splice(0, pauseBuffer.current.length);
        if (buffered.length > 0) {
          setEvents((current) => {
            let next = current;
            for (const ev of buffered) next = appendCapped(next, ev);
            return next;
          });
        }
      }
      return !prev;
    });
  }, []);

  const toggleCategory = useCallback((cat: LiveEventCategory) => {
    setFilterCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const clearStream = useCallback(() => {
    setEvents([]);
    pauseBuffer.current = [];
  }, []);

  const onCopyLine = useCallback((ev: LiveEvent) => {
    const line = `${ev.at} ${ev.type} ${spanPathOf(ev)} ${summarize(ev)}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(line).catch(() => undefined);
    }
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {/* Filter chips + actions */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
        <span className="text-[11px] uppercase tracking-wider text-slate-500">events</span>
        {(['model_call', 'tool_call', 'span', 'error'] as LiveEventCategory[]).map((cat) => {
          const active = filterCategories.has(cat);
          return (
            <button
              key={cat}
              type="button"
              onClick={() => toggleCategory(cat)}
              className={`rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide transition-colors ${CATEGORY_COLORS[cat]} ${
                active ? 'ring-2 ring-offset-1 ring-slate-700' : 'opacity-70 hover:opacity-100'
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          );
        })}
        {knownAgents.length > 0 ? (
          <select
            className="ml-2 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs"
            value={filterAgent ?? ''}
            onChange={(e) => setFilterAgent(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">all agents</option>
            {knownAgents.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="ml-auto flex items-center gap-2 text-xs">
          <ConnectionDot state={connectionState} />
          <label className="inline-flex items-center gap-1 text-slate-600">
            <input
              type="checkbox"
              checked={stickToBottom}
              onChange={(e) => setStickToBottom(e.target.checked)}
            />
            stick to bottom
          </label>
          <Button type="button" variant="ghost" size="sm" onClick={togglePaused}>
            {paused ? `Resume (${pauseBuffer.current.length})` : 'Pause'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearStream}>
            Clear
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
        {/* Terminal stream */}
        <div
          ref={tailRef}
          className="h-[600px] overflow-y-auto rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-[12px] leading-snug text-slate-100"
        >
          {visibleEvents.length === 0 ? (
            <div className="text-slate-500">
              {connectionState === 'connecting'
                ? 'Connecting to live stream…'
                : connectionState === 'closed'
                  ? 'Stream closed. Reload to reconnect.'
                  : 'Waiting for events…'}
            </div>
          ) : (
            visibleEvents.map((ev) => <LiveLine key={ev.id} ev={ev} onCopy={onCopyLine} />)
          )}
        </div>

        {/* Streaming model panels */}
        <div className="h-[600px] overflow-y-auto rounded-md border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Model streams
          </h3>
          {streamingBuffer.streams.length === 0 ? (
            <p className="text-xs text-slate-500">
              No model deltas yet. Tokens stream in here as the engine emits them.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {streamingBuffer.streams.map((s) => (
                <li key={s.id} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-500">
                    <span>
                      {s.model}
                      {s.spanPath ? (
                        <span className="ml-1 text-slate-400">· {s.spanPath}</span>
                      ) : null}
                    </span>
                    {s.finished ? (
                      <span className="text-emerald-700" aria-label="finished">
                        ✓
                      </span>
                    ) : (
                      <span className="animate-pulse text-slate-400">▋</span>
                    )}
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-800">
                    {s.text}
                    {s.finished ? null : <span className="animate-pulse text-slate-400">▋</span>}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveLine({ ev, onCopy }: { ev: LiveEvent; onCopy: (ev: LiveEvent) => void }) {
  const cat = categorize(ev.type);
  const path = spanPathOf(ev);
  const summary = summarize(ev);
  return (
    <div className="group flex items-baseline gap-2 py-0.5 hover:bg-slate-900">
      <span className="shrink-0 text-slate-500" title={formatAbsolute(ev.at)}>
        {formatRelativeTime(ev.at)}
      </span>
      <span
        className={`inline-flex items-center rounded px-1 py-0 text-[10px] font-semibold uppercase tracking-wider ${CATEGORY_COLORS[cat]}`}
      >
        {CATEGORY_LABELS[cat]}
      </span>
      <span className="shrink-0 text-emerald-300">{ev.type}</span>
      {path ? <span className="shrink-0 text-slate-400">{path}</span> : null}
      <span className="flex-1 truncate text-slate-100">{summary}</span>
      <button
        type="button"
        onClick={() => onCopy(ev)}
        className="invisible shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase text-slate-400 hover:bg-slate-800 hover:text-slate-100 group-hover:visible"
        title="Copy line"
      >
        copy
      </button>
    </div>
  );
}

function ConnectionDot({ state }: { state: 'connecting' | 'open' | 'closed' }) {
  const cls =
    state === 'open'
      ? 'bg-emerald-500'
      : state === 'connecting'
        ? 'bg-amber-500 animate-pulse'
        : 'bg-slate-400';
  return (
    <span title={`SSE: ${state}`} className="inline-flex items-center gap-1 text-slate-500">
      <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />
      {state}
    </span>
  );
}

/** Append `ev` to `prev`, dropping the oldest entries past the cap. */
function appendCapped(prev: readonly LiveEvent[], ev: LiveEvent): readonly LiveEvent[] {
  if (prev.length < MAX_BUFFERED_EVENTS) return [...prev, ev];
  return [...prev.slice(prev.length - MAX_BUFFERED_EVENTS + 1), ev];
}
