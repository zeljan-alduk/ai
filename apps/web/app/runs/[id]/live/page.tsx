/**
 * Wave-13 — `/runs/[id]/live` live event tail.
 *
 * Server component shell that:
 *   1. Resolves the run (404s if it doesn't exist or belongs to
 *      another tenant).
 *   2. Renders the page chrome (header, status badge, link back to
 *      the run-detail page).
 *   3. Mounts the `<LiveTail>` client island — that's where the SSE
 *      subscription lives.
 *
 * Auto-redirect from `/runs/[id]` → `/runs/[id]/live` lives on the
 * detail page; this page is the destination, not the policy.
 *
 * LLM-agnostic: the page never branches on a provider name. The live
 * stream renders opaque `provider` / `model` strings if the engine
 * emits them.
 */

import { StatusBadge } from '@/components/badge';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { LiveTail } from '@/components/runs/live-tail';
import { getRun } from '@/lib/api';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function LiveRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let run: Awaited<ReturnType<typeof getRun>>['run'] | null = null;
  let error: unknown = null;
  try {
    const data = await getRun(id);
    run = data.run;
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title={`Live · Run ${id.slice(0, 12)}`}
        description="Streaming events as the runtime emits them. Pause to inspect; copy any line on hover."
        actions={
          <div className="flex items-center gap-2">
            {run ? <StatusBadge status={run.status} /> : null}
            <Link
              href={`/runs/${encodeURIComponent(id)}`}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
            >
              View detail
            </Link>
          </div>
        }
      />
      {error ? (
        <ErrorView error={error} context="this run" />
      ) : run ? (
        <LiveTail runId={id} initialStatus={run.status} />
      ) : null}
    </>
  );
}
