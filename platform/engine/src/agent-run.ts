import { randomUUID } from 'node:crypto';
import {
  type SandboxError,
  SandboxRunner,
  buildPolicy,
} from '@aldo-ai/sandbox';
import type {
  AgentRef,
  AgentRegistry,
  AgentRun,
  AgentSpec,
  CallContext,
  CheckpointId,
  CompletionRequest,
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
  ToolSchema,
  Tracer,
} from '@aldo-ai/types';
import type { Checkpoint, Checkpointer } from './checkpointer/index.js';
import type { Breakpoint, BreakpointKind, BreakpointStore } from './debugger/breakpoint-store.js';
import { rewriteCheckpoint } from './debugger/edit-and-resume.js';
import type { PauseController } from './debugger/pause-controller.js';
import type { RunStore } from './stores/postgres-run-store.js';

/**
 * Internal runtime hooks that the AgentRun needs from the Runtime.
 * Kept as an interface so we don't get a circular-import on Runtime itself.
 */
export interface AgentRunDeps {
  readonly modelGateway: ModelGateway;
  readonly toolHost: ToolHost;
  readonly registry: AgentRegistry;
  readonly tracer: Tracer;
  readonly checkpointer: Checkpointer;
  /** Called when a child AgentRun is created via resume(). */
  readonly track: (run: InternalAgentRun) => void;
  /** Optional breakpoint store; absent → no breakpoints can ever fire. */
  readonly breakpoints?: BreakpointStore;
  /** Optional pause controller; required when `breakpoints` is supplied. */
  readonly pauseController?: PauseController;
  /** Optional run-event persistence; absent → events stay in-memory only. */
  readonly runStore?: RunStore;
  /**
   * Optional `secret://NAME` resolver. When present, the engine scans
   * each tool call's args before dispatch and substitutes references
   * with their plaintext values. The pre-resolve `tool_call` event is
   * still emitted (the run-event log NEVER sees resolved values), so
   * the audit trail captures the access without leaking the secret.
   *
   * The engine has no compile-time dependency on `@aldo-ai/secrets`;
   * any callable matching this shape works.
   */
  readonly secretResolver?: SecretArgResolver;
  /**
   * Optional sandbox runner. Every native + MCP tool invocation is
   * routed through this — the policy is derived from the AgentSpec's
   * `tools.permissions`. When absent, the engine builds a default
   * `SandboxRunner` (in-process driver, no real isolation).
   */
  readonly sandbox?: SandboxRunner;
}

/**
 * Pluggable resolver for `secret://NAME` substrings inside tool args.
 * The implementation in `@aldo-ai/secrets` walks the value recursively
 * and writes one audit row per textual occurrence; the engine doesn't
 * need to know how it does that.
 */
export interface SecretArgResolver {
  /** Returns true iff `value` contains at least one `secret://` reference. */
  hasRefs(value: unknown): boolean;
  /**
   * Walk a JSON-shaped value, substituting every `secret://NAME`
   * reference with its plaintext. `caller` and optional `runId`/`tenantId`
   * are forwarded to the audit log.
   */
  resolveInArgs(
    value: unknown,
    ctx: { tenantId: TenantId; caller: string; runId?: string },
  ): Promise<unknown>;
}

export interface AgentRunOptions {
  readonly id: RunId;
  readonly tenant: TenantId;
  readonly ref: AgentRef;
  readonly spec: AgentSpec;
  readonly inputs: unknown;
  readonly parent?: RunId;
  readonly overrides?: RunOverrides;
  /** Optional seed for replay determinism; otherwise random. */
  readonly rngSeed?: number;
  /** Initial message history to restore from (resume). */
  readonly initialMessages?: readonly Message[];
  /** Tool-results captured on a previous run: replayed instead of re-invoked. */
  readonly replayToolResults?: Readonly<Record<string, unknown>>;
}

/**
 * Internal-facing AgentRun that exposes a couple of extra hooks the
 * runtime/orchestrator uses (like awaiting completion).
 */
