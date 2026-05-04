/**
 * MISSING_PIECES #9 — approval-gate primitive.
 *
 * When an agent calls a tool whose spec marks `approval: always`
 * (or matches a future `protected_paths` predicate), the iterative
 * loop suspends before dispatch and asks an `ApprovalController`
 * for a decision. The controller blocks until an out-of-band caller
 * (e.g. the API's `POST /v1/runs/:id/approve`) resolves the request.
 *
 * Design choices:
 *
 *  1. **Pause is engine-internal, NOT a status flip.** The run's
 *     status stays `running` while waiting; the wire signal is the
 *     `tool.pending_approval` event in the event stream. This keeps
 *     us out of the existing run_status enum (which would require a
 *     migration) and the API's status-derived UI can query the
 *     latest pending approval from the event log.
 *  2. **Per-call await, not per-run.** Two parallel tool calls in a
 *     single cycle each go through their own approval await. The
 *     iterative loop dispatches them in `Promise.all`, so the model
 *     only sees the cycle's results once every approval has settled.
 *  3. **Reject path emits a synthetic ToolResult.** No exception is
 *     thrown — the agent observes `{ rejected: true, reason }` as
 *     its tool_result and decides what to do. This matches §9 plan.
 *  4. **Default policy is "never approve required".** A spec without
 *     a `tools.approvals` block runs unchanged — additive, zero
 *     regression.
 */

export interface ApprovalRequest {
  readonly runId: string;
  readonly callId: string;
  readonly tool: string;
  readonly args: unknown;
  /**
   * Operator-visible reason the agent gave when invoking the tool. The
   * model emits this via the `reason` field on its tool_call (or null
   * when not declared); v0 just forwards whatever it sees.
   */
  readonly reason: string | null;
}

export type ApprovalDecision =
  | { readonly kind: 'approved'; readonly approver: string; readonly at: string }
  | {
      readonly kind: 'rejected';
      readonly approver: string;
      readonly reason: string;
      readonly at: string;
    };

export interface ApprovalController {
  /**
   * Suspends until an approver resolves the request. Returns the
   * decision the loop should act on. Implementations MUST honour the
   * supplied AbortSignal — when the run is cancelled mid-pause, the
   * promise rejects so the loop can exit cleanly.
   */
  requestApproval(req: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalDecision>;

  /**
   * Out-of-band entry point used by the API/CLI. Resolves a pending
   * approval keyed by `(runId, callId)`. Throws if no matching
   * pending approval exists. Returns the decision that was applied.
   */
  resolve(
    runId: string,
    callId: string,
    decision:
      | { readonly kind: 'approved'; readonly approver: string }
      | { readonly kind: 'rejected'; readonly approver: string; readonly reason: string },
  ): ApprovalDecision;

  /**
   * Snapshot of currently-pending approvals (e.g. for a list endpoint).
   * Returned in the order they were requested.
   */
  pending(runId?: string): readonly ApprovalRequest[];
}

/**
 * In-process approval controller. Production wires this directly to
 * the API's approve/reject routes; tests use it to settle approvals
 * synchronously inside the same vitest run.
 */
export class InMemoryApprovalController implements ApprovalController {
  private readonly waiters = new Map<
    string,
    {
      readonly req: ApprovalRequest;
      readonly resolve: (d: ApprovalDecision) => void;
      readonly reject: (e: Error) => void;
    }
  >();

  async requestApproval(
    req: ApprovalRequest,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision> {
    const key = approvalKey(req.runId, req.callId);
    if (this.waiters.has(key)) {
      throw new Error(
        `duplicate approval request for ${key}; the engine should never double-submit`,
      );
    }
    return new Promise<ApprovalDecision>((resolve, reject) => {
      const onAbort = (): void => {
        if (this.waiters.delete(key)) {
          reject(new Error('approval pending while run was cancelled'));
        }
      };
      if (signal?.aborted) {
        reject(new Error('approval requested on already-aborted run'));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.set(key, {
        req,
        resolve: (d) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(d);
        },
        reject: (e) => {
          signal?.removeEventListener('abort', onAbort);
          reject(e);
        },
      });
    });
  }

  resolve(
    runId: string,
    callId: string,
    decision:
      | { readonly kind: 'approved'; readonly approver: string }
      | { readonly kind: 'rejected'; readonly approver: string; readonly reason: string },
  ): ApprovalDecision {
    const key = approvalKey(runId, callId);
    const w = this.waiters.get(key);
    if (w === undefined) {
      throw new ApprovalNotFoundError(runId, callId);
    }
    this.waiters.delete(key);
    const at = new Date().toISOString();
    const stamped: ApprovalDecision =
      decision.kind === 'approved'
        ? { kind: 'approved', approver: decision.approver, at }
        : {
            kind: 'rejected',
            approver: decision.approver,
            reason: decision.reason,
            at,
          };
    w.resolve(stamped);
    return stamped;
  }

  pending(runId?: string): readonly ApprovalRequest[] {
    const out: ApprovalRequest[] = [];
    for (const w of this.waiters.values()) {
      if (runId !== undefined && w.req.runId !== runId) continue;
      out.push(w.req);
    }
    return out;
  }
}

export class ApprovalNotFoundError extends Error {
  readonly code = 'approval_not_found' as const;
  constructor(
    readonly runId: string,
    readonly callId: string,
  ) {
    super(`no pending approval for run=${runId} call=${callId}`);
    this.name = 'ApprovalNotFoundError';
  }
}

function approvalKey(runId: string, callId: string): string {
  return `${runId}:${callId}`;
}

/**
 * Resolve the approval policy for a tool call given the agent spec.
 * Per-tool overrides on `spec.tools.approvals` win over defaults.
 * Returns one of:
 *   - 'never'  — never gate this tool (default for unlisted tools)
 *   - 'always' — always require approval before dispatch
 *
 * Future: 'protected_paths' will branch on the args (e.g. fs.write
 * to a protected path). v0 collapses it to 'always' so an operator
 * who declared `approval: protected_paths` still gets a gate; the
 * exact predicate lands in a follow-up.
 */
export function approvalPolicyFor(
  spec: { readonly tools?: { readonly approvals?: Readonly<Record<string, string>> } },
  toolName: string,
): 'never' | 'always' {
  const overrides = spec.tools?.approvals ?? {};
  // Accept both the bare tool name and the server-prefixed form so
  // operators can write either in the spec.
  const direct = overrides[toolName];
  const suffix = Object.entries(overrides).find(
    ([k]) => toolName === k || toolName.endsWith(`.${k}`),
  );
  const setting = direct ?? (suffix !== undefined ? suffix[1] : undefined);
  if (setting === 'always' || setting === 'protected_paths') return 'always';
  return 'never';
}
