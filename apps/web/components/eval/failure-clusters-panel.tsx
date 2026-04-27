'use client';

/**
 * Failure-clusters panel rendered inside /eval/sweeps/[id] under the
 * matrix when the sweep has at least one failed cell. If the API
 * returned no clusters yet the user can press "Cluster failures",
 * which calls POST /v1/eval/sweeps/:id/cluster.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiClientError, clusterSweepFailures } from '@/lib/api';
import Link from 'next/link';
import { useState } from 'react';
import {
  type ClusterLike,
  sortClusters,
  totalClusteredFailures,
  trimTopTerms,
  truncateSamples,
} from './clusters';

const SAMPLE_LIMIT = 5;
const TERM_LIMIT = 8;

export interface FailureClustersPanelProps {
  readonly sweepId: string;
  readonly initial: ReadonlyArray<ClusterLike>;
  readonly hasFailures: boolean;
}

export function FailureClustersPanel({ sweepId, initial, hasFailures }: FailureClustersPanelProps) {
  const [clusters, setClusters] = useState<ClusterLike[]>(sortClusters(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasFailures) return null;

  async function compute() {
    setBusy(true);
    setError(null);
    try {
      const res = await clusterSweepFailures(sweepId);
      setClusters(sortClusters(res.clusters));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="failure-clusters-panel">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Failure clusters
      </h2>
      {clusters.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-fg-muted">
            We haven&apos;t bucketed this sweep&apos;s failures yet. Cluster on demand to group
            similar wrong outputs by their tf-idf top terms.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button type="button" onClick={compute} disabled={busy}>
              {busy ? 'Clustering…' : 'Cluster failures'}
            </Button>
            {error ? <span className="text-xs text-danger">{error}</span> : null}
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
            <span>
              {totalClusteredFailures(clusters)} failures · {clusters.length} cluster
              {clusters.length === 1 ? '' : 's'}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={compute} disabled={busy}>
              {busy ? 'Re-clustering…' : 'Re-cluster'}
            </Button>
            {error ? <span className="text-xs text-danger">{error}</span> : null}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {clusters.map((c) => {
              const sample = truncateSamples(c.examplesSample, SAMPLE_LIMIT);
              return (
                <Card key={c.id} data-testid="failure-cluster-card">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm">{c.label}</CardTitle>
                    <p className="text-[11px] text-fg-muted">{c.count} failures</p>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3 p-4 pt-0">
                    {c.topTerms && c.topTerms.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {trimTopTerms(c.topTerms, TERM_LIMIT).map((t) => (
                          <Badge key={t} variant="secondary" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <ul className="flex flex-col gap-1 text-xs">
                      {sample.head.map((s) => (
                        <li key={s.caseId} className="flex items-baseline gap-2">
                          <Link
                            href={`/runs/${encodeURIComponent(s.caseId)}`}
                            className="font-mono text-fg hover:underline"
                          >
                            {s.caseId.slice(0, 10)}
                          </Link>
                          <span className="font-mono text-[10px] text-fg-faint">{s.model}</span>
                          <span className="line-clamp-1 text-fg-muted">{s.output}</span>
                        </li>
                      ))}
                      {sample.hidden > 0 ? (
                        <li className="text-[11px] text-fg-faint">
                          + {sample.hidden} more failure{sample.hidden === 1 ? '' : 's'}
                        </li>
                      ) : null}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