export interface InternalAgentRun extends AgentRun {
  /** Resolves with the terminal output once the loop exits. */
  wait(): Promise<{ readonly ok: boolean; readonly output: unknown }>;
  /** Synchronous snapshot of parent, for tree queries. */
  readonly parent?: RunId;
  readonly ref: AgentRef;
  /**
   * Edit the text of a message in `checkpointId` (0-based `messageIndex`)
   * and resume from the rewritten checkpoint. Returns the new AgentRun.
   */
  editAndResume(args: {
    readonly checkpointId: CheckpointId;
    readonly messageIndex: number;
    readonly newText: string;
    readonly overrides?: RunOverrides;
  }): Promise<AgentRun>;
}

interface QueuedMessage {
  readonly msg: Message;
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
}

/**
 * AgentRun for a single leaf agent. Runs the per-turn loop:
 *
 *   1. build CompletionRequest from accumulated messages + tool schemas
 *   2. stream deltas from modelGateway.complete()
 *   3. buffer toolCall parts; on end-of-stream, if any, dispatch via toolHost
 *   4. feed tool results back as a new message and loop
 *   5. terminate when finishReason === 'stop' (or responseFormat is satisfied)
 *
 * Every node boundary (here: each completed turn) is checkpointed.
 */
export class LeafAgentRun implements InternalAgentRun {
  readonly id: RunId;
  readonly parent?: RunId;
  readonly ref: AgentRef;

  private readonly tenant: TenantId;
  private readonly spec: AgentSpec;
  private readonly deps: AgentRunDeps;
  private readonly overrides?: RunOverrides;
  private readonly rngSeed: number;

  private readonly messages: Message[];
  private readonly toolResultsRecord: Record<string, unknown>;
  private readonly eventBuffer: RunEvent[] = [];
  private readonly eventWaiters: ((e: RunEvent | null) => void)[] = [];

  private readonly abortController = new AbortController();
  private readonly doneDeferred: {
    promise: Promise<{ ok: boolean; output: unknown }>;
    resolve: (v: { ok: boolean; output: unknown }) => void;
    reject: (e: Error) => void;
  };

  private cancelled = false;
  private closed = false;
  private turnInFlight = false;
  private readonly pending: QueuedMessage[] = [];

  constructor(opts: AgentRunOptions, deps: AgentRunDeps) {
    this.id = opts.id;
    if (opts.parent !== undefined) this.parent = opts.parent;
    this.ref = opts.ref;
    this.tenant = opts.tenant;
    this.spec = opts.spec;
    this.deps = deps;
    if (opts.overrides !== undefined) this.overrides = opts.overrides;
    this.rngSeed = opts.rngSeed ?? Math.floor(Math.random() * 2 ** 31);

    const seed = seedMessages(opts.spec, opts.inputs, opts.initialMessages);
    this.messages = [...seed];
    this.toolResultsRecord = { ...(opts.replayToolResults ?? {}) };

    let resolve!: (v: { ok: boolean; output: unknown }) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<{ ok: boolean; output: unknown }>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.doneDeferred = { promise, resolve, reject };

    // Persist the run row before any events land so referential reads work.
    if (this.deps.runStore) {
      void this.deps.runStore.recordRunStart({
        runId: this.id,
        tenant: this.tenant,
        ref: this.ref,
        ...(this.parent !== undefined ? { parent: this.parent } : {}),
      });
    }

    this.emit({ type: 'run.started', at: now(), payload: { ref: this.ref, id: this.id } });

    // Kick off the first turn in the background.
    void this.runLoop();
  }

  // ───────────────────────────────────────────────── debugger hooks

