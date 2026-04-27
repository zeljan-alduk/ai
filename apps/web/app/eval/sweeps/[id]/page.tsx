import { CommentsThread } from '@/components/annotations/comments-thread';
import { ErrorView } from '@/components/error-boundary';
import type { ClusterLike } from '@/components/eval/clusters';
import { FailureClustersPanel } from '@/components/eval/failure-clusters-panel';
import { PageHeader } from '@/components/page-header';
import { ShareDialog } from '@/components/shares/share-dialog';
import { getAuthMe, listAnnotationsApi, listFailureClusters } from '@/lib/api';
import { getSweep } from '@/lib/eval-client';
import type { Annotation } from '@aldo-ai/api-contract';
import Link from 'next/link';
import { SweepView } from './sweep-view';

export const dynamic = 'force-dynamic';

export default async function SweepDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);

  let data: Awaited<ReturnType<typeof getSweep>> | null = null;
  let error: unknown = null;
  try {
    data = await getSweep(decoded);
  } catch (err) {
    error = err;
  }

  // Wave-14 (Engineer 14D): annotations + auth-me prefetch.
  let initialAnnotations: readonly Annotation[] = [];
  let currentUserId = '';
  let currentUserEmail = '';
  // Wave-16 (Engineer 16B): failure-clusters prefetch (best-effort).
  let initialClusters: readonly ClusterLike[] = [];
  if (data !== null) {
    try {
      const [annResp, me] = await Promise.all([
        listAnnotationsApi({ targetKind: 'sweep', targetId: decoded }),
        getAuthMe(),
      ]);
      initialAnnotations = annResp.annotations;
      currentUserId = me.user.id;
      currentUserEmail = me.user.email;
    } catch {
      // ignore — comments are auxiliary
    }
    try {
      const cl = await listFailureClusters(decoded);
      initialClusters = cl.clusters;
    } catch {
      // ignore — clusters are also auxiliary; the panel handles the
      // empty state with a "Cluster failures" CTA.
    }
  }
  const hasFailures = data ? data.sweep.cells.some((c) => c.passed === false) : false;

  return (
    <>
      <PageHeader
        title={`Sweep ${decoded.slice(0, 12)}`}
        description="Per-cell results, per-model aggregates, and live status while running."
        actions={
          <div className="flex items-center gap-2">
            <ShareDialog targetKind="sweep" targetId={decoded} />
            <Link
              href="/eval/sweeps"
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
            >
              Back to sweeps
            </Link>
          </div>
        }
      />
      {error ? (
        <ErrorView error={error} context="this sweep" />
      ) : data ? (
        <>
          <SweepView initialSweep={data.sweep} />
          {hasFailures && (
            <div className="mt-6">
              <FailureClustersPanel
                sweepId={decoded}
                initial={initialClusters}
                hasFailures={hasFailures}
              />
            </div>
          )}
          {currentUserId.length > 0 && (
            <div className="mt-6">
              <CommentsThread
                targetKind="sweep"
                targetId={decoded}
                currentUserId={currentUserId}
                currentUserEmail={currentUserEmail}
                initialAnnotations={initialAnnotations}
              />
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
