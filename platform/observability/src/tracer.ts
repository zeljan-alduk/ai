import type {
  Attrs,
  ReplayBundle,
  RunId,
  Span,
  SpanId,
  SpanKind,
  TraceId,
  Tracer,
} from '@aldo-ai/types';
/**
 * OTEL-backed Tracer implementation.
 *
 * - `span(name, kind, attrs, fn)` opens an OTEL span, runs `fn`, records
 *   thrown errors, and ends the span. Spans nest through OTEL context.
 * - When no OTEL exporter is configured, a no-op tracer is used so instrumented
 *   code is safe in minimal/test environments.
 * - `export(runId)` delegates to a `ReplayStore` — OTEL spans live in the
 *   observability backend; replay payload lives in the store.
 */
import {
  type Span as OtelSpan,
  SpanKind as OtelSpanKind,
  type Tracer as OtelTracer,
  SpanStatusCode,
  context,
  trace,
} from '@opentelemetry/api';
import { Aldo, genAiOperationName } from './attrs.js';
import { InMemoryReplayStore, type ReplayStore } from './replay.js';

export interface CreateTracerOpts {
  /**
   * Service name used as the OTEL tracer name. Defaults to
   * `@aldo-ai/observability`.
   */
  readonly serviceName?: string;

  /**
   * Optional replay store to back `export(runId)`. Defaults to a private
   * in-memory store per tracer.
   */
  readonly replayStore?: ReplayStore;

  /**
   * Force the tracer to be a no-op regardless of global OTEL state. Useful
   * for tests that want to assert nothing is recorded.
   */
  readonly noop?: boolean;
}

function mapKind(kind: SpanKind): OtelSpanKind {
  // All Aldo kinds are in-process work — they are not RPC/server spans.
  // We model them all as INTERNAL; the `aldo.span.kind` attribute carries
  // the finer-grained semantic.
  void kind;
  return OtelSpanKind.INTERNAL;
}

function isNoopSpan(s: OtelSpan): boolean {
  // When no OTEL provider is registered, spans are non-recording and have
  // an all-zero span context. We check that once per call rather than
  // with a global probe (probes pollute real exporters).
  if (!s.isRecording()) {
    const sc = s.spanContext();
    return sc.spanId === '0000000000000000' || sc.spanId === '';
  }
  return false;
}

class OtelSpanAdapter implements Span {
  readonly id: SpanId;
  readonly traceId: TraceId;
  readonly kind: SpanKind;
  private readonly otel: OtelSpan;
  private ended = false;

  constructor(otel: OtelSpan, kind: SpanKind) {
    this.otel = otel;
    this.kind = kind;
    const sc = otel.spanContext();
    this.id = sc.spanId as SpanId;
    this.traceId = sc.traceId as TraceId;
  }

  setAttr(key: string, value: string | number | boolean): void {
    this.otel.setAttribute(key, value);
  }

  event(name: string, attrs?: Attrs): void {
    this.otel.addEvent(name, attrs as Record<string, string | number | boolean> | undefined);
  }

  end(error?: Error): void {
    if (this.ended) return;
    this.ended = true;
    if (error) {
      this.otel.recordException(error);
      this.otel.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    } else {
      this.otel.setStatus({ code: SpanStatusCode.OK });
    }
    this.otel.end();
  }
}

class MeridianTracer implements Tracer {
  private readonly otel: OtelTracer;
  private readonly store: ReplayStore;
  private readonly forceNoop: boolean;

  constructor(otel: OtelTracer, store: ReplayStore, forceNoop: boolean) {
    this.otel = otel;
    this.store = store;
    this.forceNoop = forceNoop;
  }

  async span<T>(
    name: string,
    kind: SpanKind,
    attrs: Attrs,
    fn: (s: Span) => Promise<T>,
  ): Promise<T> {
    // forceNoop short-circuits: no OTEL span, just run the fn with a stub
    // Span adapter so instrumented code is still exercised.
    if (this.forceNoop) {
      const stub: Span = {
        id: '' as SpanId,
        traceId: '' as TraceId,
        kind,
        setAttr() {},
        event() {},
        end() {},
      };
      return fn(stub);
    }

    const initialAttrs: Record<string, string | number | boolean> = {
      ...attrs,
      [Aldo.KIND]: kind,
    };
    const op = genAiOperationName(kind);
    if (op !== undefined) {
      // Only stamp operation.name if the caller did not already provide one.
      if (!('gen_ai.operation.name' in initialAttrs)) {
        initialAttrs['gen_ai.operation.name'] = op;
      }
    }

    const otelSpan = this.otel.startSpan(name, {
      kind: mapKind(kind),
      attributes: initialAttrs,
    });

    const adapter = new OtelSpanAdapter(otelSpan, kind);
    const ctx = trace.setSpan(context.active(), otelSpan);

    try {
      const result = await context.with(ctx, () => fn(adapter));
      adapter.end();
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      adapter.end(e);
      throw err;
    }
  }

  async export(runId: RunId): Promise<ReplayBundle> {
    return this.store.export(runId);
  }

  /** Exposed for the replay wiring: tracer owns the store reference. */
  getStore(): ReplayStore {
    return this.store;
  }

  /** Introspection hook used by tests. True when a span starts non-recording. */
  isNoop(): boolean {
    if (this.forceNoop) return true;
    const probe = this.otel.startSpan('__meridian_noop_probe__');
    const noop = isNoopSpan(probe);
    probe.end();
    return noop;
  }
}

/**
 * Create a `Tracer` backed by the globally configured OTEL provider. If no
 * provider is registered, the returned tracer is a safe no-op: spans still
 * nest logically but nothing is exported.
 */
export function createTracer(opts: CreateTracerOpts = {}): Tracer {
  const serviceName = opts.serviceName ?? '@aldo-ai/observability';
  const otel = trace.getTracer(serviceName);
  const store = opts.replayStore ?? new InMemoryReplayStore();
  return new MeridianTracer(otel, store, opts.noop ?? false);
}
