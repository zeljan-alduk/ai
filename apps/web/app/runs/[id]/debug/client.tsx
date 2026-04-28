'use client';

/**
 * Client shell for the debugger. Owns:
 *  - the live event buffer (seeded from the server-fetched RunDetail)
 *  - the SSE subscription (mount-only)
 *  - the currently selected event index
 *  - breakpoints + the latest paused checkpoint id
 *  - command dispatch + toast/inline notes
 *
 * The SSE stream is the source of truth for new events; we deliberately
 * do not introduce a state library. `useReducer` keeps the buffer logic
 * in one place but everything else is plain `useState`.
 */

import { StatusBadge } from '@/components/badge';
import {
  type Breakpoint,
  cancelRun,
  continueRun,
  createBreakpoint,
  deleteBreakpoint,
  editAndResume,
  listBreakpoints,
  openDebuggerStream,
  swapModel,
  toggleBreakpoint,
} from '@/lib/debugger-client';
import { formatUsd } from '@/lib/format';
import type {
  DebugRunEvent,
  ListModelsResponse,
  ModelSummary,
  RunDetail,
  RunEvent,
} from '@aldo-ai/api-contract';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ControlsPane } from './controls';
import { EditMessageDialog } from './edit-message-dialog';
import { StatePane } from './state';
import { SwapModelDialog } from './swap-model-dialog';
import { type TimelineEntry, TimelinePane } from './timeline';

type ConnStatus = 'connecting' | 'open' | 'closed' | 'reconnecting';
type Toast = { kind: 'ok' | 'err'; text: string; at: number };

type LiveState = {
  /** Server-side events seeded from RunDetail (immutable). */
  seeded: TimelineEntry[];
  /** Live events appended via SSE (mutable across renders). */
  live: TimelineEntry[];
  /** Latest paused checkpoint id, if the run is currently paused. */
  pausedCheckpointId: string | null;
  /** Latest finishReason, if completed/cancelled/error came over the wire. */
  terminalReason: string | null;
};

type LiveAction = {
  type: 'append';
  entry: TimelineEntry;
  /** `undefined` = "no change", `null` = "clear it". */
  pausedCheckpointId: string | null | undefined;
  terminalReason: string | null | undefined;
};

function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case 'append':
      return {
        ...state,
        live: [...state.live, action.entry],
        pausedCheckpointId:
          action.pausedCheckpointId !== undefined
            ? action.pausedCheckpointId
            : state.pausedCheckpointId,
        terminalReason:
          action.terminalReason !== undefined ? action.terminalReason : state.terminalReason,
      };
  }
}

function seedEntries(events: RunEvent[]): TimelineEntry[] {
  return events.map((ev, i) => ({
    key: `seed-${ev.id ?? i}`,
    source: 'seed',
    type: ev.type,
    at: ev.at,
    payload: ev.payload,
  }));
}

function liveToTimeline(ev: DebugRunEvent, idx: number): TimelineEntry {
  return {
    key: `live-${idx}-${ev.kind}-${ev.at}`,
    source: 'live',
    type: ev.kind,
    at: ev.at,
    payload: ev,
  };
}

