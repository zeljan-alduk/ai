'use client';

/**
 * Wave-12 client island for /models — filter chips, search box, view
 * toggle (Cards vs Compare table), and the rendered surfaces.
 *
 * Recharts cost-comparison chart is a separate client island so this
 * module stays small and the chart can lazy-mount. Server component
 * passes the full catalogue down — no refetch on the client.
 */

import { NeutralBadge, PrivacyBadge } from '@/components/badge';
import { CostComparisonChart } from '@/components/models/cost-comparison-chart';
import {
  EMPTY_FILTERS,
  type ModelFilters,
  type ModelSummary,
  computeLocalityKpis,
  filterModels,
} from '@/components/models/filters';
import {
  AvailabilityDot,
  CapabilityBadge,
  LocalityBadge,
} from '@/components/models/locality-badge';
import type { PrivacyTier } from '@aldo-ai/api-contract';
import { useMemo, useState } from 'react';

const PRIVACY_TIERS: ReadonlyArray<PrivacyTier> = ['public', 'internal', 'sensitive'];

export function ModelsExplorer({ models }: { models: ReadonlyArray<ModelSummary> }) {
  const [filters, setFilters] = useState<ModelFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<'cards' | 'compare'>('cards');

  const filtered = useMemo(() => filterModels(models, filters), [models, filters]);
  const kpis = useMemo(() => computeLocalityKpis(models), [models]);
  const localities = useMemo(() => Array.from(new Set(models.map((m) => m.locality))), [models]);
  const classes = useMemo(
    () => Array.from(new Set(models.map((m) => m.capabilityClass))).sort(),
    [models],
  );

  const toggleSet = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <div className="space-y-6">
      <KpiRow kpis={kpis} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterGroup label="Locality">
            {localities.map((l) => (
              <Chip
                key={l}
                active={filters.localities.has(l)}
                onClick={() =>
                  setFilters({ ...filters, localities: toggleSet(filters.localities, l) })
                }
              >
                {l}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup label="Privacy">
            {PRIVACY_TIERS.map((t) => (
              <Chip
                key={t}
                active={filters.privacy.has(t)}
                onClick={() => setFilters({ ...filters, privacy: toggleSet(filters.privacy, t) })}
              >
                {t}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup label="Class">
            {classes.map((cl) => (
              <Chip
                key={cl}
                active={filters.capabilityClasses.has(cl)}
                onClick={() =>
                  setFilters({
                    ...filters,
                    capabilityClasses: toggleSet(filters.capabilityClasses, cl),
                  })
                }
              >
                {cl}
              </Chip>
            ))}
          </FilterGroup>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="search"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Search id, provider, class…"
            className="w-56 rounded border border-slate-300 bg-white px-2 py-1 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
          <ViewToggle view={view} setView={setView} />
        </div>
      </div>

      <CostComparisonChart models={filtered} />

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
          No models match these filters. Clear a chip to widen the result.
        </div>
      ) : view === 'cards' ? (
        <CardsGrid models={filtered} />
      ) : (
        <CompareTable models={filtered} />
      )}
    </div>
  );
}

function KpiRow({ kpis }: { kpis: ReturnType<typeof computeLocalityKpis> }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Kpi label="Models" value={String(kpis.total)} />
      <Kpi label="Cloud" value={String(kpis.cloud)} accent="sky" />
      <Kpi label="Local" value={String(kpis.local)} accent="emerald" />
      <Kpi label="On-prem" value={String(kpis.onPrem)} accent="violet" />
      <Kpi
        label="Avg $/Mtok cloud"
        value={`$${kpis.avgCloudCost.toFixed(2)}`}
        sub={`local avg $${kpis.avgLocalCost.toFixed(2)}`}
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
  accent?: 'sky' | 'emerald' | 'violet';
}) {
  const accentClass =
    accent === 'sky'
      ? 'text-sky-700'
      : accent === 'emerald'
        ? 'text-emerald-700'
        : accent === 'violet'
          ? 'text-violet-700'
          : 'text-slate-900';
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`mt-1 font-mono text-lg font-semibold tabular-nums ${accentClass}`}>
        {value}
      </dd>
      {sub ? <dd className="text-[11px] text-slate-500">{sub}</dd> : null}
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide transition-colors ${
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function ViewToggle({
  view,
  setView,
}: {
  view: 'cards' | 'compare';
  setView: (v: 'cards' | 'compare') => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
      <button
        type="button"
        onClick={() => setView('cards')}
        className={`px-2.5 py-1 text-xs ${
          view === 'cards' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'
        }`}
      >
        Cards
      </button>
      <button
        type="button"
        onClick={() => setView('compare')}
        className={`px-2.5 py-1 text-xs ${
          view === 'compare' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'
        }`}
      >
        Compare
      </button>
    </div>
  );
}

function CardsGrid({ models }: { models: ReadonlyArray<ModelSummary> }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {models.map((m) => (
        <ModelCard key={m.id} model={m} />
      ))}
    </div>
  );
}

function ModelCard({ model }: { model: ModelSummary }) {
  return (
    <article
      className={`flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-4 ${
        model.available ? '' : 'opacity-70'
      }`}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm font-semibold text-slate-900">{model.id}</div>
          <div className="text-xs text-slate-500">runtime: {model.provider}</div>
        </div>
        <AvailabilityDot available={model.available} hasKey={model.lastProbedAt !== undefined} />
      </header>
      <div className="flex flex-wrap gap-1.5">
        <LocalityBadge locality={model.locality} />
        <CapabilityBadge>{model.capabilityClass}</CapabilityBadge>
      </div>
      <div className="flex flex-wrap gap-1">
        {model.privacyAllowed.map((t) => (
          <PrivacyBadge key={t} tier={t} />
        ))}
      </div>
      <dl className="mt-1 grid grid-cols-3 gap-2 text-xs">
        <CardStat label="$/Mtok in" value={fmtUsd(model.cost.usdPerMtokIn)} />
        <CardStat label="$/Mtok out" value={fmtUsd(model.cost.usdPerMtokOut)} />
        <CardStat
          label="Latency p95"
          value={model.latencyP95Ms !== undefined ? `${model.latencyP95Ms}ms` : '—'}
        />
      </dl>
      {model.provides.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {model.provides.slice(0, 4).map((p) => (
            <NeutralBadge key={p}>{p}</NeutralBadge>
          ))}
          {model.provides.length > 4 ? (
            <span className="text-[11px] text-slate-400">+{model.provides.length - 4} more</span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function CardStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="font-mono tabular-nums text-slate-800">{value}</dd>
    </div>
  );
}

function fmtUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function CompareTable({ models }: { models: ReadonlyArray<ModelSummary> }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="aldo-table">
        <thead className="sticky top-0 z-10 bg-white">
          <tr>
            <th className="text-left">Field</th>
            {models.map((m) => (
              <th key={m.id} className="text-left">
                <span className="font-mono text-xs">{m.id}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <CompareRow
            label="Locality"
            cells={models.map((m) => ({
              id: m.id,
              node: <LocalityBadge locality={m.locality} />,
            }))}
          />
          <CompareRow
            label="Class"
            cells={models.map((m) => ({
              id: m.id,
              node: <CapabilityBadge>{m.capabilityClass}</CapabilityBadge>,
            }))}
          />
          <CompareRow
            label="Context"
            cells={models.map((m) => ({
              id: m.id,
              node: (
                <span className="text-xs tabular-nums">
                  {m.effectiveContextTokens.toLocaleString()}
                </span>
              ),
            }))}
          />
          <CompareRow
            label="$/Mtok in"
            cells={models.map((m) => ({
              id: m.id,
              node: (
                <span className="font-mono tabular-nums text-xs">
                  {fmtUsd(m.cost.usdPerMtokIn)}
                </span>
              ),
            }))}
          />
          <CompareRow
            label="$/Mtok out"
            cells={models.map((m) => ({
              id: m.id,
              node: (
                <span className="font-mono tabular-nums text-xs">
                  {fmtUsd(m.cost.usdPerMtokOut)}
                </span>
              ),
            }))}
          />
          <CompareRow
            label="Latency p95"
            cells={models.map((m) => ({
              id: m.id,
              node: (
                <span className="text-xs tabular-nums">
                  {m.latencyP95Ms !== undefined ? `${m.latencyP95Ms}ms` : '—'}
                </span>
              ),
            }))}
          />
          <CompareRow
            label="Privacy allowed"
            cells={models.map((m) => ({
              id: m.id,
              node: (
                <span className="flex flex-wrap gap-1">
                  {m.privacyAllowed.map((t) => (
                    <PrivacyBadge key={t} tier={t} />
                  ))}
                </span>
              ),
            }))}
          />
          <CompareRow
            label="Capabilities"
            cells={models.map((m) => ({
              id: m.id,
              node: (
                <span className="flex flex-wrap gap-1">
                  {m.provides.slice(0, 3).map((p) => (
                    <NeutralBadge key={p}>{p}</NeutralBadge>
                  ))}
                  {m.provides.length > 3 ? (
                    <span className="text-[10px] text-slate-400">+{m.provides.length - 3}</span>
                  ) : null}
                </span>
              ),
            }))}
          />
          <CompareRow
            label="Available"
            cells={models.map((m) => ({
              id: m.id,
              node: (
                <AvailabilityDot available={m.available} hasKey={m.lastProbedAt !== undefined} />
              ),
            }))}
          />
        </tbody>
      </table>
    </div>
  );
}

function CompareRow({
  label,
  cells,
}: {
  label: string;
  cells: ReadonlyArray<{ id: string; node: React.ReactNode }>;
}) {
  return (
    <tr>
      <td className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </td>
      {cells.map((cell) => (
        <td key={`${label}::${cell.id}`} className="text-sm">
          {cell.node}
        </td>
      ))}
    </tr>
  );
}
