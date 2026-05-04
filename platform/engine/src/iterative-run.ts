/**
 * MISSING_PIECES §9 / Phase B — `IterativeAgentRun`.
 *
 * The leaf-loop primitive. Runs an N-cycle conversation against a
 * single agent: model call → optional parallel tool dispatch →
 * declarative termination check → maybe-compress history → next cycle.
 * Caps at `spec.iteration.maxCycles`; emits a `run.terminated_by`
 * event with `reason: 'maxCycles'` when the ceiling is reached.
 *
 * Differences from `LeafAgentRun`:
 *
 *   1. **Cycle counter**, not turn counter — every model call is a
 *      named cycle (`cycle.start` event with `cycle: number`). LoopAgent
 *      already loops on tool calls, but it doesn't expose cycles to
 *      the replay UI.
 *   2. **Parallel tool dispatch** — `Promise.all(toolHost.invoke(...))`.
 *      Safe by construction: the model only sees results AFTER all
 *      settle and re-submits a fresh turn.
 *   3. **Declarative termination** — operator-meaningful matchers
 *      (`text-includes` | `tool-result` | `budget-exhausted`)
 *      checked AFTER tool dispatch. The first match fires; the loop
 *      reports `ok: true` (these are operator-set ceilings, not
 *      failures).
 *   4. **Per-cycle compression hook** — when the estimated history
 *      tokens cross 80% of `spec.iteration.contextWindow`, the loop
 *      calls `compressHistory(history, strategy)` and emits a
 *      `history.compressed` event. Phase B leaves the body as
 *      `passThrough` (no-op); Phase C wires rolling-window /
 *      periodic-summary.
 *
 * Phase B intentionally keeps the surface narrow: no breakpoints, no
 * secret-resolver, no notification sink, no sandbox runner. Those
 * features can layer on in follow-ups; the §9 plan calls them out as
 * out-of-scope until #9 (approval gates) and the rest of the loop
 * primitive lands.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentRef,
  AgentRegistry,
  AgentRun,
  AgentSpec,
  CallContext,
  CheckpointId,
  CompletionRequest,
  Delta,
  IterationTerminationCondition,
  Message,
  MessagePart,
  ModelGateway,
  RunEvent,
  RunId,
  RunOverrides,
  TenantId,
  ToolCallPart,
  ToolHost,
  ToolRef,
  ToolResult,
  ToolResultPart,
  Tracer,
  UsageRecord,
} from '@aldo-ai/types';
import type { Checkpoint, Checkpointer } from './checkpointer/index.js';
import type { InternalAgentRun } from './agent-run.js';
import {
  type ApprovalController,
  approvalPolicyFor,
} from './approval-controller.js';
import {
  type CycleOutcome,
  firstMatchingTermination,
  type TerminationDecision,
} from './iterative-termination.js';
import type { RunStore } from './stores/postgres-run-store.js';

export interface IterativeAgentRunDeps {
  readonly modelGateway: ModelGateway;
  readonly toolHost: ToolHost;
  readonly registry: AgentRegistry;
  readonly tracer: Tracer;
  readonly checkpointer: Checkpointer;
  readonly track: (run: InternalAgentRun) => void;
  readonly runStore?: RunStore;
  /**
   * MISSING_PIECES #9 — optional approval controller. When the spec
   * declares `tools.approvals` and the controller is supplied, the
   * loop pauses on gated tool calls until an out-of-band caller
   * resolves the request. When the controller is absent, gated tool
   * calls fail fast with a synthetic `{ rejected: true, reason }`
   * tool_result so a misconfigured deployment can't silently bypass
   * the gate.
   */
  readonly approvalController?: ApprovalController;
}

export interface IterativeAgentRunOptions {
  readonly id: RunId;
  readonly tenant: TenantId;
  readonly ref: AgentRef;
  readonly spec: AgentSpec;
  readonly inputs: unknown;
  readonly parent?: RunId;
  readonly overrides?: RunOverrides;
  readonly rngSeed?: number;
}

