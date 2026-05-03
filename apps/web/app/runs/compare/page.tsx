/**
 * /runs/compare — N-way side-by-side run comparison.
 *
 * Wave-4 (2026-05-03) extension of the wave-13 2-way `?a=&b=` view:
 * the same URL now accepts `?ids=<id1>,<id2>,<id3>,…` for arbitrary N
 * (capped at 6 by `MAX_RUNS` for readability). The legacy `?a=&b=`
 * pair is honoured for backwards-compatible deep links and saved
 * views; when both forms are present, `ids` wins.
 *
 * Layout:
 *   1. Toolbar — filter toggles + permalink + add-run picker.
 *   2. Stack-bar charts — token usage / cost / latency, normalised
 *      across the visible columns.
 *   3. Fork-lineage banner — preserved from the 2-way view; auto-
 *      detects every parent→child edge in the set.
 *   4. N-way table — sticky first column (row labels) + sticky column
 *      headers; per-row median-deviation diff highlighting.
 *   5. Legacy 2-way panes — when N=2 we still surface the event-by-
 *      event diff and the textual output diff so the wave-13 deep
 *      links don't lose surface area.
 *
 * Each run is fetched independently; a 404 on one slot renders that
 * column with a "not found / not authorized" badge instead of erroring
 * the whole page (per the spec — operators routinely paste shareable
 * links into a workspace they don't have access to every id of).
 *
 * LLM-agnostic: every model / provider field is rendered as opaque
 * strings; nothing branches on a specific provider name.
 */

import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { CostCompareChart } from '@/components/runs-compare/cost-compare-chart';
import { EventDiffPanel } from '@/components/runs-compare/event-diff-panel';
import { NWayAddRunButton } from '@/components/runs-compare/n-way/n-way-add-run-button';
import { NWayForkBanner } from '@/components/runs-compare/n-way/n-way-fork-banner';
import {
  type ComparisonColumn,
  MAX_RUNS,
  buildComparisonTable,
  detectForkLineage,
  parseCompareQuery,
} from '@/components/runs-compare/n-way/n-way-rows';
import { NWayStackBars } from '@/components/runs-compare/n-way/n-way-stack-bars';
import { NWayTable } from '@/components/runs-compare/n-way/n-way-table';
import { NWayToolbar } from '@/components/runs-compare/n-way/n-way-toolbar';
import { OutputDiffPanel } from '@/components/runs-compare/output-diff-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiClientError, getRun } from '@/lib/api';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function CompareRunsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ids?: string;
    a?: string;
    b?: string;
    diffs?: string;
    metrics?: string;
  }>;
}) {
  const sp = await searchParams;
  const ids = parseCompareQuery({
    ...(sp.ids !== undefined ? { ids: sp.ids } : {}),
    ...(sp.a !== undefined ? { a: sp.a } : {}),
    ...(sp.b !== undefined ? { b: sp.b } : {}),
  });
  const showOnlyDiffs = sp.diffs === '1';
  const showOnlyMetrics = sp.metrics === '1';

  /* ------------------------------- 0 runs -------------------------------- */
  if (ids.length === 0) {
    return (
      <>
        <PageHeader
          title="Compare runs"
          description="Pick runs to see them side by side."
          actions={
            <Link
              href="/runs"
              className="rounded-md border border-border bg-bg-elevated px-3 py-1 text-sm hover:bg-bg-subtle"
            >
              Back to runs
            </Link>
          }
        />
        <Card>
          <CardContent className="p-6 text-sm text-fg-muted">
            <p className="mb-3">
              Provide <code>?ids=&lt;id1&gt;,&lt;id2&gt;,…</code> in the URL (or the legacy
              <code> ?a=&lt;id&gt;&amp;b=&lt;id&gt;</code> pair). Open this page from the runs list
              (multi-select rows and click "Compare") or from a run detail page.
            </p>
            <Link
              href="/runs"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-3 py-1 text-sm hover:bg-bg-subtle"
            >
              Open the runs picker →
            </Link>
          </CardContent>
        </Card>
      </>
    );
  }

  /* ----------------- fetch every id in parallel, 404-tolerant ------------- */
  let resolvedColumns: ComparisonColumn[] | null = null;
  let pageError: unknown = null;
  try {
    resolvedColumns = await Promise.all(
      ids.map(async (id): Promise<ComparisonColumn> => {
        try {
          const res = await getRun(id);
          return { kind: 'run', id, run: res.run };
        } catch (err) {
          if (err instanceof ApiClientError && (err.status === 404 || err.status === 403)) {
            return {
              kind: 'not-found',
              id,
              reason: err.status === 403 ? 'not authorized' : 'not found',
            };
          }
          throw err;
        }
      }),
    );
  } catch (err) {
    pageError = err;
  }

  if (pageError !== null) {
    return (
      <>
        <PageHeader title="Compare runs" description={`${ids.length} runs`} />
        <ErrorView error={pageError} context="this comparison" />
      </>
    );
  }

  const cols = resolvedColumns ?? [];
  const { rows, stackBars } = buildComparisonTable(cols);
  const forkEdges = detectForkLineage(cols);

  const titleParts = ids.map((id, i) => `${i + 1}·${id.slice(0, 8)}`);
  const description =
    ids.length === 1
      ? `${ids[0]?.slice(0, 16)} — add another run to compare`
      : `${cols.length} runs · ${titleParts.join(' / ')}`;

  /* ------------------------------ 1 run hint ----------------------------- */
  const singleRunHint =
    ids.length === 1 ? (
      <Card data-testid="nway-single-run-hint">
        <CardContent className="p-4 text-xs text-fg-muted">
          You're viewing a single run. Click <strong>Add run to compare</strong> to bring more runs
          into this view (up to {MAX_RUNS}).
        </CardContent>
      </Card>
    ) : null;

  /* ----------------------------- 2-way panes ----------------------------- */
  const legacyTwoWay =
    cols.length === 2 && cols[0]?.kind === 'run' && cols[1]?.kind === 'run' ? (
      <>
        <Card>
          <CardHeader>
            <CardTitle>Event-by-event diff</CardTitle>
          </CardHeader>
          <CardContent>
            <EventDiffPanel a={cols[0].run} b={cols[1].run} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Final-output diff</CardTitle>
          </CardHeader>
          <CardContent>
            <OutputDiffPanel a={cols[0].run} b={cols[1].run} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cost breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <CostCompareChart a={cols[0].run} b={cols[1].run} />
          </CardContent>
        </Card>
      </>
    ) : null;

  return (
    <>
      <PageHeader
        title="Compare runs"
        description={description}
        actions={
          <div className="flex items-center gap-2">
            <NWayAddRunButton existingIds={ids} />
            <Link
              href="/runs"
              className="rounded-md border border-border bg-bg-elevated px-3 py-1 text-sm hover:bg-bg-subtle"
            >
              Back to runs
            </Link>
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        <NWayToolbar showOnlyDiffs={showOnlyDiffs} showOnlyMetrics={showOnlyMetrics} />
        {singleRunHint}
        <NWayForkBanner columns={cols} edges={forkEdges} />
        {cols.length >= 1 ? (
          <>
            <section data-testid="nway-stack-bars">
              <NWayStackBars points={stackBars} />
            </section>
            <section data-testid="nway-table">
              <NWayTable
                columns={cols}
                rows={rows}
                ids={ids}
                showOnlyDiffs={showOnlyDiffs}
                showOnlyMetrics={showOnlyMetrics}
              />
            </section>
          </>
        ) : null}
        {legacyTwoWay}
      </div>
    </>
  );
}
