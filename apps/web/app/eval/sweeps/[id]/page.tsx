import { CommentsThread } from '@/components/annotations/comments-thread';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { ShareDialog } from '@/components/shares/share-dialog';
import { getAuthMe, listAnnotationsApi } from '@/lib/api';
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
  }

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
