'use client';

import { SweepMatrix } from '@/components/eval/matrix';
import { SweepStatusBadge } from '@/components/eval/sweep-status-badge';
import { ApiClientError } from '@/lib/api';
import { getSweep, isTerminalSweepStatus } from '@/lib/eval-client';
import { formatRelativeTime, formatUsd } from '@/lib/format';
import type { Sweep } from '@aldo-ai/api-contract';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 5_000;

export function SweepView({ initialSweep }: { initialSweep: Sweep }) {
  const [sweep, setSweep] = useState<Sweep>(initialSweep);
  const [pollError, setPollError] = useState<string | null>(null);
  const lastFetchRef = useRef<number>(Date.now());

  useEffect(() => {
    if (isTerminalSweepStatus(sweep.status)) return;

    let cancelled = false;
    const ctrl = new AbortController();

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await getSweep(sweep.id, { signal: ctrl.signal });
        if (cancelled) return;
        lastFetchRef.current = Date.now();
        setSweep(res.sweep);
        setPollError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError) {
          setPollError(err.message);
        } else if ((err as { name?: string }).name !== 'AbortError') {
          setPollError('Polling failed.');
        }
      }
    };

    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
      ctrl.abort();
    };
  }, [sweep.id, sweep.status]);

  const totalUsd = Object.values(sweep.byModel).reduce((acc, m) => acc + m.usd, 0);
  const polling = !isTerminalSweepStatus(sweep.status);

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-4 rounded-md border border-slate-200 bg-white p-5 lg:grid-cols-4">
        <Field label="Status">
          <div className="flex items-center gap-2">
            <SweepStatusBadge status={sweep.status} />
            {polling ? <span className="text-[11px] text-slate-500">polling every 5s</span> : null}
          </div>
        </Field>
        <Field label="Suite">
          <Link
            className="text-sm font-medium text-slate-900 hover:underline"
            href={`/eval/suites/${encodeURIComponent(sweep.suiteName)}`}
          >
            {sweep.suiteName}
          </Link>
          <span className="ml-1 font-mono text-xs text-slate-500">{sweep.suiteVersion}</span>
        </Field>
        <Field label="Agent">
          <Link
            className="text-sm font-medium text-slate-900 hover:underline"
            href={`/agents/${encodeURIComponent(sweep.agentName)}`}
          >
            {sweep.agentName}
          </Link>
          <span className="ml-1 font-mono text-xs text-slate-500">{sweep.agentVersion}</span>
        </Field>
        <Field label="Total cost">
          <span className="font-mono tabular-nums text-slate-900">{formatUsd(totalUsd)}</span>
        </Field>
        <Field label="Started">
          <span className="text-sm text-slate-700" title={sweep.startedAt}>
            {formatRelativeTime(sweep.startedAt)}
          </span>
        </Field>
        <Field label="Ended">
          <span className="text-sm text-slate-700" title={sweep.endedAt ?? ''}>
            {sweep.endedAt ? formatRelativeTime(sweep.endedAt) : '—'}
          </span>
        </Field>
        <Field label="Models">
          <span className="text-sm tabular-nums text-slate-800">{sweep.models.length}</span>
        </Field>
        <Field label="Cells received">
          <span className="text-sm tabular-nums text-slate-800">{sweep.cells.length}</span>
        </Field>
      </section>

      {pollError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Last refresh failed: {pollError}. Will keep retrying every 5s.
        </div>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Per-model aggregates
        </h2>
        {sweep.models.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
            No models in this sweep.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <table className="aldo-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="text-right">Passed / total</th>
                  <th className="text-right">Pass rate</th>
                  <th className="text-right">USD</th>
                </tr>
              </thead>
              <tbody>
                {sweep.models.map((m) => {
                  const agg = sweep.byModel[m];
                  const rate = agg && agg.total > 0 ? agg.passed / agg.total : null;
                  return (
                    <tr key={m}>
                      <td className="font-mono text-xs text-slate-800">{m}</td>
                      <td className="text-right text-sm tabular-nums text-slate-700">
                        {agg ? `${agg.passed} / ${agg.total}` : '—'}
                      </td>
                      <td className="text-right text-sm tabular-nums text-slate-700">
                        {rate == null ? '—' : `${(rate * 100).toFixed(0)}%`}
                      </td>
                      <td className="text-right text-sm tabular-nums text-slate-700">
                        {formatUsd(agg?.usd ?? 0)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50">
                  <td className="text-right text-sm font-medium text-slate-700" colSpan={3}>
                    Total
                  </td>
                  <td className="text-right text-sm font-semibold tabular-nums text-slate-900">
                    {formatUsd(totalUsd)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Matrix
        </h2>
        <SweepMatrix sweep={sweep} />
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