export function DebuggerClient({
  runId,
  initialRun,
  models,
}: {
  runId: string;
  initialRun: RunDetail;
  models: ListModelsResponse['models'];
}) {
  const router = useRouter();

  const [state, dispatch] = useReducer(liveReducer, undefined, () => ({
    seeded: seedEntries(initialRun.events),
    live: [],
    pausedCheckpointId: null,
    terminalReason: null,
  }));

  const allEntries = useMemo(() => [...state.seeded, ...state.live], [state.seeded, state.live]);

  const [selectedIdx, setSelectedIdx] = useState<number>(() =>
    initialRun.events.length > 0 ? initialRun.events.length - 1 : -1,
  );
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const [conn, setConn] = useState<ConnStatus>('connecting');
  const [toast, setToast] = useState<Toast | null>(null);

  const [editing, setEditing] = useState<{ messageIndex: number; currentText: string } | null>(
    null,
  );
  const [swapping, setSwapping] = useState(false);

  const liveCounter = useRef(0);

  /* -------------------- SSE subscription (mount-only) -------------------- */
  useEffect(() => {
    const stream = openDebuggerStream(runId, {
      onStatusChange: setConn,
      onEvent: (ev) => {
        const idx = liveCounter.current++;
        const entry = liveToTimeline(ev, idx);
        let pausedCheckpointId: string | null | undefined = undefined;
        let terminalReason: string | null | undefined = undefined;
        if (ev.kind === 'paused') {
          pausedCheckpointId = ev.checkpointId;
        } else if (ev.kind === 'resumed') {
          pausedCheckpointId = null;
        } else if (ev.kind === 'completed') {
          terminalReason = ev.finishReason;
          pausedCheckpointId = null;
        } else if (ev.kind === 'error') {
          terminalReason = `error: ${ev.message}`;
        }
        dispatch({ type: 'append', entry, pausedCheckpointId, terminalReason });
      },
      onError: (err) => {
        // Non-fatal — the client auto-reconnects. Surface latest as toast.
        setToast({ kind: 'err', text: err.message, at: Date.now() });
      },
    });
    return () => stream.close();
  }, [runId]);

  /* ------------------------- Breakpoints (initial) ----------------------- */
  useEffect(() => {
    let cancelled = false;
    listBreakpoints(runId)
      .then((res) => {
        if (!cancelled) setBreakpoints(res.breakpoints);
      })
      .catch(() => {
        // The endpoint may not yet exist; silent — toggling will surface
        // the real error.
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  /* -------------------------- Toast auto-dismiss ------------------------- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5_000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ----------------------------- Selection ------------------------------- */
  // Auto-advance selection to the newest entry when the user has not
  // overridden it. We treat "user override" as: selectedIdx is not the
  // last index from the previous render.
  const prevLenRef = useRef(allEntries.length);
  const userOverrodeRef = useRef(false);
  useEffect(() => {
    const prevLen = prevLenRef.current;
    const newLen = allEntries.length;
    if (newLen > prevLen) {
      if (!userOverrodeRef.current) {
        setSelectedIdx(newLen - 1);
      }
    }
    prevLenRef.current = newLen;
  }, [allEntries.length]);

  const handleSelect = useCallback(
    (idx: number) => {
      userOverrodeRef.current = idx !== allEntries.length - 1;
      setSelectedIdx(idx);
    },
    [allEntries.length],
  );

  /* ----------------------------- Commands -------------------------------- */
  const handleContinue = useCallback(
    async (mode: 'run' | 'step') => {
      try {
        await continueRun(runId, { mode });
        setToast({
          kind: 'ok',
          text: mode === 'step' ? 'Stepped one event.' : 'Run resumed.',
          at: Date.now(),
        });
      } catch (err) {
        setToast({ kind: 'err', text: errMsg(err), at: Date.now() });
      }
    },
    [runId],
  );

  const handleCancel = useCallback(async () => {
    try {
      await cancelRun(runId);
      setToast({ kind: 'ok', text: 'Cancel requested.', at: Date.now() });
    } catch (err) {
      setToast({ kind: 'err', text: errMsg(err), at: Date.now() });
    }
  }, [runId]);

  const handleToggleBreakpoint = useCallback(
    async (entry: TimelineEntry) => {
      // For a tool_call timeline entry, the breakpoint matches the tool
      // name with kind='before_tool_call'. Find an existing one or
      // create a new one.
      const tool = extractToolName(entry);
      if (!tool) return;
      const existing = breakpoints.find((b) => b.kind === 'before_tool_call' && b.match === tool);
      try {
        if (existing) {
          const next = await toggleBreakpoint(runId, existing.id, !existing.enabled);
          setBreakpoints((prev) =>
            prev.map((b) => (b.id === next.breakpoint.id ? next.breakpoint : b)),
          );
        } else {
          const next = await createBreakpoint(runId, {
            kind: 'before_tool_call',
            match: tool,
            enabled: true,
          });
          setBreakpoints((prev) => [...prev, next.breakpoint]);
        }
        setToast({
          kind: 'ok',
          text: `Breakpoint ${existing ? 'toggled' : 'set'} on ${tool}.`,
          at: Date.now(),
        });
      } catch (err) {
        setToast({ kind: 'err', text: errMsg(err), at: Date.now() });
      }
    },
    [breakpoints, runId],
  );

  const handleClearBreakpoint = useCallback(
    async (bpId: string) => {
      try {
        await deleteBreakpoint(runId, bpId);
        setBreakpoints((prev) => prev.filter((b) => b.id !== bpId));
      } catch (err) {
        setToast({ kind: 'err', text: errMsg(err), at: Date.now() });
      }
    },
    [runId],
  );

  const handleEditAndResume = useCallback(
    async (newText: string) => {
      if (!editing) return;
      const checkpointId = state.pausedCheckpointId ?? latestCheckpointId(allEntries);
      if (!checkpointId) {
        setToast({ kind: 'err', text: 'No checkpoint available to edit from.', at: Date.now() });
        return;
      }
      try {
        const res = await editAndResume(runId, {
          checkpointId,
          messageIndex: editing.messageIndex,
          newText,
        });
        setEditing(null);
        setToast({ kind: 'ok', text: `Resumed as ${res.newRunId.slice(0, 12)}.`, at: Date.now() });
        router.push(`/runs/${encodeURIComponent(res.newRunId)}/debug`);
      } catch (err) {
        setToast({ kind: 'err', text: errMsg(err), at: Date.now() });
      }
    },
    [allEntries, editing, router, runId, state.pausedCheckpointId],
  );

  const handleSwapModel = useCallback(
    async (sel: { capabilityClass?: string; provider?: string; model?: string }) => {
      const checkpointId = state.pausedCheckpointId ?? latestCheckpointId(allEntries);
      if (!checkpointId) {
        setToast({ kind: 'err', text: 'No checkpoint available to swap from.', at: Date.now() });
        return;
      }
      try {
        const res = await swapModel(runId, { checkpointId, ...sel });
        setSwapping(false);
        setToast({
          kind: 'ok',
          text: `Swapped — comparing ${runId.slice(0, 8)} vs ${res.newRunId.slice(0, 8)}.`,
          at: Date.now(),
        });
        // Land on the side-by-side compare view rather than the new run
        // alone — the whole point of swap-model is to see the diff. The
        // compare page tolerates an in-progress B run; events fill in as
        // the new run streams.
        if (res.newRunId !== runId) {
          router.push(
            `/runs/compare?a=${encodeURIComponent(runId)}&b=${encodeURIComponent(res.newRunId)}`,
          );
        }
      } catch (err) {
        setToast({ kind: 'err', text: errMsg(err), at: Date.now() });
      }
    },
    [allEntries, router, runId, state.pausedCheckpointId],
  );

  const selected =
    selectedIdx >= 0 && selectedIdx < allEntries.length ? (allEntries[selectedIdx] ?? null) : null;

  const currentCapabilityClass = useMemo(() => {
    // Best-effort: pick the capability class of the most-recently used
    // model on this run, by matching the run's lastProvider/lastModel
    // against the gateway's model list.
    if (!initialRun.lastModel) return undefined;
    const m = models.find(
      (m: ModelSummary) =>
        m.id === initialRun.lastModel ||
        (m.provider === initialRun.lastProvider && m.id === initialRun.lastModel),
    );
    return m?.capabilityClass;
  }, [initialRun.lastModel, initialRun.lastProvider, models]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header strip */}
      <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-slate-200 bg-white px-5 py-3 text-sm">
        <Field label="Run">
          <span className="font-mono text-xs text-slate-700">{runId}</span>
        </Field>
        <Field label="Status">
          <StatusBadge status={initialRun.status} />
        </Field>
        <Field label="Cost">
          <span className="font-mono tabular-nums text-slate-900">
            {formatUsd(initialRun.totalUsd)}
          </span>
        </Field>
        <Field label="Agent">
          <span className="font-medium text-slate-900">{initialRun.agentName}</span>
          <span className="ml-1 text-xs text-slate-500">{initialRun.agentVersion}</span>
        </Field>
        <Field label="Stream">
          <ConnDot status={conn} />
        </Field>
        {state.terminalReason ? (
          <Field label="Finished">
            <span className="text-xs text-slate-700">{state.terminalReason}</span>
          </Field>
        ) : null}
        {initialRun.parentRunId ? (
          <Field label="Forked from">
            <a
              href={`/runs/compare?a=${encodeURIComponent(initialRun.parentRunId)}&b=${encodeURIComponent(runId)}`}
              className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-xs text-amber-800 hover:bg-amber-100"
            >
              {initialRun.parentRunId.slice(0, 12)} — compare ↔
            </a>
          </Field>
        ) : null}
      </section>

      {toast ? (
        <output
          className={`block rounded-md border px-3 py-2 text-sm ${
            toast.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {toast.text}
        </output>
      ) : null}

      <div className="flex min-h-[60vh] gap-4">
        <TimelinePane
          entries={allEntries}
          selectedIdx={selectedIdx}
          pausedCheckpointId={state.pausedCheckpointId}
          breakpoints={breakpoints}
          onSelect={handleSelect}
          onToggleBreakpoint={handleToggleBreakpoint}
          onClearBreakpoint={handleClearBreakpoint}
        />
        <StatePane
          entry={selected}
          onEditMessage={(messageIndex, currentText) => setEditing({ messageIndex, currentText })}
        />
        <ControlsPane
          paused={state.pausedCheckpointId !== null}
          terminal={state.terminalReason !== null}
          {...(currentCapabilityClass !== undefined ? { currentCapabilityClass } : {})}
          onContinue={() => {
            void handleContinue('run');
          }}
          onStep={() => {
            void handleContinue('step');
          }}
          onSwap={() => setSwapping(true)}
          onCancel={() => {
            void handleCancel();
          }}
        />
      </div>

      {editing ? (
        <EditMessageDialog
          initialText={editing.currentText}
          onCancel={() => setEditing(null)}
          onConfirm={handleEditAndResume}
        />
      ) : null}
      {swapping ? (
        <SwapModelDialog
          models={models}
          {...(currentCapabilityClass !== undefined ? { currentCapabilityClass } : {})}
          onCancel={() => setSwapping(false)}
          onConfirm={(sel) => {
            void handleSwapModel(sel);
          }}
        />
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      <span className="mt-0.5">{children}</span>
    </div>
  );
}

function ConnDot({ status }: { status: ConnStatus }) {
  const color =
    status === 'open'
      ? 'bg-emerald-500'
      : status === 'connecting' || status === 'reconnecting'
        ? 'bg-amber-500'
        : 'bg-slate-400';
  const label =
    status === 'open'
      ? 'connected'
      : status === 'connecting'
        ? 'connecting'
        : status === 'reconnecting'
          ? 'reconnecting'
          : 'closed';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
      {label}
    </span>
  );
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function extractToolName(entry: TimelineEntry): string | null {
  if (entry.type !== 'tool_call') return null;
  const p = entry.payload as { tool?: unknown; name?: unknown } | null | undefined;
  if (!p) return null;
  if (typeof p.tool === 'string') return p.tool;
  if (typeof p.name === 'string') return p.name;
  return null;
}

function latestCheckpointId(entries: TimelineEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e) continue;
    if (e.type === 'paused' || e.type === 'checkpoint') {
      const p = e.payload as { checkpointId?: unknown } | null | undefined;
      if (p && typeof p.checkpointId === 'string') return p.checkpointId;
    }
  }
  return null;
}
