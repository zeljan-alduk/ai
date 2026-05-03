/**
 * N-way fork-lineage banner. Renders one short line per detected
 * parent→child edge in the comparison set; preserves the wave-13
 * 2-way amber-banner styling for visual continuity.
 */

import type { ComparisonColumn, ForkEdge } from './n-way-rows';

export function NWayForkBanner({
  columns,
  edges,
}: {
  columns: readonly ComparisonColumn[];
  edges: readonly ForkEdge[];
}) {
  if (edges.length === 0) return null;
  return (
    <div
      className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
      data-testid="nway-fork-banner"
    >
      <span className="mr-2 font-semibold uppercase tracking-wide">Forks detected:</span>
      <ul className="mt-1 flex flex-col gap-0.5">
        {edges.map((edge) => {
          const child = columns[edge.childIndex];
          const parent = columns[edge.parentIndex];
          const childModel = child?.kind === 'run' ? child.run.lastModel : null;
          const parentModel = parent?.kind === 'run' ? parent.run.lastModel : null;
          const swap =
            parentModel && childModel && parentModel !== childModel
              ? ` swapping model ${parentModel} → ${childModel}`
              : '';
          return (
            <li key={`${edge.parentId}-${edge.childId}`}>
              Run {edge.childIndex + 1} (
              <code className="font-mono">{edge.childId.slice(0, 10)}</code>) is a fork of Run{' '}
              {edge.parentIndex + 1} (
              <code className="font-mono">{edge.parentId.slice(0, 10)}</code>){swap}.
            </li>
          );
        })}
      </ul>
    </div>
  );
}
