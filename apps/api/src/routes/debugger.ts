/**
 * `/v1/runs/:id/...` — replay-debugger HTTP surface.
 *
 * Wave-5 surface used by the web debugger UI:
 *   - GET    /v1/runs/:id/events                  SSE stream of DebugRunEvent
 *   - GET    /v1/runs/:id/breakpoints             list breakpoints
 *   - POST   /v1/runs/:id/breakpoints             create
 *   - DELETE /v1/runs/:id/breakpoints/:bp         remove
 *   - POST   /v1/runs/:id/continue                resume / step
 *   - POST   /v1/runs/:id/edit-and-resume         edit a checkpoint message + fork
 *   - POST   /v1/runs/:id/swap-model              swap model + fork
 *
 * The engine (`@aldo-ai/engine`) owns the authoritative state for runs,
 * breakpoints, pauses, and the `editAndResume` / `swapModel` operations.
 * This module is a thin HTTP adapter: validate via the
 * `@aldo-ai/api-contract` schemas, forward to the engine, shape the
 * response.
 *
 * LLM-agnostic: the swap-model command carries either a capability class
 * or an opaque (provider, model) pair — the engine resolves it through
 * the gateway. No provider SDK code touches this file.
 *
 * Engineer A is wiring `BreakpointStore`, `PauseController`, `RunStore`,
 * and `AgentRun.editAndResume(args)` into `@aldo-ai/engine` in parallel.
 * Until those exports land, this file pins the names with local
 * interface declarations marked `TODO(integrate)` and an in-process
 * default implementation lives behind `createInProcessEngineDebugger()`
 * so the API can boot and the test harness can subscribe to a real
 * stream.
 */

import {
  ApiError as ApiErrorSchema,
  Breakpoint,
  ContinueCommand,
  CreateBreakpointRequest,
  DebugRunEvent,
  EditAndResumeCommand,
  ListBreakpointsResponse,
  SwapModelCommand,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Deps } from '../deps.js'; // type-only — avoids runtime circular import
import { notFound, validationError } from '../middleware/error.js';

// Silence the lint about an unused import — kept in scope so we can
// reach for the response schema in tests/devtools without re-import.
void ApiErrorSchema;

/** How often the SSE endpoint emits a `: ping` comment. */
export const SSE_HEARTBEAT_MS = 15_000;

// ---------------------------------------------------------------------------
// Engine surface — names chosen to match Engineer A's in-flight engine PR.
// ---------------------------------------------------------------------------

// TODO(integrate): replace these local types with imports from
// `@aldo-ai/engine` once the symbols land:
//   import type {
//     BreakpointStore,
//     PauseController,
//     RunStore,
//     EngineDebugger,
//   } from '@aldo-ai/engine';
//
// The shapes below are the contract this route file assumes. Engineer A:
// please match these names exactly so the swap is mechanical.

/** A subscriber callback for live debug events. Returns an unsubscribe fn. */
export type DebugEventSubscriber = (event: DebugRunEvent) => void;

export interface BreakpointStore {
  list(runId: string): Promise<readonly Breakpoint[]>;
  create(runId: string, req: CreateBreakpointRequest): Promise<Breakpoint>;
  remove(runId: string, breakpointId: string): Promise<boolean>;
}

export interface PauseController {
  /** Resume a paused run. `mode: 'step'` advances one event then re-pauses. */
  continueRun(runId: string, cmd: ContinueCommand): Promise<void>;
}

export interface RunStore {
  /** Returns true iff a run with the given id exists. */
  exists(runId: string): Promise<boolean>;
  /** Subscribe to live events for a run. Returns an unsubscribe fn. */
  subscribe(runId: string, fn: DebugEventSubscriber): () => void;
  /** Edit a checkpoint message + fork — engine returns the new run id. */
  editAndResume(runId: string, args: EditAndResumeCommand): Promise<{ newRunId: string }>;
  /** Swap which model the run uses, starting from a checkpoint. */
  swapModel(runId: string, args: SwapModelCommand): Promise<{ newRunId: string }>;
}

/** Composite engine surface that this route consumes. */
export interface EngineDebugger {
  readonly breakpoints: BreakpointStore;
  readonly pauses: PauseController;
  readonly runs: RunStore;
}

// ---------------------------------------------------------------------------
// In-process default — used at boot time and by tests when nothing else is
// injected. Holds breakpoints in memory and lets callers push synthetic
// events (`pushEvent`) so the SSE endpoint can be exercised end-to-end.
// ---------------------------------------------------------------------------

export interface InProcessEngineDebugger extends EngineDebugger {
  /** Test helper — push a synthetic event into the bus for `runId`. */
  pushEvent(runId: string, event: DebugRunEvent): void;
  /** Test helper — register a run id so `exists()` returns true. */
  registerRun(runId: string): void;
  /** Test helper — capture continue calls. */
  readonly continueCalls: readonly { runId: string; cmd: ContinueCommand }[];
  /** Test helper — capture edit-and-resume calls. */
  readonly editCalls: readonly { runId: string; args: EditAndResumeCommand }[];
  /** Test helper — capture swap-model calls. */
  readonly swapCalls: readonly { runId: string; args: SwapModelCommand }[];
}

