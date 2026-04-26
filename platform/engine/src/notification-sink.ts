/**
 * Wave-13 notification side-channel.
 *
 * The engine never speaks Postgres directly for notifications — it
 * emits intentions through this interface and a host (apps/api) wires
 * the concrete writer. Production wires `PostgresNotificationSink`
 * (see `apps/api/src/notifications.ts`); the in-process test harness
 * passes an in-memory recorder that asserts on the call sequence.
 *
 * This interface is intentionally narrow:
 *
 *   - The engine doesn't know what a "tenant-wide" notification is, so
 *     `userId` is forwarded verbatim — `null` flows through unchanged
 *     and the implementation routes it (notifications.user_id NULL =
 *     visible to every tenant member).
 *
 *   - The engine doesn't know about Stripe, design partners, or
 *     invitations — those notification kinds are emitted by other parts
 *     of the API and never flow through this sink. The kinds here are
 *     strictly the ones derivable from a run's lifecycle.
 *
 *   - Every method is fire-and-forget at the call site (the `emit()`
 *     calls are wrapped in `void` in agent-run.ts) — a sink throw must
 *     never break the run. Implementations should swallow + log instead
 *     of propagating.
 *
 * LLM-agnostic: nothing here references a model, a provider, or a token
 * count. The notification body is a free-text label assembled by the
 * caller from an opaque AgentRef.
 */

export type EngineNotificationKind = 'run_completed' | 'run_failed' | 'guards_blocked';

export interface EngineNotification {
  readonly tenantId: string;
  /** NULL ⇒ tenant-wide. Production maps "owner of this run" when known. */
  readonly userId: string | null;
  readonly kind: EngineNotificationKind;
  readonly title: string;
  readonly body: string;
  /** Optional deep-link the bell row anchors to. */
  readonly link?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NotificationSink {
  /**
   * Record a notification. Never throws — implementations log on
   * failure and swallow.
   */
  emit(n: EngineNotification): Promise<void>;
}

/** Default sink that drops everything. Used when no host is wired. */
export const noopNotificationSink: NotificationSink = {
  async emit() {
    // intentionally empty
  },
};
