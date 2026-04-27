/**
 * Composite-run tree rendering.
 *
 * The parent run-detail page passes the resolved root node + the run id
 * currently being viewed. The tree is server-rendered (no client island
 * — collapse state is driven by `<details>`, which the browser handles)
 * so it streams with the rest of the page.
 *
 * LLM-agnostic: each node displays the gateway-resolved capability class
 * (`classUsed`) and the opaque `model` string, never a provider enum.
 * Click on a node to drill into that run's detail page.
 */

import { StatusBadge } from '@/components/badge';
import { formatDuration, formatUsd } from '@/lib/format';
import type { RunTreeNode } from '@aldo-ai/api-contract';
import Link from 'next/link';

export function RunTree({
  tree,
  currentRunId,
}: {
  tree: RunTreeNode;
  currentRunId: string;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Run tree</h2>
          <p className="text-xs text-slate-500">
            Composite run with {countDescendants(tree)} subagent run
            {countDescendants(tree) === 1 ? '' : 's'}. Click a node to drill in.
          </p>
        </div>
      </header>
      <ol className="px-2 py-2">
        <RunTreeNodeView node={tree} depth={0} currentRunId={currentRunId} />
      </ol>
    </section>
  );
}

function RunTreeNodeView({
  node,
  depth,
  currentRunId,
}: {
  node: RunTreeNode;
  depth: number;
  currentRunId: string;
}) {
  const isCurrent = node.runId === currentRunId;
  const hasChildren = node.children.length > 0;

  // 18px of indent per level; capped via a max so deep trees don't run
  // off the right edge.
  const indentPx = Math.min(depth * 18, 144);

  const row = (
    <div
      className={`flex flex-wrap items-center gap-3 rounded px-3 py-2 text-sm ${
        isCurrent
          ? 'border-2 border-slate-900 bg-slate-50 ring-1 ring-slate-900'
          : 'border border-transparent hover:bg-slate-50'
      }`}
      style={{ marginLeft: indentPx }}
    >
      <Link
        href={`/runs/${encodeURIComponent(node.runId)}`}
        className="font-medium text-slate-900 hover:underline"
      >
        {node.agentName}
      </Link>
      <span className="font-mono text-[11px] text-slate-400">{node.agentVersion}</span>
      <StatusBadge status={node.status} />
      <span className="text-xs text-slate-500" title="Duration">
        {formatDuration(node.durationMs)}
      </span>
      <span
        className="font-mono text-xs tabular-nums text-slate-700"
        title="Self-cost (this run only)"
      >
        {formatUsd(node.totalUsd)}
      </span>
      {node.classUsed ? (
        <span
          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
          title="Capability class chosen by the gateway"
        >
          {node.classUsed}
        </span>
      ) : null}
      {node.lastModel ? (
        <span className="font-mono text-[11px] text-slate-400" title="Last model id">
          {node.lastModel}
        </span>
      ) : null}
      <Link
        href={`/runs/${encodeURIComponent(node.runId)}`}
        className="ml-auto font-mono text-xs text-blue-600 hover:underline"
      >
        {node.runId.slice(0, 12)}
      </Link>
    </div>
  );

  if (!hasChildren) {
    return <li className="my-0.5">{row}</li>;
  }

  return (
    <li className="my-0.5">
      <details open>
        <summary className="cursor-pointer list-none">{row}</summary>
        <ol className="mt-0">
          {node.children.map((c) => (
            <RunTreeNodeView key={c.runId} node={c} depth={depth + 1} currentRunId={currentRunId} />
          ))}
        </ol>
      </details>
    </li>
  );
}

function countDescendants(node: RunTreeNode): number {
  return node.children.reduce((acc, c) => acc + 1 + countDescendants(c), 0);
}
