'use client';

/**
 * Wave-12 /observability client island.
 *
 * Polls `/v1/observability/summary` every 15s. The page is one big
 * client component because every piece updates on the same clock —
 * splitting into separate islands would just add three poll loops.
 *
 * LLM-agnostic: every column is keyed off opaque API strings.
 */

import { LocalityPieChart } from '@/components/observability/locality-pie-chart';
import { ApiClientError, getObservabilitySummary } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import type {
  ObservabilityPeriod,
  ObservabilitySummary,
  PrivacyRouterEvent,
  SafetyEvent,
} from '@aldo-ai/api-contract';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

const PERIODS: ReadonlyArray<ObservabilityPeriod> = ['24h', '7d', '30d'];

type TierFilter = 'all' | 'public' | 'internal' | 'sensitive';

export function ObservabilityPage() {
  const [period, setPeriod] = useState<ObservabilityPeriod>('24h');
  const [data, setData] = useState<ObservabilitySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');

  useEffect(() => {
    let alive = true;
    const fetchOnce = () => {
      getObservabilitySummary({ period })
        .then((res) => {
          if (!alive) return;
          setData(res);
          setError(null);
        })
        .catch((err) => {
          if (!alive) return;
          if (err instanceof ApiClientError) setError(err.message);
          else setError('failed to load observability');
        });
    };
    fetchOnce();
    const t = setInterval(fetchOnce, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [period]);

  const filteredPrivacy = useMemo(() => {
    if (data === null) return [];
    if (tierFilter === 'all') return data.privacyRouterEvents;
    // The audit row is only emitted on sensitive runs today; filtering
    // by tier === 'sensitive' yields the full feed. Other tiers just
    // return empty for now — additive: a future "denied" row could
    // carry tier metadata that this filter would key off.
    if (tierFilter === 'sensitive') return data.privacyRouterEvents;
    return [];
  }, [data, tierFilter]);

  if (error !== null) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        Couldn't load observability: {error}
      </div>
    );
  }
  if (data === null) {
    return <div className="text-sm text-slate-500">Loading…</div>;
  }

  const sparse =
    data.kpis.runsInFlight === 0 &&
    data.kpis.cloudSpendUsd === 0 &&
    data.kpis.localSpendUsd === 0 &&
    data.privacyRouterEvents.length === 0 &&
    data.safetyEvents.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <PeriodToggle period={period} setPeriod={setPeriod} />
        <p className="text-xs text-slate-500">
          Updated {formatRelativeTime(data.generatedAt)} · refreshes every 15s
        </p>
      </div>

      <KpiGrid summary={data} />

      {sparse ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">
            Once you've run agents, signals appear here.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            <Link className="text-blue-600 hover:underline" href="/welcome">
              Try the default agency template →
            </Link>
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Privacy-tier router decisions"
          subtitle="Audit rows for sensitive-tier routing."
        >
          <div className="mb-2 flex flex-wrap gap-1">
            {(['all', 'public', 'internal', 'sensitive'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTierFilter(t)}
                className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${
                  tierFilter === t
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <PrivacyRouterTable events={filteredPrivacy} />
        </Card>

        <Card
          title="Sandbox + guards activity"
          subtitle="Recent block/quarantine events. Click a row to drill in."
        >
          <SafetyFeed events={data.safetyEvents} />
        </Card>
      </div>

      <Card
        title="Local-vs-cloud routing breakdown"
        subtitle={`Spend by locality, last ${data.period}.`}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LocalityPieChart breakdown={data.localityBreakdown} />
          <ModelBreakdownTable models={data.modelBreakdown} />
        </div>
      </Card>
    </div>
  );
}

function PeriodToggle({
  period,
  setPeriod,
}: {
  period: ObservabilityPeriod;
  setPeriod: (p: ObservabilityPeriod) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setPeriod(p)}
          className={`px-2.5 py-1 text-xs ${
            period === p ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'
          }`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

function KpiGrid({ summary }: { summary: ObservabilitySummary }) {
  const k = summary.kpis;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      <Kpi label="Events/sec (1h)" value={k.eventsPerSec.toFixed(2)} />
      <Kpi label="Runs in flight" value={String(k.runsInFlight)} />
      <Kpi label="Cloud spend" value={`$${k.cloudSpendUsd.toFixed(2)}`} accent="sky" />
      <Kpi label="Local spend" value={`$${k.localSpendUsd.toFixed(2)}`} accent="emerald" />
      <Kpi
        label="Sandbox blocks (24h)"
        value={String(k.sandboxBlocks24h)}
        {...(k.sandboxBlocks24h > 0 ? { accent: 'amber' as const } : {})}
      />
      <Kpi
        label="Guards blocks (24h)"
        value={String(k.guardsBlocks24h)}
        {...(k.guardsBlocks24h > 0 ? { accent: 'amber' as const } : {})}
      />
      <Kpi
        label="Tier mismatches (24h)"
        value={String(k.privacyTierMismatches24h)}
        accent="emerald"
        sub="that's the point"
      />
    </dl>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'sky' | 'emerald' | 'amber' | 'violet';
}) {
  const accentClass =
    accent === 'sky'
      ? 'text-sky-700'
      : accent === 'emerald'
        ? 'text-emerald-700'
        : accent === 'amber'
          ? 'text-amber-700'
          : accent === 'violet'
            ? 'text-violet-700'
            : 'text-slate-900';
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`mt-0.5 font-mono text-base font-semibold tabular-nums ${accentClass}`}>
        {value}
      </dd>
      {sub ? <dd className="text-[10px] text-slate-500">{sub}</dd> : null}
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{title}</h2>
        {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function PrivacyRouterTable({ events }: { events: ReadonlyArray<PrivacyRouterEvent> }) {
  if (events.length === 0) {
    return <p className="text-xs text-slate-500">No router decisions in this window.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="aldo-table text-xs">
        <thead>
          <tr>
            <th>When</th>
            <th>Agent</th>
            <th>Model</th>
            <th>Class</th>
            <th>Enforced</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={`${e.runId}::${e.at}`} className="hover:bg-slate-50">
              <td className="text-slate-500" title={e.at}>
                {formatRelativeTime(e.at)}
              </td>
              <td>
                <Link
                  className="text-slate-900 hover:underline"
                  href={`/agents/${encodeURIComponent(e.agentName)}`}
                >
                  {e.agentName}
                </Link>
              </td>
              <td className="font-mono text-[11px] text-slate-700">{e.model}</td>
              <td className="text-slate-700">{e.classUsed}</td>
              <td>
                {e.enforced ? (
                  <span className="text-emerald-700">enforced</span>
                ) : (
                  <span className="text-rose-700">violated</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SafetyFeed({ events }: { events: ReadonlyArray<SafetyEvent> }) {
  if (events.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No sandbox or guards blocks in this window — that's the desired state.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {events.map((e) => (
        <li key={`${e.runId}::${e.at}`} className="py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500" title={e.at}>
              {formatRelativeTime(e.at)}
            </span>
            <SeverityChip severity={e.severity} kind={e.kind} />
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <Link
              className="font-mono text-blue-600 hover:underline"
              href={`/runs/${encodeURIComponent(e.runId)}`}
            >
              {e.runId.slice(0, 12)}
            </Link>
            <span className="text-slate-400">·</span>
            <span className="text-slate-700">{e.agentName ?? '—'}</span>
            <span className="text-slate-400">·</span>
            <span className="font-mono text-slate-700">{e.reason}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SeverityChip({
  severity,
  kind,
}: {
  severity: 'info' | 'warn' | 'error';
  kind: string;
}) {
  const cls =
    severity === 'error'
      ? 'bg-rose-100 text-rose-800 border-rose-200'
      : severity === 'warn'
        ? 'bg-amber-100 text-amber-800 border-amber-200'
        : 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}
    >
      {kind}
    </span>
  );
}

function ModelBreakdownTable({
  models,
}: {
  models: ReadonlyArray<{
    readonly model: string;
    readonly provider: string;
    readonly locality: string;
    readonly agentName: string;
    readonly runCount: number;
    readonly usd: number;
  }>;
}) {
  if (models.length === 0) {
    return <p className="text-xs text-slate-500">No usage rows in this window.</p>;
  }
  return (
    <div className="max-h-56 overflow-auto">
      <table className="aldo-table text-xs">
        <thead className="sticky top-0 bg-white">
          <tr>
            <th>Agent</th>
            <th>Model</th>
            <th>Locality</th>
            <th className="text-right">Runs</th>
            <th className="text-right">USD</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={`${m.agentName}::${m.model}`} className="hover:bg-slate-50">
              <td>{m.agentName}</td>
              <td className="font-mono text-[11px]">{m.model}</td>
              <td className="text-slate-700">{m.locality}</td>
              <td className="text-right tabular-nums">{m.runCount}</td>
              <td className="text-right font-mono tabular-nums">${m.usd.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
