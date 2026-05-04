/**
 * MISSING_PIECES §10 / Phase B — pure RunEvent → SSE-frame translator.
 *
 * Extracted from `routes/assistant.ts` so the wire-shape mapping is
 * unit-testable without spinning up the full runtime / gateway. The
 * route still owns the streaming + telemetry rollup; this helper just
 * maps each engine event to zero or more SSE frames.
 *
 * The frame shape preserves backward compatibility with the wave-13
 * assistant panel:
 *   - `{ type: 'delta', text }`     — assistant text chunk
 *   - `{ type: 'tool',  name, callId, args, result, isError }` — NEW
 *   - `{ type: 'done',  ... }`      — terminal telemetry
 *
 * Older clients that pre-date the `tool` frame ignore unknown types;
 * the wave-13 panel adds a renderer alongside its existing delta
 * rendering.
 */

import type { RunEvent, ToolCallPart } from '@aldo-ai/types';

export interface SseDeltaFrame {
  readonly type: 'delta';
  readonly text: string;
}

export interface SseToolFrame {
  readonly type: 'tool';
  readonly name: string;
  readonly callId: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly isError: boolean;
}

export interface SseDoneFrame {
  readonly type: 'done';
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly usd: number;
  readonly latencyMs: number;
  readonly model: string | null;
  readonly runId: string;
  readonly threadId?: string;
}

export type SseFrame = SseDeltaFrame | SseToolFrame | SseDoneFrame;

export interface AssistantTelemetry {
  tokensIn: number;
  tokensOut: number;
  usd: number;
  lastModel: string | null;
}

/** Per-call args/name, captured from `tool_call` so we can attach
 *  them to the matching `tool_result`. */
export type ToolCallBuffer = Map<string, ToolCallPart>;

/**
 * Translate one engine event into zero or more SSE frames + a
 * telemetry mutation. The caller threads the buffer + telemetry
 * across the stream; this function is pure-ish (it mutates the
 * buffer + telemetry but has no I/O).
 *
 * Returns the frames the caller should write to the SSE stream, in
 * order. Returns an empty array for events that don't translate
 * (e.g. `cycle.start`, `history.compressed`).
 */
export function translateEvent(
  ev: RunEvent,
  ctx: {
    readonly toolCalls: ToolCallBuffer;
    readonly telemetry: AssistantTelemetry;
  },
): readonly SseFrame[] {
  if (ev.type === 'message') {
    const text = readAssistantTextDelta(ev);
    if (text === null || text.length === 0) return [];
    return [{ type: 'delta', text }];
  }
  if (ev.type === 'tool_call') {
    const tc = ev.payload as ToolCallPart;
    ctx.toolCalls.set(tc.callId, tc);
    return [];
  }
  if (ev.type === 'tool_result') {
    const p = ev.payload as {
      callId?: string;
      result?: unknown;
      isError?: boolean;
    };
    if (typeof p.callId !== 'string') return [];
    const matched = ctx.toolCalls.get(p.callId);
    ctx.toolCalls.delete(p.callId);
    return [
      {
        type: 'tool',
        name: matched?.tool ?? 'unknown',
        callId: p.callId,
        args: matched?.args ?? null,
        result: redactToolResult(p.result),
        isError: p.isError === true,
      },
    ];
  }
  if (ev.type === ('usage' as RunEvent['type'])) {
    const u = ev.payload as {
      tokensIn?: number;
      tokensOut?: number;
      usd?: number;
      model?: string;
    };
    ctx.telemetry.tokensIn += u.tokensIn ?? 0;
    ctx.telemetry.tokensOut += u.tokensOut ?? 0;
    ctx.telemetry.usd += u.usd ?? 0;
    if (typeof u.model === 'string') ctx.telemetry.lastModel = u.model;
    return [];
  }
  return [];
}

/**
 * Build the terminal `done` frame from the rolled-up telemetry. The
 * caller emits this on `run.completed` / `run.cancelled` / `error`
 * (and as a defensive fallback when the iterator closes without one).
 */
export function buildDoneFrame(
  telemetry: AssistantTelemetry,
  args: { readonly runId: string; readonly latencyMs: number; readonly threadId: string | null },
): SseDoneFrame {
  return {
    type: 'done',
    tokensIn: telemetry.tokensIn,
    tokensOut: telemetry.tokensOut,
    usd: telemetry.usd,
    latencyMs: args.latencyMs,
    model: telemetry.lastModel,
    runId: args.runId,
    ...(args.threadId !== null ? { threadId: args.threadId } : {}),
  };
}

function readAssistantTextDelta(ev: RunEvent): string | null {
  const m = ev.payload as {
    role?: string;
    content?: ReadonlyArray<{ type?: string; text?: string }>;
  };
  if (m.role !== 'assistant' || !Array.isArray(m.content)) return null;
  const text = m.content
    .filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
  return text.length > 0 ? text : null;
}

/**
 * Redact tool results before they hit the SSE wire. v0 trims to a
 * sensible cap so a multi-MB file-read doesn't blow up the chat
 * panel; sensitive-content scrubbing is a follow-up that lives in
 * the @aldo-ai/guards package.
 */
export function redactToolResult(result: unknown): unknown {
  if (typeof result === 'string') {
    return result.length > 4096 ? `${result.slice(0, 4096)}…[truncated]` : result;
  }
  if (result === null || typeof result !== 'object') return result;
  try {
    const json = JSON.stringify(result);
    if (json.length > 4096) {
      return { _truncated: true, preview: `${json.slice(0, 4096)}…` };
    }
    return result;
  } catch {
    return { _unserialisable: true };
  }
}
