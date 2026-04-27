/**
 * Pure helpers for the failure-clusters tab on /eval/sweeps/[id].
 *
 * Lives in its own module so vitest can exercise the transforms
 * without React.
 */

/**
 * Minimal shape — only the fields the panel renders. Decoupled from
 * the full `FailureCluster` Zod type to dodge friction with
 * `.default([])`-derived optional fields when the value comes from
 * a list-response envelope.
 */
export interface ClusterLike {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly examplesSample: ReadonlyArray<{
    readonly caseId: string;
    readonly model: string;
    readonly output: string;
  }>;
  readonly topTerms?: ReadonlyArray<string> | undefined;
}

/**
 * Sort clusters by count desc; ties broken by label.
 */
export function sortClusters<C extends ClusterLike>(clusters: ReadonlyArray<C>): C[] {
  return [...clusters].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Truncate a sample list to `max` rows, returning both the visible
 * head and the count of hidden rows.
 */
export function truncateSamples<T>(
  samples: ReadonlyArray<T>,
  max: number,
): {
  head: T[];
  hidden: number;
} {
  if (samples.length <= max) return { head: [...samples], hidden: 0 };
  return { head: samples.slice(0, max), hidden: samples.length - max };
}

/**
 * Trim a top-terms array to `max` chips. A no-op for short lists.
 */
export function trimTopTerms(terms: ReadonlyArray<string>, max: number): string[] {
  return terms.slice(0, max);
}

/**
 * Rough total — the sum of cluster counts. Useful for the header
 * "N failures bucketed across M clusters" line.
 */
export function totalClusteredFailures(clusters: ReadonlyArray<ClusterLike>): number {
  let total = 0;
  for (const c of clusters) total += c.count;
  return total;
}
