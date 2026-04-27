'use client';

/**
 * Wave-12 "Cloud spend you saved by going local" card for /models.
 *
 * Polls `/v1/models/savings?period=30d` every 60s. A tiny inline SVG
 * sparkline renders the daily savings (no Recharts here — the data is
 * a single series and the card has to stay tight). When the tenant has
 * no qualifying local-model runs, the card flips to a calm CTA.
 */

import { ApiClientError, getModelSavings } from '@/lib/api';
import type { SavingsResponse } from '@aldo-ai/api-contract';
import { useEffect, useState } from 'react';

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function SavingsCard() {
  const [data, setData] = useState<SavingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchOnce = () => {
      getModelSavings({ period: '30d' })
        .then((res) => {
          if (!alive) return;
          setData(res);
          setError(null);
        })
        .catch((err) => {
          if (!alive) return;
          if (err instanceof ApiClientError) setError(err.message);
          else setError('failed to load savings');
        });
    };
    fetchOnce();
    const t = setInterval(fetchOnce, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (error !== null) {
    return (
      <section className="overflow-hidden rounded-md border border-slate-200 bg-white px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Cloud spend saved
        </h2>
        <p className="mt-1 text-xs text-slate-500">{error}</p>
      </section>
    );
  }

  if (data === null) {
    return (
      <section className="overflow-hidden rounded-md border border-slate-200 bg-white px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Cloud spend saved
        </h2>
        <p className="mt-1 text-xs text-slate-400">Loading…</p>
      </section>
    );
  }

  if (data.localRunCount === 0) {
    return (
      <section className="overflow-hidden rounded-md border border-slate-200 bg-white px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Cloud spend saved
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Switch a sensitive-tier agent to a local model to see savings here.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          The savings figure only counts runs whose local model has a genuinely-equivalent cloud
          model in the catalogue. Nothing matched in the last {data.period}.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white px-4 py-3">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Cloud spend saved
          </h2>
          <p className="text-xs text-slate-500">
            By routing local-tier work to local models. Last {data.period}.
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl font-semibold tabular-nums text-emerald-700">
            {USD.format(data.totalSavedUsd)}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            {data.localRunCount} local run{data.localRunCount === 1 ? '' : 's'}
            {data.unmatchedLocalRunCount > 0 ? ` · ${data.unmatchedLocalRunCount} unmatched` : ''}
          </div>
        </div>
      </header>
      <div className="mt-3">
        <Sparkline data={data.dailySavings} />
      </div>
    </section>
  );
}

function Sparkline({
  data,
}: {
  data: ReadonlyArray<{ readonly date: string; readonly savedUsd: number }>;
}) {
  if (data.length === 0) return null;
  const w = 360;
  const h = 36;
  const max = Math.max(...data.map((d) => d.savedUsd), 0.000001);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const points = data
    .map((d, i) => `${(i * step).toFixed(2)},${(h - (d.savedUsd / max) * h).toFixed(2)}`)
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="block h-9 w-full"
      role="img"
      aria-label="Daily savings sparkline"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={points}
        className="text-emerald-600"
      />
    </svg>
  );
}
