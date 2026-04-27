'use client';

import { ApiClientError } from '@/lib/api';
import { startSweep } from '@/lib/eval-client';
import type { ListModelsResponse, ListSuitesResponse } from '@aldo-ai/api-contract';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

type SuiteSummary = ListSuitesResponse['suites'][number];
type ModelSummary = ListModelsResponse['models'][number];

export function NewSweepForm({
  suites,
  models,
  initialSuiteName,
}: {
  suites: ReadonlyArray<SuiteSummary>;
  models: ReadonlyArray<ModelSummary>;
  initialSuiteName: string;
}) {
  const router = useRouter();

  const initialSuite = suites.find((s) => s.name === initialSuiteName) ?? suites[0] ?? null;

  const [suiteName, setSuiteName] = useState<string>(initialSuite?.name ?? '');
  const [suiteVersion, setSuiteVersion] = useState<string>('');
  const [agentVersion, setAgentVersion] = useState<string>('');
  const [selectedModels, setSelectedModels] = useState<ReadonlyArray<string>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suite = useMemo(
    () => suites.find((s) => s.name === suiteName) ?? null,
    [suites, suiteName],
  );

  function toggleModel(id: string) {
    setSelectedModels((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!suiteName) {
      setError('Pick a suite.');
      return;
    }
    if (selectedModels.length === 0) {
      setError('Select at least one model.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await startSweep({
        suiteName,
        suiteVersion: suiteVersion || undefined,
        agentVersion: agentVersion || undefined,
        models: [...selectedModels],
      });
      router.push(`/eval/sweeps/${encodeURIComponent(res.sweepId)}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to start sweep.');
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <section className="rounded-md border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Suite</h2>
        {suites.length === 0 ? (
          <p className="text-sm text-slate-500">
            No suites registered. Add one under <code>eval/suites/</code> first.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Suite</span>
              <select
                value={suiteName}
                onChange={(e) => {
                  setSuiteName(e.target.value);
                  setSuiteVersion('');
                }}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                {suites.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
              {suite ? (
                <span className="text-xs text-slate-500">
                  Agent under test: <span className="font-mono text-slate-700">{suite.agent}</span>
                </span>
              ) : null}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">
                Suite version
              </span>
              <input
                type="text"
                value={suiteVersion}
                onChange={(e) => setSuiteVersion(e.target.value)}
                placeholder={suite ? `latest (${suite.version})` : 'latest'}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
              <span className="text-[11px] text-slate-500">Empty = latest registered.</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">
                Agent version
              </span>
              <input
                type="text"
                value={agentVersion}
                onChange={(e) => setAgentVersion(e.target.value)}
                placeholder="promoted"
                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              />
              <span className="text-[11px] text-slate-500">Empty = promoted version.</span>
            </label>
          </div>
        )}
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Models to sweep
          </h2>
          <span className="text-xs text-slate-500">{selectedModels.length} selected</span>
        </div>
        {models.length === 0 ? (
          <p className="text-sm text-slate-500">No models registered.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {models.map((m) => {
              const checked = selectedModels.includes(m.id);
              return (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-start gap-3 rounded border p-3 text-sm ${
                    checked
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  } ${m.available ? '' : 'opacity-60'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleModel(m.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-900">{m.id}</span>
                      {!m.available ? (
                        <span className="text-[10px] uppercase tracking-wider text-amber-700">
                          unavailable
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      <span className="text-slate-700">{m.provider}</span>
                      <span className="mx-1 text-slate-400">·</span>
                      <span>{m.locality}</span>
                      <span className="mx-1 text-slate-400">·</span>
                      <span>{m.capabilityClass}</span>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </section>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Starting…' : 'Start sweep'}
        </button>
      </div>
    </form>
  );
}
