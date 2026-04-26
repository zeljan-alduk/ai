/**
 * /runs/[id] — wave-12 redesign.
 *
 * Layout:
 *   - Header card: agent + version + status + duration + cost
 *   - Tabs: Timeline | Events | Tree | Replay
 *     - Timeline: TRACE FLAME GRAPH (SVG) + side-panel sheet on click
 *     - Events:   classic event list (restyled)
 *     - Tree:     wave-9 RunTree restyled
 *     - Replay:   scrubber that walks events in real-time order
 *   - Below tabs: cost-breakdown chart (stacked bar, Recharts)
 *
 * Server-component first: the page owns the data fetch and renders all
 * markup; the tab switcher + flame graph + replay scrubber are client
 * islands so most of the surface is still SSR.
 *
 * LLM-agnostic: rows display opaque provider/model strings only.
 */

import { NeutralBadge, StatusBadge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { CompareWithButton } from '@/components/runs-compare/compare-with-button';
import { CostBreakdownChart } from '@/components/runs/cost-breakdown-chart';
import { CostRollupCard } from '@/components/runs/cost-rollup-card';
import { ReplayScrubber } from '@/components/runs/replay-scrubber';
import { RunDetailTabs } from '@/components/runs/run-detail-tabs';
import { RunTree } from '@/components/runs/run-tree';
import { TimelineView } from '@/components/runs/timeline-view';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiClientError, getRun, getRunTree } from '@/lib/api';
import { formatAbsolute, formatDuration, formatRelativeTime, formatUsd } from '@/lib/format';
import type { RunDetail, RunTreeNode } from '@aldo-ai/api-contract';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let data: Awaited<ReturnType<typeof getRun>> | null = null;
  let tree: RunTreeNode | null = null;
  let error: unknown = null;
  try {
    data = await getRun(id);
  } catch (err) {
    error = err;
  }

  // Wave-13 — auto-redirect to /runs/[id]/live when the run is still
  // in flight. The live page renders the SSE stream + filter chips;
  // landing on it directly avoids the "is this still running?"
  // double-take. Terminal-status runs stay on the detail page (where
  // the timeline / replay tabs live).
  if (data !== null && data.run.status === 'running') {
    redirect(`/runs/${encodeURIComponent(id)}/live`);
  }

  if (data !== null) {
    try {
      const res = await getRunTree(id);
      tree = res.tree;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        tree = null;
      } else {
        error = err;
      }
    }
  }

  return (
    <>
      <PageHeader
        title={`Run ${id.slice(0, 12)}`}
        description="Trace, events, and replay. Click any bar to drill into a span."
        actions={
          <div className="flex items-center gap-2">
            <CompareWithButton currentRunId={id} />
            <Link
              href="/runs"
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
            >
              Back to runs
            </Link>
          </div>
        }
      />
      {error ? (
        <ErrorView error={error} context="this run" />
      ) : data ? (
        <RunDetailBody run={data.run} tree={tree} runId={id} />
      ) : null}
    </>
  );
}

