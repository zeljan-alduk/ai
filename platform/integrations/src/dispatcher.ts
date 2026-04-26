/**
 * Integration dispatcher — fan out a single event to every matching
 * tenant integration.
 *
 * Threading model (documented in the wave-14C brief):
 *
 *   - The dispatcher runs in the SAME Node process as the API/engine.
 *     There is NO queue, no worker pool. Scaling beyond in-process is
 *     a follow-up.
 *
 *   - Per-event, every matching integration runs CONCURRENTLY via
 *     `Promise.allSettled`. A slow runner can't block the fan-out.
 *
 *   - Each runner has a hard 5-second per-call timeout (enforced
 *     inside the runner via AbortController). The dispatcher itself
 *     ALSO wraps each call in its own timeout race so a runner that
 *     misbehaves (returns a never-resolving promise) cannot wedge
 *     the caller.
 *
 *   - The caller (PostgresNotificationSink) MUST await the dispatcher
 *     only with `void` semantics — best-effort, never blocks the run.
 *     Failures here never propagate to the engine.
 *
 *   - On a successful dispatch, the store stamps `last_fired_at`. On
 *     failure, we log to stderr (one structured line) and move on.
 */

import { getRunner } from './registry.js';
import type { IntegrationStore } from './store.js';
import {
  DEFAULT_DISPATCH_TIMEOUT_MS,
  type IntegrationDispatchResult,
  type IntegrationEvent,
  type IntegrationEventPayload,
} from './types.js';

export interface DispatcherOptions {
  readonly store: IntegrationStore;
  /** Override the per-call timeout (tests use a smaller value). */
  readonly perCallTimeoutMs?: number;
  /** Inject a logger (defaults to `console.error`). */
  readonly logger?: (line: string) => void;
}

export interface DispatchSummary {
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly results: ReadonlyArray<{
    readonly integrationId: string;
    readonly kind: string;
    readonly result: IntegrationDispatchResult;
  }>;
}

export class IntegrationDispatcher {
  private readonly store: IntegrationStore;
  private readonly perCallTimeoutMs: number;
  private readonly logger: (line: string) => void;

  constructor(opts: DispatcherOptions) {
    this.store = opts.store;
    this.perCallTimeoutMs = opts.perCallTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS;
    this.logger = opts.logger ?? ((line: string) => console.error(line));
  }

  /**
   * Fan out a single event to every enabled integration in the
   * tenant that subscribes to the event kind. Best-effort — never
   * throws; failures are logged.
   */
  async dispatch(
    tenantId: string,
    event: IntegrationEvent,
    payload: Omit<IntegrationEventPayload, 'event' | 'tenantId'>,
  ): Promise<DispatchSummary> {
    let integrations: readonly Awaited<ReturnType<IntegrationStore['list']>>[number][];
    try {
      integrations = await this.store.listEnabledForEvent(tenantId, event);
    } catch (err) {
      this.logger(
        `[integrations] failed to load integrations tenant=${tenantId} event=${event} err=${errorMessage(err)}`,
      );
      return { attempted: 0, succeeded: 0, failed: 0, results: [] };
    }

    if (integrations.length === 0) {
      return { attempted: 0, succeeded: 0, failed: 0, results: [] };
    }

    const fullPayload: IntegrationEventPayload = {
      event,
      tenantId,
      title: payload.title,
      body: payload.body,
      link: payload.link,
      metadata: payload.metadata ?? {},
      occurredAt: payload.occurredAt,
    };

    const settled = await Promise.allSettled(
      integrations.map((i) =>
        this.dispatchOne(i.id, i.kind, i.config, fullPayload).then((result) => ({
          integrationId: i.id,
          kind: i.kind,
          result,
        })),
      ),
    );

    const results: Array<{
      readonly integrationId: string;
      readonly kind: string;
      readonly result: IntegrationDispatchResult;
    }> = [];
    let succeeded = 0;
    let failed = 0;
    const now = new Date().toISOString();
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      const integration = integrations[i];
      if (integration === undefined) continue;
      if (s === undefined) continue;
      if (s.status === 'fulfilled') {
        results.push(s.value);
        if (s.value.result.ok) {
          succeeded++;
          // Best-effort last_fired_at stamp — failure never propagates.
          this.store.markFired(tenantId, integration.id, now).catch((err) => {
            this.logger(
              `[integrations] markFired failed id=${integration.id} err=${errorMessage(err)}`,
            );
          });
        } else {
          failed++;
          this.logger(
            `[integrations] dispatch failed id=${integration.id} kind=${integration.kind} ` +
              `event=${event} status=${s.value.result.statusCode ?? '-'} ` +
              `timedOut=${s.value.result.timedOut === true} err=${s.value.result.error ?? ''}`,
          );
        }
      } else {
        // Should never happen — dispatchOne never throws — but keep
        // a defensive branch so a future regression doesn't crash
        // the engine.
        failed++;
        results.push({
          integrationId: integration.id,
          kind: integration.kind,
          result: { ok: false, error: errorMessage(s.reason) },
        });
        this.logger(
          `[integrations] dispatch threw id=${integration.id} kind=${integration.kind} ` +
            `event=${event} err=${errorMessage(s.reason)}`,
        );
      }
    }

    return {
      attempted: integrations.length,
      succeeded,
      failed,
      results,
    };
  }

  private async dispatchOne(
    _integrationId: string,
    kind: string,
    config: Record<string, unknown>,
    payload: IntegrationEventPayload,
  ): Promise<IntegrationDispatchResult> {
    let runner: ReturnType<typeof getRunner>;
    try {
      runner = getRunner(kind as Parameters<typeof getRunner>[0]);
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }

    // Belt-and-suspenders timeout. The runner already aborts its own
    // fetch via AbortController, but if a future runner forgets to
    // honour the signal, this race ensures we still bound the wait.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<IntegrationDispatchResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ ok: false, timedOut: true, error: 'dispatcher timeout' }),
        this.perCallTimeoutMs,
      );
    });
    try {
      const result = await Promise.race([runner.dispatch(payload, config), timeout]);
      return result;
    } catch (err) {
      // Defensive — runners are contracted to never throw.
      return { ok: false, error: errorMessage(err) };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
