/**
 * Header strip for /runs/compare. Renders agent / version / model /
 * status / duration / cost as a 2-column field grid; the model field
 * gets an amber outline when the server's diff payload says the model
 * id changed between runs.
 *
 * LLM-agnostic: every model / provider value is rendered as opaque
 * strings; the "model changed" indicator is a server-derived boolean.
 */

import { NeutralBadge, StatusBadge } from '@/components/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatDuration, formatRelativeTime, formatUsd } from '@/lib/format';
import type { RunCompareDiff, RunDetail } from '@aldo-ai/api-contract';
import Link from 'next/link';

export function RunCompareHeader({
  a,
  b,
  diff,
}: {
  a: RunDetail;
  b: RunDetail;
  diff: RunCompareDiff;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <RunCompareHeaderPane side="A" run={a} modelChanged={diff.modelChanged} />
      <RunCompareHeaderPane side="B" run={b} modelChanged={diff.modelChanged} />
      <Card className="lg:col-span-2">
        <CardContent className="grid grid-cols-2 gap-4 pt-6 text-sm sm:grid-cols-4">
          <DiffField label="Event count Δ" value={String(diff.eventCountDiff)} />
          <DiffField label="Cost Δ" value={signedUsd(diff.costDiff)} />
          <DiffField
            label="Duration Δ"
            value={diff.durationDiff !== null ? signedDuration(diff.durationDiff) : '—'}
          />
          <DiffField
            label="Same agent"
            value={diff.sameAgent ? 'yes' : 'no'}
            tone={diff.sameAgent ? 'neutral' : 'amber'}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function RunCompareHeaderPane({
  side,
  run,
  modelChanged,
}: {
  side: 'A' | 'B';
  run: RunDetail;
  modelChanged: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Run {side}</span>
          <Link
            href={`/runs/${encodeURIComponent(run.id)}`}
            className="font-mono text-[11px] text-blue-600 hover:underline"
          >
            {run.id.slice(0, 16)}
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
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
            <span className="font-mono tabular-nums text-slate-900">{formatUsd(run.totalUsd)}</span>
          </Field>
          <Field label="Duration">
            <span className="text-slate-900">{formatDuration(run.durationMs)}</span>
          </Field>
          <Field label="Started">
            <span className="text-sm text-slate-700" title={run.startedAt}>
              {formatRelativeTime(run.startedAt)}
            </span>
          </Field>
          <Field
            label="Last model"
            // Highlight the model field with an amber outline when the
            // diff says the model id changed across runs. Visual cue
            // for the most common operator question: "did we change
            // models?"
            highlight={modelChanged}
          >
            {run.lastModel ? (
              <span className="font-mono text-xs text-slate-700">
                {run.lastProvider ? `${run.lastProvider} / ` : ''}
                {run.lastModel}
              </span>
            ) : (
              <NeutralBadge>local only</NeutralBadge>
            )}
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  highlight,
}: {
  label: string;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight ? 'rounded border border-amber-300 bg-amber-50 px-2 py-1' : 'rounded px-2 py-1'
      }
    >
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function DiffField({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'amber';
}) {
  return (
    <div
      className={
        tone === 'amber'
          ? 'rounded border border-amber-300 bg-amber-50 px-3 py-2'
          : 'rounded border border-slate-200 bg-slate-50 px-3 py-2'
      }
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-sm tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function signedUsd(n: number): string {
  if (n === 0) return formatUsd(0);
  return n > 0 ? `+${formatUsd(n)}` : `-${formatUsd(-n)}`;
}

function signedDuration(ms: number): string {
  if (ms === 0) return '0ms';
  return ms > 0 ? `+${formatDuration(ms)}` : `-${formatDuration(-ms)}`;
}
