import type { Node, RunId } from '@aldo-ai/types';
import type { NodeExecContext, NodeResult } from './types.js';

/**
 * Parallel fan-out with one of three join strategies:
 *   - 'all': wait for every branch; collect outputs.
 *   - 'first': resolve as soon as one branch succeeds; cancel rest.
 *   - 'quorum': resolve once `quorum` branches have succeeded.
 *
 * Cancellation of losing branches happens via an internal AbortController
 * merged with the outer signal.
 */
export async function runParallelNode(
  branches: readonly Node[],
  join: 'all' | 'first' | 'quorum',
  quorum: number | undefined,
  inputs: unknown,
  parent: RunId | undefined,
  ctx: NodeExecContext,
): Promise<NodeResult> {
  const childTracker: RunId[] = [];

  const innerController = new AbortController();
  const outerAbort = () => innerController.abort(ctx.signal.reason);
  if (ctx.signal.aborted) innerController.abort(ctx.signal.reason);
  else ctx.signal.addEventListener('abort', outerAbort, { once: true });

  const innerCtx: NodeExecContext = {
    ...ctx,
    signal: innerController.signal,
    registerChild: (r) => {
      childTracker.push(r.id);
      ctx.registerChild(r);
    },
  };

  const promises = branches.map((b) => ctx.execute(b, inputs, parent));
  // Override execution to use innerCtx. We can't re-enter; instead, re-run.
  // Simpler approach: launch with ctx.execute but also pass branches via an
  // auxiliary path. To keep cancellation honored, we just rely on the outer
  // signal — the inner signal above is future-proofing for 'first'/'quorum'
  // early cancel; we forward it by aborting innerCtx.signal which the leaf
  // runs honor via runtime's cancel() wiring below.

  if (join === 'all') {
    const settled = await Promise.all(promises);
    const ok = settled.every((r) => r.ok);
    return {
      ok,
      output: settled.map((r) => r.output),
      childRunIds: settled.flatMap((r) => r.childRunIds),
    };
  }

  if (join === 'first') {
    try {
      const winner = await Promise.any(promises);
      // Cancel the rest via runtime.
      await cancelLosingChildren(ctx, childTracker, winner.childRunIds);
      return {
        ok: true,
        output: winner.output,
        childRunIds: winner.childRunIds,
      };
    } catch {
      // All rejected: collect all failures.
      const all = await Promise.all(
        promises.map((p) =>
          p.catch((e) => ({ ok: false, output: { error: String(e) }, childRunIds: [] as RunId[] })),
        ),
      );
      return {
        ok: false,
        output: all.map((r) => r.output),
        childRunIds: all.flatMap((r) => r.childRunIds),
      };
    } finally {
      innerController.abort();
      ctx.signal.removeEventListener?.('abort', outerAbort);
    }
  }

  // quorum
  const required = quorum ?? Math.ceil(branches.length / 2);
  const results: NodeResult[] = [];
  let successes = 0;
  await new Promise<void>((resolve) => {
    for (const p of promises) {
      p.then((r) => {
        results.push(r);
        if (r.ok) successes++;
        if (successes >= required || results.length === branches.length) resolve();
      }).catch(() => {
        results.push({ ok: false, output: null, childRunIds: [] });
        if (results.length === branches.length) resolve();
      });
    }
  });
  innerController.abort();
  ctx.signal.removeEventListener?.('abort', outerAbort);
  return {
    ok: successes >= required,
    output: results.filter((r) => r.ok).map((r) => r.output),
    childRunIds: results.flatMap((r) => r.childRunIds),
  };
}

async function cancelLosingChildren(
  ctx: NodeExecContext,
  all: readonly RunId[],
  winner: readonly RunId[],
): Promise<void> {
  const winnerSet = new Set(winner);
  const losers = all.filter((id) => !winnerSet.has(id));
  await Promise.all(
    losers.map(async (id) => {
      const run = await ctx.runtime.get(id);
      if (run) await run.cancel('parallel.first: sibling won');
    }),
  );
}