/** Compression strategy hook — Phase B passthrough; Phase C overrides. */
export interface HistoryCompressor {
  shouldCompress(history: readonly Message[], contextWindow: number): boolean;
  compress(
    history: readonly Message[],
    strategy: 'rolling-window' | 'periodic-summary',
    ctx: { readonly gateway: ModelGateway; readonly callCtx: CallContext },
  ): Promise<{
    readonly messages: readonly Message[];
    readonly droppedMessages: number;
    readonly keptMessages: number;
    readonly summarisedTo?: string;
  }>;
}

/** Phase B default: never compresses. Phase C swaps in the real one. */
export const passThroughCompressor: HistoryCompressor = {
  shouldCompress: () => false,
  compress: async (history) => ({
    messages: history,
    droppedMessages: 0,
    keptMessages: history.length,
  }),
};

export class IterativeAgentRun implements InternalAgentRun {
  readonly id: RunId;
  readonly parent?: RunId;
  readonly ref: AgentRef;

  private readonly tenant: TenantId;
  private readonly spec: AgentSpec;
  private readonly deps: IterativeAgentRunDeps;
  private readonly overrides?: RunOverrides;
  private readonly rngSeed: number;
  private readonly compressor: HistoryCompressor;

  private messages: Message[];
  private readonly toolResultsRecord: Record<string, unknown> = {};
  private readonly eventBuffer: RunEvent[] = [];
  private readonly eventWaiters: ((e: RunEvent | null) => void)[] = [];
  private readonly usageRecords: UsageRecord[] = [];

  private readonly abortController = new AbortController();
  private readonly doneDeferred: {
    promise: Promise<{ ok: boolean; output: unknown }>;
    resolve: (v: { ok: boolean; output: unknown }) => void;
    reject: (e: Error) => void;
  };

  private cancelled = false;
  private closed = false;
  private cumulativeUsd = 0;

  constructor(
    opts: IterativeAgentRunOptions,
    deps: IterativeAgentRunDeps,
    compressor: HistoryCompressor = passThroughCompressor,
  ) {
    if (opts.spec.iteration === undefined) {
      throw new Error('IterativeAgentRun requires spec.iteration to be set');
    }
    this.id = opts.id;
    if (opts.parent !== undefined) this.parent = opts.parent;
    this.ref = opts.ref;
    this.tenant = opts.tenant;
    this.spec = opts.spec;
    this.deps = deps;
    if (opts.overrides !== undefined) this.overrides = opts.overrides;
    this.rngSeed = opts.rngSeed ?? Math.floor(Math.random() * 2 ** 31);
    this.compressor = compressor;
    this.messages = [...seedMessages(opts.spec, opts.inputs)];

    let resolve!: (v: { ok: boolean; output: unknown }) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<{ ok: boolean; output: unknown }>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.doneDeferred = { promise, resolve, reject };

    if (this.deps.runStore) {
      void this.deps.runStore.recordRunStart({
        runId: this.id,
        tenant: this.tenant,
        ref: this.ref,
        ...(this.parent !== undefined ? { parent: this.parent } : {}),
      });
    }

    this.emit({ type: 'run.started', at: now(), payload: { ref: this.ref, id: this.id } });
    void this.runLoop();
  }

  // ─── public AgentRun ──────────────────────────────────────────────

  async send(): Promise<void> {
    throw new Error('IterativeAgentRun does not accept mid-run send(); cancel and resume instead');
  }

  async cancel(reason: string): Promise<void> {
    if (this.cancelled) return;
    this.cancelled = true;
    this.abortController.abort(new Error(reason));
    this.emit({ type: 'run.cancelled', at: now(), payload: { reason } });
    this.closeEvents();
    this.doneDeferred.resolve({ ok: false, output: { cancelled: true, reason } });
  }

  async checkpoint(): Promise<CheckpointId> {
    const cp: Omit<Checkpoint, 'id' | 'at'> = {
      runId: this.id,
      nodePath: ['agent', this.ref.name, 'iterative'],
      phase: 'pre',
      messages: [...this.messages],
      toolResults: { ...this.toolResultsRecord },
      rngSeed: this.rngSeed,
      io: null,
      state: { ref: this.ref },
      ...(this.overrides !== undefined ? { overrides: this.overrides } : {}),
    };
    const id = await this.deps.checkpointer.save(cp);
    this.emit({ type: 'checkpoint', at: now(), payload: { id } });
    return id;
  }

