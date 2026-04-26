/**
 * Pure state machine for the multi-model playground.
 *
 * The /playground page owns a `Map<modelId, ColumnState>`; every SSE
 * frame updates exactly one column. Lifted out of the React component
 * so the reducer is unit-testable and the rendering layer stays
 * declarative (column.text + column.status).
 *
 * LLM-agnostic: state keys and reducer ops only ever see opaque model
 * id strings from the wire frames.
 */

import type {
  PlaygroundDeltaPayload,
  PlaygroundErrorPayload,
  PlaygroundFrame,
  PlaygroundFrameType,
  PlaygroundStartPayload,
  PlaygroundUsagePayload,
} from '@aldo-ai/api-contract';

export type ColumnStatus = 'pending' | 'streaming' | 'done' | 'error';

export interface ColumnState {
  readonly modelId: string;
  readonly provider: string;
  readonly locality: 'cloud' | 'on-prem' | 'local' | 'unknown';
  readonly capabilityClass: string;
  readonly text: string;
  readonly status: ColumnStatus;
  readonly latencyMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly usd: number;
  readonly error: string | null;
}

export type PlaygroundColumns = ReadonlyMap<string, ColumnState>;

export function emptyColumns(): PlaygroundColumns {
  return new Map();
}

/**
 * Apply one frame to the column map; returns a NEW map (immutable
 * update) so React's reference-equality re-renders correctly.
 */
export function applyFrame(prev: PlaygroundColumns, frame: PlaygroundFrame): PlaygroundColumns {
  const next = new Map(prev);
  const cur = next.get(frame.modelId) ?? freshColumn(frame.modelId);
  switch (frame.type satisfies PlaygroundFrameType) {
    case 'start': {
      const p = frame.payload as Partial<PlaygroundStartPayload>;
      next.set(frame.modelId, {
        ...cur,
        provider: p.provider ?? cur.provider,
        locality: (p.locality as ColumnState['locality']) ?? cur.locality,
        capabilityClass: p.capabilityClass ?? cur.capabilityClass,
        status: 'streaming',
      });
      return next;
    }
    case 'delta': {
      const p = frame.payload as Partial<PlaygroundDeltaPayload>;
      next.set(frame.modelId, {
        ...cur,
        text: cur.text + (typeof p.text === 'string' ? p.text : ''),
        status: 'streaming',
      });
      return next;
    }
    case 'usage': {
      const p = frame.payload as Partial<PlaygroundUsagePayload>;
      next.set(frame.modelId, {
        ...cur,
        tokensIn: typeof p.tokensIn === 'number' ? p.tokensIn : cur.tokensIn,
        tokensOut: typeof p.tokensOut === 'number' ? p.tokensOut : cur.tokensOut,
        usd: typeof p.usd === 'number' ? p.usd : cur.usd,
        latencyMs: typeof p.latencyMs === 'number' ? p.latencyMs : cur.latencyMs,
      });
      return next;
    }
    case 'done': {
      next.set(frame.modelId, { ...cur, status: 'done' });
      return next;
    }
    case 'error': {
      const p = frame.payload as Partial<PlaygroundErrorPayload>;
      next.set(frame.modelId, {
        ...cur,
        status: 'error',
        error: p.message ?? p.code ?? 'unknown error',
      });
      return next;
    }
    default:
      return prev;
  }
}

function freshColumn(modelId: string): ColumnState {
  return {
    modelId,
    provider: '',
    locality: 'unknown',
    capabilityClass: '',
    text: '',
    status: 'pending',
    latencyMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    usd: 0,
    error: null,
  };
}

/**
 * Aggregate $cost across all columns. Used by the running tally in the
 * playground header.
 */
export function totalUsd(cols: PlaygroundColumns): number {
  let s = 0;
  for (const c of cols.values()) s += c.usd;
  return Number(s.toFixed(6));
}

/** True iff every column has reached a terminal state (done or error). */
export function allTerminal(cols: PlaygroundColumns): boolean {
  if (cols.size === 0) return false;
  for (const c of cols.values()) {
    if (c.status !== 'done' && c.status !== 'error') return false;
  }
  return true;
}
