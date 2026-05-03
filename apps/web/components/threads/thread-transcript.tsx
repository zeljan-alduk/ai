/**
 * <ThreadTranscript> — wave-19 (Frontend Engineer).
 *
 * Renders a chat-style transcript for a single thread. The shape is
 * deliberately payload-driven rather than role-locked: every event in
 * the timeline picks a renderer based on its `type` (and, for
 * `message`, on the payload shape).
 *
 * Per-run striping: the transcript groups consecutive events sharing a
 * runId into a single "run section" with a thin left rail. Each run
 * section is a deep link to /runs/[id] so an operator can drill into
 * the full run detail (timeline / events / tree / replay) from any
 * point in the conversation.
 *
 * No client state — pure presentation. The page above hydrates this
 * with the full timeline; the polling tail upgrade lives in a future
 * wave.
 */

import { StatusBadge } from '@/components/badge';
import { Card } from '@/components/ui/card';
import { formatDuration, formatRelativeTime, formatUsd } from '@/lib/format';
import type { RunSummary, ThreadTimelineEvent } from '@aldo-ai/api-contract';
import Link from 'next/link';

interface ThreadTranscriptProps {
  readonly runs: readonly RunSummary[];
  readonly events: readonly ThreadTimelineEvent[];
}

export function ThreadTranscript({ runs, events }: ThreadTranscriptProps) {
  const runIndex = new Map(runs.map((r) => [r.id, r] as const));
  // Group events into per-run blocks, preserving timeline order.
  const blocks: Array<{ runId: string; events: ThreadTimelineEvent[] }> = [];
  for (const ev of events) {
    const tail = blocks[blocks.length - 1];
    if (tail !== undefined && tail.runId === ev.runId) {
      tail.events.push(ev);
    } else {
      blocks.push({ runId: ev.runId, events: [ev] });
    }
  }

  if (blocks.length === 0) {
    return (
      <Card className="px-6 py-12 text-center text-sm text-fg-muted">
        This thread has runs but no events yet. Events arrive as the runtime emits them.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, idx) => {
        const run = runIndex.get(block.runId);
        return (
          <RunSection
            key={`${block.runId}-${idx}`}
            run={run}
            runId={block.runId}
            events={block.events}
            turnNumber={idx + 1}
          />
        );
      })}
    </div>
  );
}

function RunSection({
  run,
  runId,
  events,
  turnNumber,
}: {
  run: RunSummary | undefined;
  runId: string;
  events: readonly ThreadTimelineEvent[];
  turnNumber: number;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-bg-subtle px-4 py-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-fg/10 text-[11px] font-semibold tabular-nums text-fg">
          {turnNumber}
        </div>
        <span className="font-medium text-sm text-fg">
          {run?.agentName ?? events[0]?.agentName ?? 'unknown agent'}
        </span>
        {run?.agentVersion ? (
          <span className="text-[11px] text-fg-faint">{run.agentVersion}</span>
        ) : null}
        {run !== undefined ? (
          <>
            <StatusBadge status={run.status} />
            <span className="text-[11px] text-fg-muted" title={run.startedAt}>
              {formatRelativeTime(run.startedAt)}
            </span>
            <span aria-hidden="true" className="text-fg-faint">
              ·
            </span>
            <span className="text-[11px] text-fg-muted">{formatDuration(run.durationMs)}</span>
            <span aria-hidden="true" className="text-fg-faint">
              ·
            </span>
            <span className="font-mono text-[11px] tabular-nums text-fg-muted">
              {formatUsd(run.totalUsd)}
            </span>
          </>
        ) : null}
        <span className="ml-auto">
          <Link
            href={`/runs/${encodeURIComponent(runId)}`}
            className="rounded border border-border bg-bg px-2 py-0.5 text-[11px] text-fg-muted hover:bg-bg-subtle"
          >
            Open run →
          </Link>
        </span>
      </div>
      <div className="flex flex-col">
        {events.map((ev) => (
          <EventRow key={`${ev.runId}-${ev.eventId}`} event={ev} />
        ))}
      </div>
    </Card>
  );
}