function RunDetailBody({
  run,
  tree,
  runId,
}: {
  run: RunDetail;
  tree: RunTreeNode | null;
  runId: string;
}) {
  const effectiveTree: RunTreeNode = tree ?? synthesiseTreeOfOne(run);
  const isChild = run.parentRunId !== null;
  const showSubtreeUi = (tree !== null && countDescendants(tree) > 0) || isChild;

  const timelinePanel = <TimelineView tree={effectiveTree} run={run} />;

  const eventsPanel = (
    <Card>
      {run.events.length === 0 ? (
        <CardContent>
          <EmptyState title="No events recorded for this run yet." />
        </CardContent>
      ) : (
        <ol>
          {run.events.map((ev, idx) => (
            <li
              key={ev.id}
              className={`flex items-start gap-4 px-4 py-3 ${
                idx === run.events.length - 1 ? '' : 'border-b border-slate-100'
              }`}
            >
              <div className="w-32 shrink-0 text-xs text-slate-500" title={ev.at}>
                {formatAbsolute(ev.at).slice(11, 19)}
              </div>
              <div className="w-40 shrink-0">
                <NeutralBadge>{ev.type}</NeutralBadge>
              </div>
              <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                {summarizePayload(ev.payload)}
              </pre>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );

  const treePanel =
    showSubtreeUi && tree !== null && countDescendants(tree) > 0 ? (
      <RunTree tree={tree} currentRunId={runId} />
    ) : (
      <Card>
        <CardContent>
          <EmptyState
            title="No subagent runs."
            hint="This run isn't part of a composite tree yet."
          />
        </CardContent>
      </Card>
    );

  const replayPanel =
    run.events.length === 0 ? (
      <Card>
        <CardContent>
          <EmptyState
            title="Nothing to replay yet."
            hint="Events arrive as the runtime emits them; come back once the run has activity."
          />
        </CardContent>
      </Card>
    ) : (
      <ReplayScrubber run={run} />
    );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Field label="Status">
              <StatusBadge status={run.status} />
            </Field>
            <Field label="Agent">
              <Link
                className="text-sm font-medium text-slate-900 hover:underline"
                href={`/agents/${encodeURIComponent(run.agentName)}`}
              >
                {run.agentName}
              </Link>
              <span className="ml-1 text-xs text-slate-500">{run.agentVersion}</span>
            </Field>
            <Field label="Cost">
              <span className="font-mono tabular-nums text-slate-900">
                {formatUsd(run.totalUsd)}
              </span>
            </Field>
            <Field label="Duration">
              <span className="text-slate-900">{formatDuration(run.durationMs)}</span>
            </Field>
            <Field label="Started">
              <span className="text-sm text-slate-700" title={run.startedAt}>
                {formatRelativeTime(run.startedAt)}
              </span>
            </Field>
            <Field label="Ended">
              <span className="text-sm text-slate-700" title={run.endedAt ?? ''}>
                {run.endedAt ? formatRelativeTime(run.endedAt) : '—'}
              </span>
            </Field>
            <Field label="Last provider / model">
              {run.lastProvider ? (
                <span className="text-sm text-slate-700">
                  {run.lastProvider}
                  {run.lastModel ? (
                    <span className="text-slate-400"> / {run.lastModel}</span>
                  ) : null}
                </span>
              ) : (
                <span className="text-sm text-slate-400">local only</span>
              )}
            </Field>
            <Field label="Parent run">
              {run.parentRunId ? (
                <Link
                  href={`/runs/${encodeURIComponent(run.parentRunId)}`}
                  className="font-mono text-xs text-blue-600 hover:underline"
                >
                  {run.parentRunId.slice(0, 12)}
                </Link>
              ) : (
                <span className="text-sm text-slate-400">—</span>
              )}
            </Field>
          </div>
        </CardContent>
      </Card>

      <RunDetailTabs
        timeline={timelinePanel}
        events={eventsPanel}
        tree={treePanel}
        replay={replayPanel}
      />

      <Card>
        <CardHeader>
          <CardTitle>Cost breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <CostBreakdownChart run={run} tree={tree} />
        </CardContent>
      </Card>

      {showSubtreeUi && tree !== null ? <CostRollupCard run={run} tree={tree} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
        </CardHeader>
        {run.usage.length === 0 ? (
          <CardContent>
            <EmptyState
              title="No model usage recorded."
              hint="This run did not call any model, or all calls were local with $0 cost."
            />
          </CardContent>
        ) : (
          <div className="overflow-hidden">
            <table className="aldo-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th className="text-right">Tokens in</th>
                  <th className="text-right">Tokens out</th>
                  <th className="text-right">USD</th>
                </tr>
              </thead>
              <tbody>
                {run.usage.map((u, idx) => (
                  <tr key={`${u.at}-${idx}`}>
                    <td className="text-sm text-slate-600" title={u.at}>
                      {formatRelativeTime(u.at)}
                    </td>
                    <td className="text-sm text-slate-700">{u.provider}</td>
                    <td className="text-sm text-slate-700">{u.model}</td>
                    <td className="text-right text-sm tabular-nums">
                      {u.tokensIn.toLocaleString()}
                    </td>
                    <td className="text-right text-sm tabular-nums">
                      {u.tokensOut.toLocaleString()}
                    </td>
                    <td className="text-right text-sm tabular-nums">{formatUsd(u.usd)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50">
                  <td colSpan={5} className="text-right text-sm font-medium text-slate-700">
                    Total
                  </td>
                  <td className="text-right text-sm font-semibold tabular-nums text-slate-900">
                    {formatUsd(run.totalUsd)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function countDescendants(node: RunTreeNode): number {
  return node.children.reduce((acc, c) => acc + 1 + countDescendants(c), 0);
}

function summarizePayload(payload: unknown): string {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function synthesiseTreeOfOne(run: RunDetail): RunTreeNode {
  return {
    runId: run.id,
    agentName: run.agentName,
    agentVersion: run.agentVersion,
    status: run.status,
    parentRunId: run.parentRunId,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    totalUsd: run.totalUsd,
    lastProvider: run.lastProvider,
    lastModel: run.lastModel,
    children: [],
  };
}
