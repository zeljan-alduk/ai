import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { getSweep } from '@/lib/eval-client';
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

  return (
    <>
      <PageHeader
        title={`Sweep ${decoded.slice(0, 12)}`}
        description="Per-cell results, per-model aggregates, and live status while running."
        actions={
          <Link
            href="/eval/sweeps"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
          >
            Back to sweeps
          </Link>
        }
      />
      {error ? (
        <ErrorView error={error} context="this sweep" />
      ) : data ? (
        <SweepView initialSweep={data.sweep} />
      ) : null}
    </>
  );
}