  /**
   * Edit a message in a checkpoint of this run and resume from the
   * rewritten copy. Returns the new `AgentRun` produced by `resume`.
   *
   * The original checkpoint row is preserved — a fresh one is written
   * with the rewritten message history. Audit + replay can still walk
   * the original.
   */
  async editAndResume(args: {
    readonly checkpointId: CheckpointId;
    readonly messageIndex: number;
    readonly newText: string;
    readonly overrides?: RunOverrides;
  }): Promise<AgentRun> {
    const { newCheckpointId } = await rewriteCheckpoint(this.deps.checkpointer, args);
    return this.resume(newCheckpointId, args.overrides);
  }

  // ───────────────────────────────────────────────── public API

  async send(msg: Message): Promise<void> {
    if (this.closed) throw new Error('run is closed');
    if (!this.turnInFlight) {
      this.messages.push(msg);
      this.emit({ type: 'message', at: now(), payload: msg });
      // Next turn picks it up.
      void this.runLoop();
      return;
    }
    // Queue until current turn settles.
    await new Promise<void>((resolve, reject) => {
      this.pending.push({ msg, resolve, reject });
    });
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
      nodePath: ['agent', this.ref.name],
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
    const opts: AgentRunOptions = {
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
      initialMessages: cp.messages,
      replayToolResults: cp.toolResults,
    };
    const run = new LeafAgentRun(opts, this.deps);
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

  // ───────────────────────────────────────────────── the loop

  private async runLoop(): Promise<void> {
    if (this.turnInFlight || this.closed || this.cancelled) return;
    this.turnInFlight = true;

    try {
      // Loop across turns until stop / cancel.
      // Each pass is one "agent turn": one completion call, optional tool dispatch.
      while (!this.cancelled) {
        const beforeCp = await this.checkpoint();
        // Pre-model-call breakpoint check. The matching surface is the
        // agent name — this is what authors typically want to break on
        // (`before_model_call: my-agent`). Step mode also lands here.
        await this.maybePauseAt('before_model_call', this.ref.name, 'model_call', beforeCp);
        if (this.cancelled) return;

        const tools = buildToolSchemas(this.spec);
        const req: CompletionRequest = {
          messages: [...this.messages],
          ...(tools.length > 0 ? { tools } : {}),
          seed: this.rngSeed,
          ...(this.spec.modelPolicy.decoding.temperature !== undefined
            ? { temperature: this.spec.modelPolicy.decoding.temperature }
            : {}),
          ...(this.spec.modelPolicy.budget.tokensOutMax !== undefined
            ? { maxOutputTokens: this.spec.modelPolicy.budget.tokensOutMax }
            : {}),
          ...(this.spec.modelPolicy.decoding.mode === 'json'
            ? { responseFormat: { type: 'json' } as const }
            : this.spec.modelPolicy.decoding.mode === 'constrained'
              ? ({
                  responseFormat: {
                    type: 'json_schema',
                    schema: this.spec.outputs ?? {},
                  },
                } as const)
              : {}),
        };

        const ctx = this.buildCallContext();
        // Hand the gateway an AbortSignal so cancel() propagates.
        const ctxWithSignal = { ...ctx, signal: this.abortController.signal };
        // ModelGateway doesn't declare a signal field in its contract, but by
        // convention gateway implementations honor an AbortSignal on the ctx.
        // Capability-tested via mock in tests/.

        let textAccum = '';
        const toolCalls: ToolCallPart[] = [];
        let finishReason: 'stop' | 'length' | 'tool_use' | 'error' = 'stop';
        let endUsage: import('@aldo-ai/types').UsageRecord | undefined;

        try {
          for await (const delta of this.deps.modelGateway.complete(
            req,
            ctxWithSignal as CallContext,
          )) {
            if (this.cancelled) break;
            if (delta.textDelta !== undefined) textAccum += delta.textDelta;
            if (delta.toolCall !== undefined) toolCalls.push(delta.toolCall);
            if (delta.end !== undefined) {
              finishReason = delta.end.finishReason;
              endUsage = delta.end.usage;
            }
          }
        } catch (err) {
          if (this.cancelled) return;
          const e = err instanceof Error ? err : new Error(String(err));
          this.emit({ type: 'error', at: now(), payload: { message: e.message } });
          this.doneDeferred.resolve({ ok: false, output: { error: e.message } });
          this.closeEvents();
          return;
        }
        if (this.cancelled) return;

        // Record assistant message from this turn.
        const assistantParts: MessagePart[] = [];
        if (textAccum.length > 0) assistantParts.push({ type: 'text', text: textAccum });
        for (const tc of toolCalls) assistantParts.push(tc);
        if (assistantParts.length > 0) {
          const assistantMsg: Message = { role: 'assistant', content: assistantParts };
          this.messages.push(assistantMsg);
          this.emit({ type: 'message', at: now(), payload: assistantMsg });
        }

        // Emit a typed `usage` event for the terminal model call. The
        // gateway's `Delta.end.usage` carries provider, model, tokensIn,
        // tokensOut, usd and an ISO `at` timestamp — i.e. exactly the
        // shape eval-sweep cost aggregation and the debugger timeline
        // need. The cross-package `RunEvent.type` union in @aldo-ai/types
        // doesn't list `usage` (the breakpoint code has the same
        // constraint and tags `checkpoint` payloads instead), so we cast
        // here. The wire shape of run_events is `{ type, payload, at }`
        // and a 'usage' string flows through the same plumbing as any
        // other event type.
        if (endUsage !== undefined) {
          const usagePayload = {
            provider: endUsage.provider,
            model: endUsage.model,
            tokensIn: endUsage.tokensIn,
            tokensOut: endUsage.tokensOut,
            usd: endUsage.usd,
            at: endUsage.at,
          };
          this.emit({
            type: 'usage',
            at: now(),
            payload: usagePayload,
          } as unknown as RunEvent);
        }

        // Post-turn checkpoint (outputs + usage stashed on messages already).
        await this.deps.checkpointer.save({
          runId: this.id,
          nodePath: ['agent', this.ref.name],
          phase: 'post',
          messages: [...this.messages],
          toolResults: { ...this.toolResultsRecord },
          rngSeed: this.rngSeed,
          io: { text: textAccum, toolCalls, finishReason },
          state: {},
          ...(this.overrides !== undefined ? { overrides: this.overrides } : {}),
        });

        // Dispatch any tool calls.
        if (toolCalls.length > 0) {
          for (const tc of toolCalls) {
            const replayed = this.toolResultsRecord[tc.callId];
            let result: unknown;
            let isError = false;
            if (replayed !== undefined) {
              result = replayed;
            } else {
              // Pre-tool-call breakpoint check. Surface is the tool name as
              // emitted by the model — we keep it un-resolved so authors can
              // break on either the namespaced (`server.tool`) form or the
              // bare tool name they declared in their spec.
              const tcCp = await this.checkpoint();
              await this.maybePauseAt('before_tool_call', tc.tool, 'tool_call', tcCp);
              if (this.cancelled) return;
              // Emit the tool_call event with the PRE-resolve args. The
              // run-event stream and any persisted audit must never see
              // the resolved plaintext — `secret://NAME` flows through
              // unchanged. The resolver writes its own audit row(s).
              this.emit({ type: 'tool_call', at: now(), payload: tc });
              const ref: ToolRef = resolveToolRef(this.spec, tc.tool);
              const resolver = this.deps.secretResolver;
              const argsForTool: unknown =
                resolver !== undefined && resolver.hasRefs(tc.args)
                  ? await resolver.resolveInArgs(tc.args, {
                      tenantId: this.tenant,
                      caller: this.spec.identity.name,
                      runId: this.id as unknown as string,
                    })
                  : tc.args;
              const r = await this.invokeToolThroughSandbox(ref, argsForTool, ctx);
              result = r.value;
              isError = !r.ok;
              this.toolResultsRecord[tc.callId] = result;
            }
            const resultPart: ToolResultPart = {
              type: 'tool_result',
              callId: tc.callId,
              result,
              isError,
            };
            const msg: Message = { role: 'tool', content: [resultPart] };
            this.messages.push(msg);
            this.emit({ type: 'tool_result', at: now(), payload: resultPart });
          }
          // Loop again so the model can observe tool results.
          continue;
        }

        // Drain any queued send()s before deciding to exit.
        if (this.pending.length > 0) {
          const q = this.pending.shift();
          if (q) {
            this.messages.push(q.msg);
            this.emit({ type: 'message', at: now(), payload: q.msg });
            q.resolve();
            continue;
          }
        }

        if (finishReason === 'stop' || finishReason === 'length') {
          this.emit({
            type: 'run.completed',
            at: now(),
            payload: { output: textAccum, finishReason },
          });
          this.closeEvents();
          this.doneDeferred.resolve({ ok: true, output: textAccum });
          return;
        }

        if (finishReason === 'error') {
          this.emit({ type: 'error', at: now(), payload: { reason: 'model error' } });
          this.closeEvents();
          this.doneDeferred.resolve({ ok: false, output: { error: 'model error' } });
          return;
        }

        // tool_use without tool calls? treat as stop to avoid infinite loop.
        this.closeEvents();
        this.doneDeferred.resolve({ ok: true, output: textAccum });
        return;
      }
    } finally {
      this.turnInFlight = false;
    }
  }

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

  /**
   * Route every tool dispatch through the sandbox. The actual
   * `toolHost.invoke` runs *inside* the sandbox boundary so that
   * timeouts, env scrub, cwd jail, network egress allowlist, and
   * cancellation all apply uniformly to native + MCP tools.
   *
   * On a `SandboxError`, we surface a structured `ToolResult` with
   * `ok: false` and a code-tagged error so the loop can let the
   * model see the failure (rather than crashing the run).
   */
  private async invokeToolThroughSandbox(
    ref: ToolRef,
    args: unknown,
    ctx: CallContext,
  ): Promise<ToolResult> {
    const sandbox = this.deps.sandbox ?? defaultSandboxRunner();
    const policy = buildPolicy({ spec: this.spec });
    try {
      const result = await sandbox.run<unknown, ToolResult>(
        {
          kind: 'inline',
          inline: async (toolArgs) => {
            return this.deps.toolHost.invoke(ref, toolArgs, ctx);
          },
        },
        {
          toolName: ref.mcpServer ? `${ref.mcpServer}.${ref.name}` : ref.name,
          args,
          policy,
          ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
        },
      );
      return result.value;
    } catch (err) {
      if (isSandboxError(err)) {
        return {
          ok: false,
          value: { error: err.message, sandboxCode: err.code },
          error: { code: err.code, message: err.message },
        };
      }
      const e = err instanceof Error ? err : new Error(String(err));
      return {
        ok: false,
        value: { error: e.message },
        error: { code: 'TOOL_ERROR', message: e.message },
      };
    }
  }

  // ───────────────────────────────────────────────── event stream plumbing

  /**
   * Look up matching breakpoints for the given surface and, if any are
   * enabled, persist a "paused" checkpoint envelope, emit a checkpoint
   * event tagged `paused: true`, and await the PauseController.
   *
   * Step mode: if the previous resume was `step`, this method also
   * pauses (without a matching breakpoint) — the caller passes in a
   * synthetic breakpoint reason of `step`.
   */
  private async maybePauseAt(
    kind: BreakpointKind,
    surface: string,
    aboutTo: 'tool_call' | 'model_call' | 'after_node' | 'event',
    checkpointId: CheckpointId,
  ): Promise<void> {
    const store = this.deps.breakpoints;
    const ctrl = this.deps.pauseController;
    if (!ctrl) return;

    let firstMatch: Breakpoint | undefined;
    let reason: string;
    if (store) {
      const matches = await store.findMatches(this.id, kind, surface);
      firstMatch = matches[0];
      if (firstMatch !== undefined) {
        const newHits = await store.recordHit(firstMatch.id);
        firstMatch = { ...firstMatch, hitCount: newHits };
        reason = `breakpoint:${firstMatch.id}`;
      } else if (ctrl.shouldStepPause(this.id)) {
        reason = 'step';
      } else {
        return;
      }
    } else if (ctrl.shouldStepPause(this.id)) {
      reason = 'step';
    } else {
      return;
    }

    // Engine emits a `checkpoint` event — the existing RunEvent.type union
    // doesn't include `paused`, so we tag the payload with `paused: true`
    // and let the API layer translate to a `DebugRunEvent` of kind
    // `paused`. This keeps `@aldo-ai/types` untouched.
    this.emit({
      type: 'checkpoint',
      at: now(),
      payload: {
        id: checkpointId,
        paused: true,
        reason,
        kind,
        surface,
        aboutTo,
        ...(firstMatch !== undefined ? { breakpointId: firstMatch.id } : {}),
      },
    });

    const ev = {
      runId: this.id,
      checkpointId,
      reason,
      breakpoint: firstMatch ?? {
        id: 'step',
        runId: this.id,
        kind,
        match: surface,
        enabled: true,
        hitCount: 0,
      },
      aboutTo,
      at: now(),
    } as const;
    await ctrl.pause(ev);
  }

  private emit(e: RunEvent): void {
    if (this.deps.runStore) {
      // Fire-and-forget — the runStore is a "side audit log", not
      // load-bearing for the loop. Errors are surfaced as engine-side
      // unhandled rejections, which the test harness asserts on.
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

// ─────────────────────────────────────────────────── helpers

let cachedDefaultSandbox: SandboxRunner | undefined;
function defaultSandboxRunner(): SandboxRunner {
  if (cachedDefaultSandbox) return cachedDefaultSandbox;
  // The driver respects SANDBOX_DRIVER env (in-process | subprocess).
  cachedDefaultSandbox = new SandboxRunner();
  return cachedDefaultSandbox;
}

function isSandboxError(err: unknown): err is SandboxError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'SandboxError' &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

function now(): string {
  return new Date().toISOString();
}

function seedMessages(
  spec: AgentSpec,
  inputs: unknown,
  initial?: readonly Message[],
): readonly Message[] {
  if (initial && initial.length > 0) return initial;
  const system: Message = {
    role: 'system',
    content: [{ type: 'text', text: renderSystemPrompt(spec) }],
  };
  const userText = typeof inputs === 'string' ? inputs : JSON.stringify(inputs ?? {});
  const user: Message = { role: 'user', content: [{ type: 'text', text: userText }] };
  return [system, user];
}

function renderSystemPrompt(spec: AgentSpec): string {
  // v0: we don't actually read the systemFile from disk (engine is pure).
  // The registry hydrates a resolved prompt in a follow-up. TODO(v1).
  const vars = spec.prompt.variables ?? {};
  const base = `You are ${spec.identity.name} v${spec.identity.version}. ${spec.identity.description}`;
  const varLine = Object.keys(vars).length ? ` Variables: ${JSON.stringify(vars)}` : '';
  return base + varLine;
}

function buildToolSchemas(spec: AgentSpec): ToolSchema[] {
  // v0: we don't actually introspect MCP servers; we expose declared native
  // tools as opaque names. TODO(v1): resolve tool schemas via ToolHost.listTools.
  const out: ToolSchema[] = [];
  for (const n of spec.tools.native) {
    out.push({
      name: n.ref,
      description: `native tool ${n.ref}`,
      inputSchema: { type: 'object' },
    });
  }
  for (const m of spec.tools.mcp) {
    for (const tool of m.allow) {
      out.push({
        name: `${m.server}.${tool}`,
        description: `mcp tool ${tool} on ${m.server}`,
        inputSchema: { type: 'object' },
      });
    }
  }
  return out;
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
  // Unknown tool — default to native so ToolHost can reject it.
  return { source: 'native', name: toolName };
}