  async resume(from: CheckpointId, overrides?: RunOverrides): Promise<AgentRun> {
    const cp = await this.deps.checkpointer.load(from);
    if (!cp) throw new Error(`checkpoint not found: ${from}`);
    const newId = randomUUID() as RunId;
    const opts: IterativeAgentRunOptions = {
      id: newId,
      tenant: this.tenant,
      ref: this.ref,
      spec: this.spec,
      inputs: null,
      ...(this.parent !== undefined ? { parent: this.parent } : {}),
      ...(overrides !== undefined
        ? { overrides }
        : this.overrides !== undefined
          ? { overrides: this.overrides }
          : {}),
      rngSeed: cp.rngSeed,
    };
    const run = new IterativeAgentRun(opts, this.deps, this.compressor);
    // Prime history from the checkpoint.
    (run as unknown as { messages: Message[] }).messages = [...cp.messages];
    this.deps.track(run);
    return run;
  }

  events(): AsyncIterable<RunEvent> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<RunEvent> => ({
        next: (): Promise<IteratorResult<RunEvent>> => this.readEvent(),
      }),
    };
  }

  wait(): Promise<{ readonly ok: boolean; readonly output: unknown }> {
    return this.doneDeferred.promise;
  }

  collectUsage(): readonly UsageRecord[] {
    return [...this.usageRecords];
  }

  async editAndResume(args: {
    readonly checkpointId: CheckpointId;
    readonly messageIndex: number;
    readonly newText: string;
    readonly overrides?: RunOverrides;
  }): Promise<AgentRun> {
    // v0: Phase B leaves edit-and-resume as a thin wrapper around
    // resume(). The full rewrite path lives in agent-run.ts; an
    // iterative run can layer it on in a follow-up if operators need
    // it (out of scope per §9 Phase B).
    return this.resume(args.checkpointId, args.overrides);
  }

  // ─── the loop ────────────────────────────────────────────────────

  private async runLoop(): Promise<void> {
    const iteration = this.spec.iteration;
    if (iteration === undefined) return;

    try {
      for (let cycle = 1; cycle <= iteration.maxCycles; cycle += 1) {
        if (this.cancelled) return;

        await this.checkpoint();
        this.emit({
          type: 'cycle.start',
          at: now(),
          payload: {
            cycle,
            maxCycles: iteration.maxCycles,
            messages: this.messages.length,
          },
        });

        const turn = await this.runOneCycle(cycle);
        if (turn === 'cancelled' || turn === 'errored') return;

        const cycleOutcome: CycleOutcome = {
          text: turn.text,
          toolResults: turn.toolResults,
          usage: turn.usage,
        };

        const decision = firstMatchingTermination(
          iteration.terminationConditions,
          cycleOutcome,
          {
            cumulativeUsd: this.cumulativeUsd,
            budgetUsdMax: this.spec.modelPolicy.budget.usdMax,
          },
        );

        if (decision !== null) {
          this.emit({ type: 'run.terminated_by', at: now(), payload: decision });
          this.emit({
            type: 'run.completed',
            at: now(),
            payload: {
              output: turn.text,
              finishReason: turn.finishReason,
              terminatedBy: decision.reason,
              cycles: cycle,
            },
          });
          this.closeEvents();
          this.doneDeferred.resolve({ ok: true, output: turn.text });
          return;
        }

        // Maybe-compress before the next cycle. Phase B passes through.
        if (this.compressor.shouldCompress(this.messages, iteration.contextWindow)) {
          const before = this.messages.length;
          const out = await this.compressor.compress(this.messages, iteration.summaryStrategy, {
            gateway: this.deps.modelGateway,
            callCtx: this.buildCallContext(),
          });
          this.messages = [...out.messages];
          this.emit({
            type: 'history.compressed',
            at: now(),
            payload: {
              cycle,
              strategy: iteration.summaryStrategy,
              droppedMessages: out.droppedMessages,
              keptMessages: out.keptMessages,
              messagesBefore: before,
              messagesAfter: this.messages.length,
              ...(out.summarisedTo !== undefined ? { summarisedTo: out.summarisedTo } : {}),
            },
          });
        }

        // No tool calls this cycle, no termination match → nudge and continue.
        if (turn.toolCalls.length === 0) {
          // The model produced text but didn't act and didn't terminate.
          // Nudge with a synthetic user message so the next cycle has a
          // chance to either produce a terminating signal or invoke a
          // tool. v0 nudge is plain — sophisticated phrasing belongs to
          // the agent's prompt, not the platform.
          this.messages.push({
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Continue. If the task is complete, say so explicitly. Otherwise, use tools to make progress.',
              },
            ],
          });
        }
      }

      // Fell out of the for-loop → cycle ceiling hit.
      const decision: TerminationDecision = {
        reason: 'maxCycles',
        detail: { cycles: iteration.maxCycles },
      };
      this.emit({ type: 'run.terminated_by', at: now(), payload: decision });
      this.emit({
        type: 'run.completed',
        at: now(),
        payload: {
          finishReason: 'stop',
          terminatedBy: decision.reason,
          cycles: iteration.maxCycles,
        },
      });
      this.closeEvents();
      this.doneDeferred.resolve({ ok: true, output: lastAssistantText(this.messages) });
    } catch (err) {
      if (this.cancelled) return;
      const e = err instanceof Error ? err : new Error(String(err));
      this.emit({ type: 'error', at: now(), payload: { message: e.message } });
      this.closeEvents();
      this.doneDeferred.resolve({ ok: false, output: { error: e.message } });
    }
  }

  /** One cycle = one model call + optional parallel tool dispatch. */
  private async runOneCycle(cycle: number): Promise<
    | 'cancelled'
    | 'errored'
    | {
        readonly text: string;
        readonly toolCalls: readonly ToolCallPart[];
        readonly toolResults: readonly ToolResultPart[];
        readonly usage: UsageRecord | undefined;
        readonly finishReason: 'stop' | 'length' | 'tool_use' | 'error';
      }
  > {
    const ctx = this.buildCallContext();
    const ctxWithSignal = { ...ctx, signal: this.abortController.signal };

    const req: CompletionRequest = {
      messages: [...this.messages],
      seed: this.rngSeed,
      ...(this.spec.modelPolicy.decoding.temperature !== undefined
        ? { temperature: this.spec.modelPolicy.decoding.temperature }
        : {}),
      ...(this.spec.modelPolicy.budget.tokensOutMax !== undefined
        ? { maxOutputTokens: this.spec.modelPolicy.budget.tokensOutMax }
        : {}),
    };

    const gw = this.deps.modelGateway as ModelGateway & {
      completeWith?: (
        req: CompletionRequest,
        ctx: CallContext,
        hints: { primaryClass: string; fallbackClasses?: readonly string[] },
      ) => AsyncIterable<Delta>;
    };
    const primaryClass = this.spec.modelPolicy.primary.capabilityClass;
    const fallbackClasses = this.spec.modelPolicy.fallbacks.map((f) => f.capabilityClass);
    const stream = gw.completeWith
      ? gw.completeWith(req, ctxWithSignal as CallContext, {
          primaryClass,
          ...(fallbackClasses.length > 0 ? { fallbackClasses } : {}),
        })
      : this.deps.modelGateway.complete(req, ctxWithSignal as CallContext);

    let textAccum = '';
    const toolCalls: ToolCallPart[] = [];
    let finishReason: 'stop' | 'length' | 'tool_use' | 'error' = 'stop';
    let endUsage: UsageRecord | undefined;

    try {
      for await (const delta of stream) {
        if (this.cancelled) return 'cancelled';
        if (delta.textDelta !== undefined) textAccum += delta.textDelta;
        if (delta.toolCall !== undefined) toolCalls.push(delta.toolCall);
        if (delta.end !== undefined) {
          finishReason = delta.end.finishReason;
          endUsage = delta.end.usage;
        }
      }
    } catch (err) {
      if (this.cancelled) return 'cancelled';
      const e = err instanceof Error ? err : new Error(String(err));
      this.emit({ type: 'error', at: now(), payload: { message: e.message } });
      this.doneDeferred.resolve({ ok: false, output: { error: e.message } });
      this.closeEvents();
      return 'errored';
    }

    if (endUsage !== undefined) {
      this.usageRecords.push(endUsage);
      this.cumulativeUsd += endUsage.usd;
      this.emit({
        type: 'usage',
        at: now(),
        payload: {
          provider: endUsage.provider,
          model: endUsage.model,
          tokensIn: endUsage.tokensIn,
          tokensOut: endUsage.tokensOut,
          usd: endUsage.usd,
          at: endUsage.at,
        },
      } as unknown as RunEvent);
    }

    this.emit({
      type: 'model.response',
      at: now(),
      payload: {
        cycle,
        textLength: textAccum.length,
        toolCalls: toolCalls.map((tc) => ({ tool: tc.tool, callId: tc.callId })),
        finishReason,
        ...(endUsage !== undefined
          ? { usage: { tokensIn: endUsage.tokensIn, tokensOut: endUsage.tokensOut, usd: endUsage.usd } }
          : {}),
      },
    });

    // Append the assistant message before tool dispatch so checkpoints
    // (and the model's next view of history) carry the call IDs.
    const assistantParts: MessagePart[] = [];
    if (textAccum.length > 0) assistantParts.push({ type: 'text', text: textAccum });
    for (const tc of toolCalls) assistantParts.push(tc);
    if (assistantParts.length > 0) {
      const assistantMsg: Message = { role: 'assistant', content: assistantParts };
      this.messages.push(assistantMsg);
      this.emit({ type: 'message', at: now(), payload: assistantMsg });
    }

    // Parallel tool dispatch.
    const toolResults: ToolResultPart[] = [];
    if (toolCalls.length > 0) {
      const settled = await Promise.all(
        toolCalls.map(async (tc): Promise<ToolResultPart> => {
          const ref = resolveToolRef(this.spec, tc.tool);
          this.emit({ type: 'tool_call', at: now(), payload: tc });

          // MISSING_PIECES #9 — approval gate. When the spec marks
          // this tool as requiring approval, suspend until the
          // controller resolves the request. Approved → dispatch as
          // normal. Rejected → synthesise the rejection tool_result
          // and skip dispatch (the model decides what to do next).
          const policy = approvalPolicyFor(this.spec, tc.tool);
          if (policy === 'always') {
            const decision = await this.awaitApproval(tc);
            if (decision === null) {
              const failPart: ToolResultPart & { tool?: string } = {
                type: 'tool_result',
                callId: tc.callId,
                result: {
                  rejected: true,
                  reason: 'no approval controller wired into runtime',
                },
                isError: true,
                tool: tc.tool,
              };
              this.toolResultsRecord[tc.callId] = failPart.result;
              this.emit({ type: 'tool_result', at: now(), payload: failPart });
              return failPart;
            }
            if (decision.kind === 'rejected') {
              const rejPart: ToolResultPart & { tool?: string } = {
                type: 'tool_result',
                callId: tc.callId,
                result: {
                  rejected: true,
                  reason: decision.reason,
                  approver: decision.approver,
                },
                isError: true,
                tool: tc.tool,
              };
              this.toolResultsRecord[tc.callId] = rejPart.result;
              this.emit({ type: 'tool_result', at: now(), payload: rejPart });
              return rejPart;
            }
            // approved → fall through to invoke
          }

          let r: ToolResult;
          try {
            r = await this.deps.toolHost.invoke(ref, tc.args, ctx);
          } catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            r = {
              ok: false,
              value: { error: e.message },
              error: { code: 'TOOL_ERROR', message: e.message },
            };
          }
          this.toolResultsRecord[tc.callId] = r.value;
          const part: ToolResultPart & { tool?: string } = {
            type: 'tool_result',
            callId: tc.callId,
            result: r.value,
            isError: !r.ok,
            tool: tc.tool,
          };
          this.emit({ type: 'tool_result', at: now(), payload: part });
          return part;
        }),
      );
      toolResults.push(...settled);

      // Single aggregated event for the cycle's tool batch — the per-call
      // tool_result events are already emitted above; this is the
      // sibling-of-cycle.start envelope the replay UI groups by.
      this.emit({
        type: 'tool.results',
        at: now(),
        payload: {
          cycle,
          results: toolResults.map((r) => ({
            callId: r.callId,
            tool: (r as ToolResultPart & { tool?: string }).tool ?? null,
            isError: r.isError === true,
          })),
        },
      });

      // Append the tool-result message so the next gateway call sees them.
      this.messages.push({
        role: 'tool',
        content: toolResults.map(
          (r): ToolResultPart => ({
            type: 'tool_result',
            callId: r.callId,
            result: r.result,
            isError: r.isError === true,
          }),
        ),
      });
    }

    return { text: textAccum, toolCalls, toolResults, usage: endUsage, finishReason };
  }

  /**
   * MISSING_PIECES #9 — block on the approval controller. Emits the
   * `tool.pending_approval` event before suspending, and the
   * `tool.approval_resolved` event the moment the controller settles.
   * Returns `null` when no controller is wired (caller fails closed).
   */
  private async awaitApproval(
    tc: ToolCallPart,
  ): Promise<
    | null
    | {
        readonly kind: 'approved';
        readonly approver: string;
        readonly at: string;
      }
    | {
        readonly kind: 'rejected';
        readonly approver: string;
        readonly reason: string;
        readonly at: string;
      }
  > {
    const ctrl = this.deps.approvalController;
    if (ctrl === undefined) return null;

    const reason = readReasonFromArgs(tc.args);
    this.emit({
      type: 'tool.pending_approval',
      at: now(),
      payload: {
        runId: this.id,
        callId: tc.callId,
        tool: tc.tool,
        args: tc.args,
        reason,
      },
    });

    let decision: Awaited<ReturnType<ApprovalController['requestApproval']>>;
    try {
      decision = await ctrl.requestApproval(
        {
          runId: this.id,
          callId: tc.callId,
          tool: tc.tool,
          args: tc.args,
          reason,
        },
        this.abortController.signal,
      );
    } catch {
      // Cancelled while waiting — treat as a structural rejection so
      // the loop can wind down without crashing on an unhandled
      // promise rejection. The cancel() handler already drained
      // events; emit nothing further here.
      return null;
    }

    this.emit({
      type: 'tool.approval_resolved',
      at: now(),
      payload: {
        runId: this.id,
        callId: tc.callId,
        kind: decision.kind,
        approver: decision.approver,
        ...(decision.kind === 'rejected' ? { reason: decision.reason } : {}),
        at: decision.at,
      },
    });
    return decision;
  }

  // ─── plumbing ─────────────────────────────────────────────────────

  private buildCallContext(): CallContext {
    return {
      required: this.spec.modelPolicy.capabilityRequirements,
      privacy: this.spec.modelPolicy.privacyTier,
      budget: this.spec.modelPolicy.budget,
      tenant: this.tenant,
      runId: this.id,
      traceId: this.id as unknown as CallContext['traceId'],
      agentName: this.spec.identity.name,
      agentVersion: this.spec.identity.version,
    };
  }

  private emit(e: RunEvent): void {
    if (this.deps.runStore) {
      void this.deps.runStore.appendEvent(this.id, e);
      if (e.type === 'run.completed') {
        void this.deps.runStore.recordRunEnd({ runId: this.id, status: 'completed' });
      } else if (e.type === 'run.cancelled') {
        void this.deps.runStore.recordRunEnd({ runId: this.id, status: 'cancelled' });
      } else if (e.type === 'error') {
        void this.deps.runStore.recordRunEnd({ runId: this.id, status: 'failed' });
      }
    }
    if (this.eventWaiters.length > 0) {
      const waiter = this.eventWaiters.shift();
      waiter?.(e);
      return;
    }
    this.eventBuffer.push(e);
  }

  private readEvent(): Promise<IteratorResult<RunEvent>> {
    if (this.eventBuffer.length > 0) {
      const e = this.eventBuffer.shift() as RunEvent;
      return Promise.resolve({ value: e, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.eventWaiters.push((e) => {
        if (e === null) resolve({ value: undefined, done: true });
        else resolve({ value: e, done: false });
      });
    });
  }

  private closeEvents(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.eventWaiters.length > 0) {
      const w = this.eventWaiters.shift();
      w?.(null);
    }
  }
}