export function createInProcessEngineDebugger(): InProcessEngineDebugger {
  const knownRuns = new Set<string>();
  const breakpointsByRun = new Map<string, Map<string, Breakpoint>>();
  const subscribersByRun = new Map<string, Set<DebugEventSubscriber>>();
  const continueCalls: { runId: string; cmd: ContinueCommand }[] = [];
  const editCalls: { runId: string; args: EditAndResumeCommand }[] = [];
  const swapCalls: { runId: string; args: SwapModelCommand }[] = [];
  let bpCounter = 0;
  let runCounter = 0;

  const breakpoints: BreakpointStore = {
    async list(runId) {
      const map = breakpointsByRun.get(runId);
      return map === undefined ? [] : [...map.values()];
    },
    async create(runId, req) {
      bpCounter += 1;
      const bp: Breakpoint = {
        id: `bp-${bpCounter}`,
        runId,
        kind: req.kind,
        match: req.match,
        enabled: req.enabled,
        hitCount: 0,
      };
      let map = breakpointsByRun.get(runId);
      if (map === undefined) {
        map = new Map();
        breakpointsByRun.set(runId, map);
      }
      map.set(bp.id, bp);
      return bp;
    },
    async remove(runId, breakpointId) {
      const map = breakpointsByRun.get(runId);
      if (map === undefined) return false;
      return map.delete(breakpointId);
    },
  };

  const pauses: PauseController = {
    async continueRun(runId, cmd) {
      continueCalls.push({ runId, cmd });
    },
  };

  const runs: RunStore = {
    async exists(runId) {
      // Treat a run as existing if it was registered, has breakpoints, or
      // has subscribers. Tests register explicitly; callers that only
      // POST commands need the explicit register.
      return knownRuns.has(runId) || breakpointsByRun.has(runId) || subscribersByRun.has(runId);
    },
    subscribe(runId, fn) {
      let set = subscribersByRun.get(runId);
      if (set === undefined) {
        set = new Set();
        subscribersByRun.set(runId, set);
      }
      set.add(fn);
      return () => {
        const s = subscribersByRun.get(runId);
        if (s === undefined) return;
        s.delete(fn);
        if (s.size === 0) subscribersByRun.delete(runId);
      };
    },
    async editAndResume(runId, args) {
      editCalls.push({ runId, args });
      runCounter += 1;
      return { newRunId: `${runId}-edit-${runCounter}` };
    },
    async swapModel(runId, args) {
      swapCalls.push({ runId, args });
      runCounter += 1;
      return { newRunId: `${runId}-swap-${runCounter}` };
    },
  };

  return {
    breakpoints,
    pauses,
    runs,
    continueCalls,
    editCalls,
    swapCalls,
    registerRun(runId) {
      knownRuns.add(runId);
    },
    pushEvent(runId, event) {
      const set = subscribersByRun.get(runId);
      if (set === undefined) return;
      for (const fn of set) fn(event);
    },
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const RunIdParam = z.object({ id: z.string().min(1) });
const BreakpointIdParam = z.object({
  id: z.string().min(1),
  bp: z.string().min(1),
});

/** Resolve the engine debugger from the deps bag, falling back to the
 *  in-process default. Tests inject a custom one via `Deps.engineDebugger`. */
function resolveEngine(deps: Deps): EngineDebugger {
  const injected = (deps as Deps & { engineDebugger?: EngineDebugger }).engineDebugger;
  return injected ?? deps.__defaultDebugger;
}

export function debuggerRoutes(deps: Deps): Hono {
  const app = new Hono();

  // ----- SSE: live event stream ------------------------------------------
  app.get('/v1/runs/:id/events', async (c) => {
    const parsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!parsed.success) {
      throw validationError('invalid run id', parsed.error.issues);
    }
    const runId = parsed.data.id;
    const engine = resolveEngine(deps);
    if (!(await engine.runs.exists(runId))) {
      throw notFound(`run not found: ${runId}`);
    }

    const response = streamSSE(c, async (stream) => {
      const queue: DebugRunEvent[] = [];
      let resolveWaiter: (() => void) | null = null;
      const pushWaiter = (): void => {
        if (resolveWaiter !== null) {
          const r = resolveWaiter;
          resolveWaiter = null;
          r();
        }
      };
      const unsubscribe = engine.runs.subscribe(runId, (event) => {
        queue.push(event);
        pushWaiter();
      });

      const signal = c.req.raw.signal;
      let aborted = signal.aborted;
      const onAbort = (): void => {
        aborted = true;
        pushWaiter();
      };
      if (!aborted) signal.addEventListener('abort', onAbort);

      let heartbeat: ReturnType<typeof setInterval> | undefined;

      try {
        // Heartbeat as an SSE comment line. We write directly to the
        // underlying stream because Hono's SSE helper insists on a
        // `data:` field, and a comment line keeps proxies awake without
        // showing up to the client `EventSource` as a message.
        heartbeat = setInterval(() => {
          // Best-effort; ignore write errors during teardown.
          stream.write(': ping\n\n').catch(() => undefined);
        }, SSE_HEARTBEAT_MS);

        while (!aborted) {
          while (queue.length > 0) {
            const event = queue.shift() as DebugRunEvent;
            await stream.writeSSE({ data: JSON.stringify(event) });
          }
          if (aborted) break;
          await new Promise<void>((resolve) => {
            resolveWaiter = resolve;
          });
        }
      } finally {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        unsubscribe();
        signal.removeEventListener('abort', onAbort);
      }
    });
    // Hono's `streamSSE` hard-codes `Cache-Control: no-cache`. The
    // debugger contract calls for `no-store` (we never want a cache
    // entry), so override on the response object after the helper runs.
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });

  // ----- breakpoints -----------------------------------------------------
  app.get('/v1/runs/:id/breakpoints', async (c) => {
    const parsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!parsed.success) {
      throw validationError('invalid run id', parsed.error.issues);
    }
    const engine = resolveEngine(deps);
    const list = await engine.breakpoints.list(parsed.data.id);
    const body = ListBreakpointsResponse.parse({ breakpoints: list });
    return c.json(body);
  });

  app.post('/v1/runs/:id/breakpoints', async (c) => {
    const idParsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid run id', idParsed.error.issues);
    }
    const json = await readJsonBody(c);
    const bodyParsed = CreateBreakpointRequest.safeParse(json);
    if (!bodyParsed.success) {
      throw validationError('invalid breakpoint request', bodyParsed.error.issues);
    }
    const engine = resolveEngine(deps);
    const bp = await engine.breakpoints.create(idParsed.data.id, bodyParsed.data);
    return c.json(Breakpoint.parse(bp));
  });

  app.delete('/v1/runs/:id/breakpoints/:bp', async (c) => {
    const parsed = BreakpointIdParam.safeParse({
      id: c.req.param('id'),
      bp: c.req.param('bp'),
    });
    if (!parsed.success) {
      throw validationError('invalid params', parsed.error.issues);
    }
    const engine = resolveEngine(deps);
    const removed = await engine.breakpoints.remove(parsed.data.id, parsed.data.bp);
    if (!removed) {
      throw notFound(`breakpoint not found: ${parsed.data.bp}`);
    }
    return c.body(null, 204);
  });

  // ----- continue --------------------------------------------------------
  app.post('/v1/runs/:id/continue', async (c) => {
    const idParsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid run id', idParsed.error.issues);
    }
    const json = await readJsonBody(c);
    const bodyParsed = ContinueCommand.safeParse(json);
    if (!bodyParsed.success) {
      throw validationError('invalid continue command', bodyParsed.error.issues);
    }
    const engine = resolveEngine(deps);
    await engine.pauses.continueRun(idParsed.data.id, bodyParsed.data);
    return c.body(null, 204);
  });

  // ----- edit-and-resume -------------------------------------------------
  app.post('/v1/runs/:id/edit-and-resume', async (c) => {
    const idParsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid run id', idParsed.error.issues);
    }
    const json = await readJsonBody(c);
    const bodyParsed = EditAndResumeCommand.safeParse(json);
    if (!bodyParsed.success) {
      throw validationError('invalid edit-and-resume command', bodyParsed.error.issues);
    }
    const engine = resolveEngine(deps);
    const result = await engine.runs.editAndResume(idParsed.data.id, bodyParsed.data);
    return c.json({ newRunId: result.newRunId });
  });

  // ----- swap-model ------------------------------------------------------
  app.post('/v1/runs/:id/swap-model', async (c) => {
    const idParsed = RunIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid run id', idParsed.error.issues);
    }
    const json = await readJsonBody(c);
    const bodyParsed = SwapModelCommand.safeParse(json);
    if (!bodyParsed.success) {
      throw validationError('invalid swap-model command', bodyParsed.error.issues);
    }
    const engine = resolveEngine(deps);
    const result = await engine.runs.swapModel(idParsed.data.id, bodyParsed.data);
    return c.json({ newRunId: result.newRunId });
  });

  return app;
}

/** Best-effort JSON body reader — empty body becomes `{}` so optional-only
 *  schemas (e.g. ContinueCommand) accept it. */
async function readJsonBody(c: {
  req: { raw: Request };
}): Promise<unknown> {
  const text = await c.req.raw.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw validationError('invalid JSON body');
  }
}

// Re-export DebugRunEvent so callers that import the route module don't
// need a second import to construct synthetic events.
export { DebugRunEvent };
