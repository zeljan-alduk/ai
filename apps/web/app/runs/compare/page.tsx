/**
 * /runs/compare?a=<id>&b=<id> — wave-13 side-by-side run comparison.
 *
 * Server component end-to-end. Fetches both runs + the server-derived
 * diff in a single round-trip via `compareRuns()`. Renders three
 * panels:
 *   1. Header strip — agent / model / status / duration / cost; the
 *      model column is amber-outlined when `diff.modelChanged === true`.
 *   2. Event-by-event diff (vertical-stack flame visual) — pairs by
 *      index, ghost-rows when one side is shorter.
 *   3. Final-output textual diff — rendered via the `diff` library.
 *   4. Cost-breakdown side-by-side — Recharts stacked bar.
 *
 * URL is shareable: pasting `?a=...&b=...` on a fresh load works.
 *
 * LLM-agnostic: every model / provider field is rendered as opaque
 * strings; nothing branches on a specific provider name.
 */

import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { CostCompareChart } from '@/components/runs-compare/cost-compare-chart';
import { EventDiffPanel } from '@/components/runs-compare/event-diff-panel';
import { OutputDiffPanel } from '@/components/runs-compare/output-diff-panel';
import { RunCompareHeader } from '@/components/runs-compare/run-compare-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { compareRuns } from '@/lib/api';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function CompareRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const sp = await searchParams;
  const a = (sp.a ?? '').trim();
  const b = (sp.b ?? '').trim();

  if (!a || !b) {
    return (
      <>
        <PageHeader
          title="Compare runs"
          description="Pick two runs to see them side by side."
          actions={
            <Link
              href="/runs"
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
            >
              Back to runs
            </Link>
          }
        />
        <Card>
          <CardContent className="p-6 text-sm text-slate-600">
            Provide <code>?a=&lt;runId&gt;&amp;b=&lt;runId&gt;</code> in the URL, or open this page
            from /runs (select exactly two rows and click "Compare") or from a run detail page.
          </CardContent>
        </Card>
      </>
    );
  }

  let data: Awaited<ReturnType<typeof compareRuns>> | null = null;
  let error: unknown = null;
  try {
    data = await compareRuns(a, b);
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Compare runs"
        description={`${a.slice(0, 12)} vs ${b.slice(0, 12)}`}
        actions={
          <Link
            href="/runs"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
          >
            Back to runs
          </Link>
        }
      />
      {error ? (
        <ErrorView error={error} context="this comparison" />
      ) : data ? (
        <div className="flex flex-col gap-4">
          <RunCompareHeader a={data.a} b={data.b} diff={data.diff} />
          <Card>
            <CardHeader>
              <CardTitle>Event-by-event diff</CardTitle>
            </CardHeader>
            <CardContent>
              <EventDiffPanel a={data.a} b={data.b} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Final-output diff</CardTitle>
            </CardHeader>
            <CardContent>
              <OutputDiffPanel a={data.a} b={data.b} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Cost breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <CostCompareChart a={data.a} b={data.b} />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
