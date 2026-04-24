import type { RunId, SpanId, TraceId } from './brands.js';

export type SpanKind =
  | 'run'
  | 'node'
  | 'agent_turn'
  | 'model_call'
  | 'tool_call'
  | 'memory_op'
  | 'policy_check';

export type Attrs = Readonly<Record<string, string | number | boolean>>;

export interface Span {
  readonly id: SpanId;
  readonly traceId: TraceId;
  readonly kind: SpanKind;
  setAttr(key: string, value: string | number | boolean): void;
  event(name: string, attrs?: Attrs): void;
  end(error?: Error): void;
}

export interface ReplayBundle {
  readonly runId: RunId;
  readonly traceId: TraceId;
  /** Fully self-contained: messages, tool IO, RNG seeds, model selections, policy decisions. */
  readonly checkpoints: readonly {
    readonly id: string;
    readonly at: string;
    readonly payload: unknown;
  }[];
}

export interface Tracer {
  span<T>(
    name: string,
    kind: SpanKind,
    attrs: Attrs,
    fn: (s: Span) => Promise<T>,
  ): Promise<T>;

  export(runId: RunId): Promise<ReplayBundle>;
}