// ─── helpers (small duplicates of agent-run.ts internals) ───────────

function now(): string {
  return new Date().toISOString();
}

function seedMessages(spec: AgentSpec, inputs: unknown): readonly Message[] {
  // MISSING_PIECES §10 — chat-shape inputs from the assistant route.
  // When the caller hands us `{ messages: [...] }` (and optionally a
  // `systemPrompt`), use them directly so a multi-turn conversation
  // flows in unmangled. Pre-§10 callers continue to JSON-stringify
  // their inputs into a single user message — that path is unchanged.
  if (
    inputs !== null &&
    typeof inputs === 'object' &&
    Array.isArray((inputs as { messages?: unknown }).messages)
  ) {
    const chat = inputs as {
      messages: ReadonlyArray<{ role?: unknown; content?: unknown }>;
      systemPrompt?: unknown;
    };
    const seeded: Message[] = [];
    const sysText =
      typeof chat.systemPrompt === 'string' && chat.systemPrompt.length > 0
        ? chat.systemPrompt
        : renderSystemPrompt(spec);
    seeded.push({
      role: 'system',
      content: [{ type: 'text', text: sysText }],
    });
    for (const m of chat.messages) {
      if (m === null || typeof m !== 'object') continue;
      const role = m.role;
      const content = m.content;
      if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') {
        continue;
      }
      if (typeof content === 'string') {
        seeded.push({
          role: role as 'user' | 'assistant' | 'system' | 'tool',
          content: [{ type: 'text', text: content }],
        });
      } else if (Array.isArray(content)) {
        // Trust the caller's shape — they've already produced
        // MessagePart-shaped objects (e.g. resuming a chat with prior
        // tool_call/tool_result parts).
        seeded.push({
          role: role as 'user' | 'assistant' | 'system' | 'tool',
          content: content as Message['content'],
        });
      }
    }
    return seeded;
  }

  const system: Message = {
    role: 'system',
    content: [{ type: 'text', text: renderSystemPrompt(spec) }],
  };
  const userText = typeof inputs === 'string' ? inputs : JSON.stringify(inputs ?? {});
  const user: Message = { role: 'user', content: [{ type: 'text', text: userText }] };
  return [system, user];
}

