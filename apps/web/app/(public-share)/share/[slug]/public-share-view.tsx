/**
 * <PublicShareView> — server-rendered projection of a shared resource.
 *
 * The shape comes from `/v1/public/share/:slug` (api-contract:
 * PublicSharedResource). The viewer branches on `kind` and renders a
 * read-only summary + watermark. No interactive editor surfaces — the
 * "sign up to comment + iterate" CTA in the layout funnels the visitor.
 */

import { formatAbsolute, formatDuration, formatUsd } from '@/lib/format';
import type { AnnotationTargetKind, PublicSharedResource } from '@aldo-ai/api-contract';

export interface PublicShareViewProps {
  readonly share: {
    slug: string;
    targetKind: AnnotationTargetKind;
    targetId: string;
    expiresAt: string | null;
    createdAt: string;
  };
  readonly resource: PublicSharedResource;
}

export function PublicShareView({ share, resource }: PublicShareViewProps) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      {/* Watermark + meta header. */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated p-4">
        <div>
          <h1 className="text-lg font-semibold text-fg">{titleFor(resource)}</h1>
          <p className="mt-1 text-xs text-fg-muted">
            Shared {formatAbsolute(share.createdAt)}
            {share.expiresAt !== null ? ` · expires ${formatAbsolute(share.expiresAt)}` : ''}
          </p>
        </div>
        <span className="rounded bg-accent/10 px-2 py-1 text-xs text-accent">Read-only</span>
      </div>

      {resource.kind === 'run' && <RunView resource={resource} />}
      {resource.kind === 'sweep' && <SweepView resource={resource} />}
      {resource.kind === 'agent' && <AgentView resource={resource} />}
    </div>
  );
}

function titleFor(resource: PublicSharedResource): string {
  if (resource.kind === 'run') {
    return `Run ${resource.run.id.slice(0, 12)} · ${resource.run.agentName}`;
  }
  if (resource.kind === 'sweep') {
    return `Eval sweep · ${resource.sweep.agentName ?? 'unknown'}`;
  }
  return `Agent · ${resource.agent.name}`;
}

function RunView({ resource }: { resource: Extract<PublicSharedResource, { kind: 'run' }> }) {
  const { run } = resource;
  const durationMs =
    run.endedAt !== null ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-bg-elevated p-4 text-sm md:grid-cols-4">
        <Stat label="Status" value={run.status} />
        <Stat label="Agent" value={`${run.agentName} ${run.agentVersion}`} />
        <Stat
          label="Duration"
          value={durationMs === null ? '—' : formatDuration(durationMs / 1000)}
        />
        <Stat label="Total cost" value={formatUsd(run.totalUsd)} />
      </div>

      {/* Final output. */}
      {run.finalOutput !== null && run.finalOutput !== undefined && (
        <div className="rounded-lg border border-border bg-bg-elevated p-4">
          <h2 className="mb-2 text-sm font-semibold text-fg">Final output</h2>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded border border-border bg-bg p-2 text-xs text-fg">
            {typeof run.finalOutput === 'string'
              ? run.finalOutput
              : JSON.stringify(run.finalOutput, null, 2)}
          </pre>
        </div>
      )}

      {/* Flame-graph as a simple SVG bar list (no client islands — the
          full interactive flame graph is gated behind sign-in). */}
      {run.events.length > 0 && (
        <div className="rounded-lg border border-border bg-bg-elevated p-4">
          <h2 className="mb-2 text-sm font-semibold text-fg">Trace</h2>
          <ol className="flex flex-col gap-1 text-xs">
            {run.events.map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-3 border-b border-border py-1 last:border-b-0"
              >
                <span className="w-32 shrink-0 font-mono text-fg-muted">
                  {formatAbsolute(e.at).slice(11, 19)}
                </span>
                <span className="w-40 shrink-0 rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-fg">
                  {e.type}
                </span>
                <span className="flex-1 truncate text-fg-muted">{summarisePayload(e.payload)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function SweepView({ resource }: { resource: Extract<PublicSharedResource, { kind: 'sweep' }> }) {
  const { sweep } = resource;
  const matrix = (Array.isArray(sweep.matrix) ? sweep.matrix : []) as Array<{
    caseId: string;
    model: string;
    passed: boolean;
    score: number;
    output: string;
    costUsd: number;
  }>;
  const summary =
    sweep.summary !== null && typeof sweep.summary === 'object'
      ? (sweep.summary as {
          totalCells?: number;
          totalUsd?: number;
          perModel?: { model: string; passed: number; total: number; costUsd: number }[];
        })
      : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-bg-elevated p-4 text-sm">
        <h2 className="mb-2 text-sm font-semibold text-fg">Per-model summary</h2>
        {summary?.perModel === undefined || summary.perModel.length === 0 ? (
          <p className="text-fg-muted">No summary available.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-fg-muted">
              <tr>
                <th className="text-left font-medium">Model</th>
                <th className="text-right font-medium">Passed</th>
                <th className="text-right font-medium">Total</th>
                <th className="text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {summary.perModel.map((row) => (
                <tr key={row.model} className="border-t border-border">
                  <td className="py-1 font-mono text-fg">{row.model}</td>
                  <td className="py-1 text-right tabular-nums text-fg">{row.passed}</td>
                  <td className="py-1 text-right tabular-nums text-fg-muted">{row.total}</td>
                  <td className="py-1 text-right tabular-nums text-fg">{formatUsd(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="rounded-lg border border-border bg-bg-elevated p-4">
        <h2 className="mb-2 text-sm font-semibold text-fg">Matrix</h2>
        {matrix.length === 0 ? (
          <p className="text-xs text-fg-muted">Empty matrix.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {matrix.map((c, idx) => (
              <li
                key={`${c.caseId}-${c.model}-${idx}`}
                className="flex items-center justify-between rounded border border-border bg-bg p-2"
              >
                <span className="truncate font-mono text-fg">{c.caseId}</span>
                <span className="ml-2 font-mono text-fg-muted">{c.model}</span>
                <span
                  className={
                    c.passed
                      ? 'ml-2 rounded bg-success/10 px-1.5 text-success'
                      : 'ml-2 rounded bg-danger/10 px-1.5 text-danger'
                  }
                >
                  {c.passed ? 'pass' : 'fail'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AgentView({ resource }: { resource: Extract<PublicSharedResource, { kind: 'agent' }> }) {
  const { agent } = resource;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-bg-elevated p-4 text-sm">
        <h2 className="text-sm font-semibold text-fg">{agent.name}</h2>
        <p className="text-xs text-fg-muted">version {agent.version}</p>
        {agent.description !== null && agent.description.length > 0 && (
          <p className="mt-2 text-sm text-fg-muted">{agent.description}</p>
        )}
      </div>
      <div className="rounded-lg border border-border bg-bg-elevated p-4">
        <h2 className="mb-2 text-sm font-semibold text-fg">Spec</h2>
        <pre className="overflow-x-auto whitespace-pre rounded border border-border bg-bg p-2 text-xs text-fg">
          {agent.specYaml}
        </pre>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-1 font-medium text-fg">{value}</div>
    </div>
  );
}

function summarisePayload(payload: unknown): string {
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload;
  try {
    const s = JSON.stringify(payload);
    return s.length > 200 ? `${s.slice(0, 197)}...` : s;
  } catch {
    return String(payload);
  }
}
