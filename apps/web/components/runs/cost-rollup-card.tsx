/**
 * Cost-rollup card for composite runs.
 *
 * Shows:
 *   - self-cost (the parent run alone, from its own usage_records)
 *   - sum-of-children (every descendant in the run tree)
 *   - grand total
 *
 * The brief says "reuse the `composite.usage_rollup` event Engineer J
 * emits — fetch from the run's event stream, NOT a separate /v1/cost
 * endpoint". We honour that: if the event is present we use the rolled
 * up totals straight from the payload. Otherwise we fall back to summing
 * the tree (every node carries its own `totalUsd` so the math is local).
 * If the run is still in flight and no rollup has been emitted, we show
 * a "rollup pending" badge instead of partial numbers.
 *
 * USD only, two decimal places — operators triple-check budget claims
 * against this card. LLM-agnostic: never displays a provider name.
 */

import { NeutralBadge } from '@/components/badge';
import type { RunDetail, RunTreeNode } from '@aldo-ai/api-contract';

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Marker emitted by Engineer J's runtime when a composite finishes. The
 * web layer treats the event type as opaque (the @aldo-ai/api-contract
 * union may not list it on older servers); we just look it up by string.
 */
const ROLLUP_EVENT_TYPE = 'composite.usage_rollup';

export function CostRollupCard({
  run,
  tree,
}: {
  run: RunDetail;
  tree: RunTreeNode | null;
}) {
  const selfUsd = run.totalUsd;
  const rollup = extractRollupEvent(run.events);
  const treeUsd = tree !== null ? sumTreeUsd(tree) : selfUsd;
  const childrenUsd = Math.max(0, treeUsd - selfUsd);
  const grandTotal = selfUsd + childrenUsd;

  const stillRunning = run.status === 'queued' || run.status === 'running';

  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Cost rollup
          </h2>
          <p className="text-xs text-slate-500">
            Self-cost plus every subagent run in the tree. USD, billed against the parent run's
            budget envelope.
          </p>
        </div>
        {rollup === null && stillRunning ? (
          <NeutralBadge>rollup pending</NeutralBadge>
        ) : rollup !== null ? (
          <NeutralBadge>rollup event</NeutralBadge>
        ) : null}
      </header>

      <dl className="grid grid-cols-3 gap-px bg-slate-100 text-sm">
        <CostCell label="Self" value={selfUsd} />
        <CostCell label="Subagents" value={childrenUsd} />
        <CostCell label="Grand total" value={grandTotal} emphasis />
      </dl>

      {tree !== null && tree.children.length > 0 ? (
        <div className="px-4 py-3">
          <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">Per-child</div>
          <ul className="divide-y divide-slate-100">
            {tree.children.map((c) => (
              <li key={c.runId} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="text-slate-700">{c.agentName}</span>
                <span className="font-mono tabular-nums text-slate-700">
                  {USD.format(sumTreeUsd(c))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CostCell({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd
        className={`mt-1 font-mono tabular-nums ${
          emphasis ? 'text-base font-semibold text-slate-900' : 'text-sm text-slate-800'
        }`}
      >
        {USD.format(value)}
      </dd>
    </div>
  );
}

function sumTreeUsd(node: RunTreeNode): number {
  let total = node.totalUsd;
  for (const c of node.children) total += sumTreeUsd(c);
  return total;
}

interface RollupEventShape {
  readonly selfUsd?: number;
  readonly subagentsUsd?: number;
  readonly grandTotalUsd?: number;
}

/**
 * Pull the most-recent `composite.usage_rollup` event from the run's
 * event stream. Returns `null` if the runtime hasn't emitted one yet
 * (the run is still in flight, or this isn't a composite). The exact
 * payload shape is owned by Engineer J's runtime; we accept any object
 * that exposes the three numeric fields and ignore everything else so
 * we don't fight a future rename.
 */
function extractRollupEvent(events: RunDetail['events']): RollupEventShape | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev !== undefined && ev.type === ROLLUP_EVENT_TYPE) {
      const p = ev.payload;
      if (p !== null && typeof p === 'object') return p as RollupEventShape;
      return {};
    }
  }
  return null;
}
