import { randomUUID } from 'node:crypto';
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
  ToolResultPart,
  ToolSchema,
  Tracer,
} from '@meridian/types';
import type { Checkpoint, Checkpointer } from './checkpointer/index.js';

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

    this.emit({ type: 'run.started', at: now(), payload: { ref: this.ref, id: this.id } });

    // Kick off the first turn in the background.
    void this.runLoop();
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
        void beforeCp; // we already emitted an event via checkpoint()

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
              this.emit({ type: 'tool_call', at: now(), payload: tc });
              const ref: ToolRef = resolveToolRef(this.spec, tc.tool);
              const r = await this.deps.toolHost.invoke(ref, tc.args, ctx);
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

  // ───────────────────────────────────────────────── event stream plumbing

  private emit(e: RunEvent): void {
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
