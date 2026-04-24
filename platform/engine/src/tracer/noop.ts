import { randomUUID } from 'node:crypto';
import type {
  Attrs,
  ReplayBundle,
  RunId,
  Span,
  SpanId,
  SpanKind,
  TraceId,
  Tracer,
} from '@meridian/types';

/**
 * A Tracer that drops all spans and returns empty replay bundles.
 * Used when OTEL is not wired (tests, local dev).
 *
 * TODO(v1): replace with an OTEL-backed tracer in platform/observability.
 */
export class NoopTracer implements Tracer {
  async span<T>(
    _name: string,
    kind: SpanKind,
    _attrs: Attrs,
    fn: (s: Span) => Promise<T>,
  ): Promise<T> {
    const span = makeNoopSpan(kind);
    try {
      return await fn(span);
    } finally {
      span.end();
    }
  }

  async export(runId: RunId): Promise<ReplayBundle> {
    return {
      runId,
      traceId: randomUUID() as TraceId,
      checkpoints: [],
    };
  }
}

function makeNoopSpan(kind: SpanKind): Span {
  return {
    id: randomUUID() as SpanId,
    traceId: randomUUID() as TraceId,
    kind,
    setAttr() {
      /* noop */
    },
    event() {
      /* noop */
    },
    end() {
      /* noop */
    },
  };
}
