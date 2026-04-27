/**
 * Replay-debugger view for a single run. Server component shell:
 * fetches the initial run + spans so the client mounts with a populated
 * timeline, then defers to <DebuggerClient/> for the live SSE stream
 * and command surface.
 *
 * The non-debug detail page at /runs/[id] is left untouched as a
 * read-only fallback. This subroute is the interactive view.
 */

import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listModels } from '@/lib/api';
import { getRun } from '@/lib/api';
import Link from 'next/link';
import { DebuggerClient } from './client';

export const dynamic = 'force-dynamic';

export default async function RunDebugPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let runData: Awaited<ReturnType<typeof getRun>> | null = null;
  let modelsData: Awaited<ReturnType<typeof listModels>> | null = null;
  let error: unknown = null;
  try {
    [runData, modelsData] = await Promise.all([getRun(id), listModels()]);
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title={`Debug ${id.slice(0, 12)}`}
        description="Live replay debugger: timeline, breakpoints, edit-and-resume, model swap."
        actions={
          <>
            <Link
              href={`/runs/${encodeURIComponent(id)}`}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
            >
              Detail view
            </Link>
            <Link
              href="/runs"
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
            >
              All runs
            </Link>
          </>
        }
      />
      {error ? (
        <ErrorView error={error} context="this run" />
      ) : runData ? (
        <DebuggerClient runId={id} initialRun={runData.run} models={modelsData?.models ?? []} />
      ) : null}
    </>
  );
}
