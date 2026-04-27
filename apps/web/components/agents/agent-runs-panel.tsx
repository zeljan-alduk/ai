/**
 * Tight last-20-runs table for /agents/[name]. Server-component.
 *
 * Uses the existing /v1/runs?agentName=<n> filter — no extension to
 * the API needed.
 */

import { StatusBadge } from '@/components/badge';
import { listRuns } from '@/lib/api';
import { formatRelativeTime, formatUsd } from '@/lib/format';
import Link from 'next/link';

export async function AgentRunsPanel({ agentName }: { agentName: string }) {
  let runs: Awaited<ReturnType<typeof listRuns>> | null = null;
  let error: unknown = null;
  try {
    runs = await listRuns({ agentName, limit: 20 });
  } catch (err) {
    error = err;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Could not load runs for this agent.
      </div>
    );
  }
  if (!runs || runs.runs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
        No runs of this agent yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <table className="aldo-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Started</th>
            <th>Duration</th>
            <th className="text-right">Cost</th>
            <th>Model</th>
            <th className="text-right">ID</th>
          </tr>
        </thead>
        <tbody>
          {runs.runs.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td className="text-sm text-slate-600" title={r.startedAt}>
                {formatRelativeTime(r.startedAt)}
              </td>
              <td className="text-sm tabular-nums text-slate-600">
                {r.durationMs == null ? '—' : `${(r.durationMs / 1000).toFixed(1)}s`}
              </td>
              <td className="text-right text-sm tabular-nums text-slate-600">
                {formatUsd(r.totalUsd)}
              </td>
              <td className="font-mono text-xs text-slate-600">{r.lastModel ?? '—'}</td>
              <td className="text-right">
                <Link
                  className="font-mono text-xs text-blue-600 hover:underline"
                  href={`/runs/${encodeURIComponent(r.id)}`}
                >
                  {r.id.slice(0, 12)}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