function renderSystemPrompt(spec: AgentSpec): string {
  const vars = spec.prompt.variables ?? {};
  const base = `You are ${spec.identity.name} v${spec.identity.version}. ${spec.identity.description}`;
  const varLine = Object.keys(vars).length ? ` Variables: ${JSON.stringify(vars)}` : '';
  return base + varLine;
}

/**
 * MISSING_PIECES #9 — pull a `reason` field off the model's tool args
 * if present. Some agents convention-encode the human-readable reason
 * for a write inside the args (`{ path, content, reason }`); when
 * present we surface it on the pending-approval event so the
 * approver doesn't have to read raw JSON to decide.
 */
function readReasonFromArgs(args: unknown): string | null {
  if (args === null || typeof args !== 'object') return null;
  const r = (args as { reason?: unknown }).reason;
  return typeof r === 'string' && r.length > 0 ? r : null;
}

function lastAssistantText(messages: readonly Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role !== 'assistant') continue;
    for (const part of m.content) {
      if (part.type === 'text') return part.text;
    }
  }
  return '';
}

function resolveToolRef(spec: AgentSpec, toolName: string): ToolRef {
  for (const n of spec.tools.native) {
    if (n.ref === toolName) return { source: 'native', name: toolName };
  }
  for (const m of spec.tools.mcp) {
    for (const tool of m.allow) {
      if (`${m.server}.${tool}` === toolName || tool === toolName) {
        return { source: 'mcp', mcpServer: m.server, name: tool };
      }
    }
  }
  return { source: 'native', name: toolName };
}
