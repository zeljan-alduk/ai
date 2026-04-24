/**
 * @meridian/observability — OTEL instrumentation + replay bundle writer.
 *
 * Public surface:
 *   - createTracer(opts)   → Tracer (from @meridian/types)
 *   - attrs                → typed GenAI/Meridian attribute builders
 *   - replay.record / replay.export / replay.bind
 *   - PostgresSpanExporter (stub; no SQL in v0)
 *   - GenAI, Meridian      → attribute key constants
 *
 * See README.md for conventions.
 */

export { createTracer } from './tracer.js';
export type { CreateTracerOpts } from './tracer.js';

export {
  attrs,
  GenAI,
  Meridian,
  genAiOperationName,
} from './attrs.js';
export type {
  ModelCallAttrs,
  ToolCallAttrs,
  MemoryOpAttrs,
  PolicyCheckAttrs,
} from './attrs.js';

export {
  replay,
  InMemoryReplayStore,
  encodeBundle,
  decodeBundle,
} from './replay.js';
export type {
  Checkpoint,
  EncodedReplayBundle,
  ReplayStore,
} from './replay.js';

export { PostgresSpanExporter } from './exporter-postgres.js';
export type {
  PostgresExporterConfig,
  SpanExporter,
  SpanRecord,
} from './exporter-postgres.js';
