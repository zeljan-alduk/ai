/**
 * Postgres exporter — INTERFACE STUB ONLY for v0.
 *
 * A later engineer wires this to Neon (or any Postgres) and plumbs spans
 * into SQL. The contract:
 *
 *   CREATE TABLE spans (
 *     span_id      TEXT PRIMARY KEY,
 *     trace_id     TEXT NOT NULL,
 *     parent_id    TEXT,
 *     name         TEXT NOT NULL,
 *     kind         TEXT NOT NULL,
 *     start_ns     BIGINT NOT NULL,
 *     end_ns       BIGINT NOT NULL,
 *     attrs        JSONB NOT NULL,
 *     status_code  TEXT NOT NULL,
 *     status_msg   TEXT
 *   );
 *
 * v0 does NOT actually write anything — it just validates the interface
 * so the OTEL side can ship independently.
 */
import type { Attrs, SpanKind, TraceId } from '@meridian/types';

export interface SpanRecord {
  readonly spanId: string;
  readonly traceId: TraceId;
  readonly parentId: string | undefined;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startNs: bigint;
  readonly endNs: bigint;
  readonly attrs: Attrs;
  readonly statusCode: 'OK' | 'ERROR' | 'UNSET';
  readonly statusMsg: string | undefined;
}

export interface PostgresExporterConfig {
  readonly connectionString: string;
  readonly table?: string;
}

export interface SpanExporter {
  export(records: readonly SpanRecord[]): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * No-op Postgres exporter. Accepts records, validates shape, drops them.
 * A later engineer replaces the body with a real INSERT using the driver
 * of choice (postgres.js / pg / Neon serverless).
 */
export class PostgresSpanExporter implements SpanExporter {
  private readonly config: PostgresExporterConfig;
  private received = 0;

  constructor(config: PostgresExporterConfig) {
    this.config = config;
  }

  async export(records: readonly SpanRecord[]): Promise<void> {
    // v0: validate, count, discard. NO real SQL here — a later engineer
    // wires Neon using the shape documented above.
    for (const r of records) {
      if (!r.spanId || !r.traceId) {
        throw new Error('PostgresSpanExporter: record missing spanId/traceId');
      }
    }
    this.received += records.length;
  }

  async shutdown(): Promise<void> {
    // no-op
  }

  /** Test hook: how many records the stub has accepted. */
  receivedCount(): number {
    return this.received;
  }

  getConfig(): PostgresExporterConfig {
    return this.config;
  }
}
