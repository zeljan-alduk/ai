import { NeutralBadge, StatusBadge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { CostRollupCard } from '@/components/runs/cost-rollup-card';
import { RunTree } from '@/components/runs/run-tree';
import { ApiClientError, getRun, getRunTree } from '@/lib/api';
import { formatAbsolute, formatDuration, formatRelativeTime, formatUsd } from '@/lib/format';
import type { RunTreeNode } from '@aldo-ai/api-contract';
import Link from 'next/link';

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

  // Tree fetch is best-effort: a child run on a wave-9 server will return
  // the whole tree; a server that doesn't yet implement /tree returns 404
  // and we fall back to "no subagent runs" UX. Anything else (including
  // 422 depth-overflow) bubbles through to the error boundary.
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
        description="Replayable execution: status, event timeline, and per-call usage."
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
        <ErrorView error={error} context="this run" />
      ) : data ? (
        <RunDetailBody run={data.run} tree={tree} currentRunId={id} />
      ) : null}
    </>
  );
}

function RunDetailBody({
  run,
  tree,
  currentRunId,
}: {
  run: Awaited<ReturnType<typeof getRun>>['run'];
  tree: RunTreeNode | null;
  currentRunId: string;
}) {
  const totalCost = run.totalUsd;
  // We render the tree + cost-rollup cards when:
  //   (a) the API returned a tree with at least one subagent run, OR
  //   (b) the run has a non-null parentRunId (so we're a CHILD viewing
  //       up at our siblings/parent — the tree is still useful), OR
  //   (c) the run's spec advertises a composite block (best-effort —
  //       AgentDetail.spec is `unknown`, we just dip-and-look).
  const hasSubagentRuns = tree !== null && countDescendants(tree) > 0;
  const isChild = run.parentRunId !== null;
  const showTree = hasSubagentRuns || isChild;

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-4 rounded-md border border-slate-200 bg-white p-5 lg:grid-cols-4">
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
          <span className="font-mono tabular-nums text-slate-900">{formatUsd(totalCost)}</span>
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
              {run.lastModel ? <span className="text-slate-400"> / {run.lastModel}</span> : null}
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
      </section>

      {showTree ? (
        tree !== null && countDescendants(tree) > 0 ? (
          <>
            <RunTree tree={tree} currentRunId={currentRunId} />
            <CostRollupCard run={run} tree={tree} />
          </>
        ) : (
          <EmptyState
            title="No subagent runs."
            hint="This run isn't part of a composite tree yet."
          />
        )
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Event timeline
        </h2>
        {run.events.length === 0 ? (
          <EmptyState title="No events recorded for this run yet." />
        ) : (
          <ol className="overflow-hidden rounded-md border border-slate-200 bg-white">
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
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Usage</h2>
        {run.usage.length === 0 ? (
          <EmptyState
            title="No model usage recorded."
            hint="This run did not call any model, or all calls were local with $0 cost."
          />
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
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
                    {formatUsd(totalCost)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
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
