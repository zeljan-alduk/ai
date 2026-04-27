import type { AgentRef, Event, EventBus, RunId, Unsubscribe } from '@aldo-ai/types';
import type { InternalAgentRun } from '../agent-run.js';
import type { NodeExecContext, NodeResult } from './types.js';

/**
 * Subscription node: register a handler with the EventBus on graph
 * start and spawn the handler agent each time a matching event fires.
 * The node resolves only when the graph is cancelled (signal.aborted).
 *
 * Inputs passed into matched handlers are the event payload.
 */
export async function runSubscriptionNode(
  event: string,
  handler: AgentRef,
  bus: EventBus,
  _inputs: unknown,
  parent: RunId | undefined,
  ctx: NodeExecContext,
): Promise<NodeResult> {
  const children: RunId[] = [];
  let unsub: Unsubscribe | null = null;
  let resolved = false;

  const done = new Promise<NodeResult>((resolve) => {
    const finalize = () => {
      if (resolved) return;
      resolved = true;
      resolve({
        ok: true,
        output: { stopped: true, spawned: children.length },
        childRunIds: children,
      });
    };

    const handle = async (e: Event): Promise<void> => {
      if (ctx.signal.aborted) return;
      const run = (await ctx.runtime.spawn(handler, e.payload, parent)) as InternalAgentRun;
      ctx.registerChild(run);
      children.push(run.id);
      // Do not await; handler runs independently.
      void run.wait();
    };

    void bus.subscribe(event, handle).then((u) => {
      unsub = u;
      if (ctx.signal.aborted) {
        void u();
        finalize();
      }
    });

    const onAbort = () => {
      if (unsub) void unsub();
      finalize();
    };
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener('abort', onAbort, { once: true });
  });

  return done;
}