function EventRow({ event }: { event: ThreadTimelineEvent }) {
  const role = roleFor(event);
  const text = extractText(event.payload);
  const ts = formatRelativeTime(event.at);

  if (event.type === 'tool_call') {
    return (
      <div className="border-b border-border px-4 py-3 last:border-b-0">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-fg-muted">
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
            tool call
          </span>
          <span>{toolNameFromPayload(event.payload)}</span>
          <span aria-hidden="true">·</span>
          <span title={event.at}>{ts}</span>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded border border-border bg-bg-subtle p-2 font-mono text-xs text-fg-muted">
          {payloadJson(event.payload)}
        </pre>
      </div>
    );
  }
  if (event.type === 'tool_result') {
    return (
      <div className="border-b border-border px-4 py-3 last:border-b-0">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-fg-muted">
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
            tool result
          </span>
          <span aria-hidden="true">·</span>
          <span title={event.at}>{ts}</span>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded border border-border bg-bg-subtle p-2 font-mono text-xs text-fg-muted">
          {payloadJson(event.payload)}
        </pre>
      </div>
    );
  }
  if (event.type === 'error') {
    return (
      <div className="border-b border-border px-4 py-3 last:border-b-0">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-danger">
          <span className="rounded bg-danger/10 px-1.5 py-0.5 font-medium text-danger">error</span>
          <span aria-hidden="true">·</span>
          <span title={event.at}>{ts}</span>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded border border-danger/30 bg-danger/5 p-2 font-mono text-xs text-fg">
          {text ?? payloadJson(event.payload)}
        </pre>
      </div>
    );
  }
  if (event.type === 'message') {
    const isUser = role === 'user';
    return (
      <div
        className={`flex border-b border-border px-4 py-3 last:border-b-0 ${
          isUser ? 'justify-end' : 'justify-start'
        }`}
      >
        <div
          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
            isUser
              ? 'bg-accent/10 text-fg ring-1 ring-accent/20'
              : 'bg-bg-subtle text-fg ring-1 ring-border'
          }`}
        >
          <div className="mb-1 flex items-center gap-2 text-[11px] text-fg-muted">
            <span className="font-medium uppercase tracking-wider">{role}</span>
            <span aria-hidden="true">·</span>
            <span title={event.at}>{ts}</span>
          </div>
          {text !== null ? (
            <div className="whitespace-pre-wrap break-words">{text}</div>
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs">
              {payloadJson(event.payload)}
            </pre>
          )}
        </div>
      </div>
    );
  }
  // Fallback for run.started / run.completed / checkpoint / policy_decision /
  // composite.* / routing.privacy_sensitive_resolved — render a compact
  // monospaced row so the operator can still see the event but it
  // doesn't dominate the chat surface.
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-2 text-[11px] text-fg-muted last:border-b-0">
      <span className="rounded bg-bg-subtle px-1.5 py-0.5 font-medium">{event.type}</span>
      <span title={event.at} className="shrink-0">
        {ts}
      </span>
      <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-words font-mono">
        {payloadJson(event.payload)}
      </pre>
    </div>
  );
}

function roleFor(event: ThreadTimelineEvent): string {
  const p = event.payload;
  if (p !== null && typeof p === 'object') {
    const role = (p as { role?: unknown }).role;
    if (typeof role === 'string') return role;
  }
  return 'message';
}

function extractText(payload: unknown): string | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const k of ['text', 'content', 'message', 'output']) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  }
  return null;
}

function toolNameFromPayload(payload: unknown): string {
  if (payload !== null && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (typeof p.name === 'string') return p.name;
    if (typeof p.tool === 'string') return p.tool;
    if (typeof p.toolName === 'string') return p.toolName;
  }
  return '';
}

function payloadJson(payload: unknown): string {
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}
