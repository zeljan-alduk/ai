'use client';

/**
 * Left pane: scrollable list of run events. Auto-scrolls to the newest
 * entry unless the user has scrolled up. Each `tool_call` row gets a
 * breakpoint toggle.
 */

import { NeutralBadge } from '@/components/badge';
import type { Breakpoint } from '@/lib/debugger-client';
import { formatAbsolute } from '@/lib/format';
import { useEffect, useRef } from 'react';

export type TimelineEntry = {
  key: string;
  source: 'seed' | 'live';
  /** RunEvent.type or DebugRunEvent.kind — both are short opaque strings. */
  type: string;
  at: string;
  /** Original payload (RunEvent.payload for seed; DebugRunEvent for live). */
  payload: unknown;
};

const TYPE_COLOR: Record<string, string> = {
  message: 'bg-slate-100 text-slate-800 border-slate-200',
  tool_call: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  tool_result: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  checkpoint: 'bg-amber-100 text-amber-800 border-amber-200',
  paused: 'bg-amber-200 text-amber-900 border-amber-300',
  resumed: 'bg-sky-100 text-sky-800 border-sky-200',
  completed: 'bg-emerald-200 text-emerald-900 border-emerald-300',
  error: 'bg-red-100 text-red-800 border-red-200',
  policy_decision: 'bg-zinc-100 text-zinc-800 border-zinc-200',
  'run.started': 'bg-sky-100 text-sky-800 border-sky-200',
  'run.completed': 'bg-emerald-200 text-emerald-900 border-emerald-300',
  'run.cancelled': 'bg-zinc-200 text-zinc-800 border-zinc-300',
};

export function TimelinePane({
  entries,
  selectedIdx,
  pausedCheckpointId,
  breakpoints,
  onSelect,
  onToggleBreakpoint,
  onClearBreakpoint,
}: {
  entries: TimelineEntry[];
  selectedIdx: number;
  pausedCheckpointId: string | null;
  breakpoints: Breakpoint[];
  onSelect: (idx: number) => void;
  onToggleBreakpoint: (entry: TimelineEntry) => void;
  onClearBreakpoint: (bpId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  // Track user scroll: if they scroll up, stop auto-scrolling.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
      stickToBottomRef.current = distanceFromBottom < 24;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll on new entries when sticking. We intentionally key on
  // `entries.length` (not the list itself) because we only need to react
  // to additions, not in-place mutations.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <aside className="flex w-80 shrink-0 flex-col rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span>Timeline ({entries.length})</span>
        {breakpoints.length > 0 ? (
          <span className="text-[10px] font-normal normal-case text-slate-500">
            {breakpoints.filter((b) => b.enabled).length}/{breakpoints.length} bp
          </span>
        ) : null}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-500">Waiting for events…</div>
        ) : (
          <ol>
            {entries.map((entry, idx) => {
              const selected = idx === selectedIdx;
              const isPause =
                entry.type === 'paused' &&
                pausedCheckpointId !== null &&
                checkpointIdOf(entry) === pausedCheckpointId;
              const toolName = entry.type === 'tool_call' ? extractTool(entry) : null;
              const bp = toolName
                ? breakpoints.find((b) => b.kind === 'before_tool_call' && b.match === toolName)
                : null;
              return (
                <li
                  key={entry.key}
                  className={`group border-b border-slate-100 last:border-b-0 ${
                    selected ? 'bg-slate-100' : 'hover:bg-slate-50'
                  } ${isPause ? 'border-l-2 border-l-amber-500' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(idx)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left"
                  >
                    <span
                      className="w-14 shrink-0 font-mono text-[10px] text-slate-500"
                      title={entry.at}
                    >
                      {formatAbsolute(entry.at).slice(11, 19)}
                    </span>
                    <span className="flex-1">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          TYPE_COLOR[entry.type] ?? 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {entry.type}
                      </span>
                      <span className="ml-2 text-xs text-slate-700">{summarizeOneLine(entry)}</span>
                    </span>
                  </button>
                  {entry.type === 'tool_call' ? (
                    <div className="flex items-center justify-end gap-2 px-3 pb-2">
                      <button
                        type="button"
                        onClick={() => onToggleBreakpoint(entry)}
                        className={`rounded border px-2 py-0.5 text-[11px] ${
                          bp?.enabled
                            ? 'border-red-300 bg-red-50 text-red-700'
                            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                        title={
                          bp?.enabled
                            ? 'Breakpoint enabled — click to disable'
                            : 'Set breakpoint before this tool'
                        }
                      >
                        {bp?.enabled ? 'BP on' : 'Set BP'}
                      </button>
                      {bp ? (
                        <button
                          type="button"
                          onClick={() => onClearBreakpoint(bp.id)}
                          className="text-[11px] text-slate-500 hover:text-slate-700"
                          title="Clear breakpoint"
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {/* If the user scrolled up, surface a hint */}
      <ScrollHint scrollRef={scrollRef} />
    </aside>
  );
}

function ScrollHint({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  // Lightweight: nothing fancy — leave as a placeholder for future "jump
  // to newest" affordance. Keeping the hook structure so tests can find it.
  return null;
}

function summarizeOneLine(entry: TimelineEntry): string {
  const p = entry.payload as Record<string, unknown> | null | undefined;
  if (!p) return '';
  if (entry.type === 'message') {
    const role = typeof p.role === 'string' ? p.role : 'message';
    const text = typeof p.text === 'string' ? p.text : '';
    return `${role}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`;
  }
  if (entry.type === 'tool_call') {
    const tool = extractTool(entry);
    return tool ? `→ ${tool}` : 'tool call';
  }
  if (entry.type === 'tool_result') {
    return p.isError ? 'error result' : 'result';
  }
  if (entry.type === 'paused') {
    const reason = typeof p.reason === 'string' ? p.reason : '';
    return reason || 'paused';
  }
  if (entry.type === 'checkpoint') {
    const cid = typeof p.checkpointId === 'string' ? p.checkpointId : '';
    return cid ? `cp ${cid.slice(0, 8)}` : 'checkpoint';
  }
  if (entry.type === 'error') {
    return typeof p.message === 'string' ? p.message.slice(0, 60) : 'error';
  }
  if (entry.type === 'completed' || entry.type === 'run.completed') {
    return typeof p.finishReason === 'string' ? p.finishReason : 'done';
  }
  return '';
}

function extractTool(entry: TimelineEntry): string | null {
  const p = entry.payload as { tool?: unknown; name?: unknown } | null | undefined;
  if (!p) return null;
  if (typeof p.tool === 'string') return p.tool;
  if (typeof p.name === 'string') return p.name;
  return null;
}

function checkpointIdOf(entry: TimelineEntry): string | null {
  const p = entry.payload as { checkpointId?: unknown } | null | undefined;
  if (p && typeof p.checkpointId === 'string') return p.checkpointId;
  return null;
}
