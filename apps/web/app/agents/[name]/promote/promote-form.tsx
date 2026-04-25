'use client';

import { ApiClientError } from '@/lib/api';
import { promoteAgent } from '@/lib/eval-client';
import type {
  GetAgentResponse,
  ListModelsResponse,
  PromoteAgentResponse,
} from '@aldo-ai/api-contract';
import Link from 'next/link';
import { useState } from 'react';

type AgentDetail = GetAgentResponse['agent'];
type ModelSummary = ListModelsResponse['models'][number];

export function PromoteForm({
  agent,
  models,
}: {
  agent: AgentDetail;
  models: ReadonlyArray<ModelSummary>;
}) {
  const versions = agent.versions.length > 0 ? agent.versions : [];
  const initialVersion =
    versions.find((v) => !v.promoted)?.version ?? versions[0]?.version ?? agent.latestVersion;

  const [version, setVersion] = useState<string>(initialVersion);
  const [selectedModels, setSelectedModels] = useState<ReadonlyArray<string>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PromoteAgentResponse | null>(null);

  function toggleModel(id: string) {
    setSelectedModels((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!version) {
      setError('Pick a version.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await promoteAgent(agent.name, {
        version,
        models: [...selectedModels],
      });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Promotion request failed.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <section className="rounded-md border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Version
          </h2>
          {versions.length === 0 ? (
            <p className="text-sm text-slate-500">No versions registered for this agent.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {versions.map((v) => (
                <label
                  key={v.version}
                  className={`flex cursor-pointer items-center gap-3 rounded border p-3 text-sm ${
                    version === v.version
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="version"
                    value={v.version}
                    checked={version === v.version}
                    onChange={() => setVersion(v.version)}
                  />
                  <span className="font-mono text-xs text-slate-900">{v.version}</span>
                  {v.promoted ? (
                    <span className="text-[10px] uppercase tracking-wider text-emerald-700">
                      currently promoted
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-slate-500" title={v.createdAt}>
                    {v.createdAt}
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Models to gate against
            </h2>
            <span className="text-xs text-slate-500">
              {selectedModels.length === 0
                ? 'using gate defaults'
                : `${selectedModels.length} selected`}
            </span>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Leave empty to use the gate's declared default models. The server runs every suite in
            the agent's <code>eval_gate</code> against these models and only promotes if all pass.
          </p>
          {models.length === 0 ? (
            <p className="text-sm text-slate-500">No models registered.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {models.map((m) => {
                const checked = selectedModels.includes(m.id);
                const allowed = m.privacyAllowed.includes(agent.privacyTier);
                return (
                  <label
                    key={m.id}
                    className={`flex cursor-pointer items-start gap-3 rounded border p-3 text-sm ${
                      checked
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    } ${allowed ? '' : 'opacity-60'}`}
                    title={
                      allowed
                        ? undefined
                        : `Privacy tier ${agent.privacyTier} not allowed on this model.`
                    }
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
                        {!allowed ? (
                          <span className="text-[10px] uppercase tracking-wider text-red-700">
                            privacy mismatch
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
          <Link
            href={`/agents/${encodeURIComponent(agent.name)}`}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting || versions.length === 0}
            className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Promoting…' : 'Run gate & promote'}
          </button>
        </div>
      </form>

      {result ? <PromoteResult agent={agent} version={version} result={result} /> : null}
    </div>
  );
}

function PromoteResult({
  agent,
  version,
  result,
}: {
  agent: AgentDetail;
  version: string;
  result: PromoteAgentResponse;
}) {
  return (
    <section
      className={`rounded-md border p-5 ${
        result.promoted ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'
      }`}
    >
      <h2
        className={`text-sm font-semibold uppercase tracking-wide ${
          result.promoted ? 'text-emerald-800' : 'text-red-800'
        }`}
      >
        {result.promoted ? `Promoted ${agent.name} @ ${version}` : 'Gate failed — not promoted'}
      </h2>
      <p className={`mt-1 text-sm ${result.promoted ? 'text-emerald-700' : 'text-red-700'}`}>
        {result.promoted
          ? 'Every gate suite passed on the supplied models. The promoted pointer has moved.'
          : 'The promoted pointer was not moved. See per-suite breakdown below.'}
      </p>

      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">Sweeps run</div>
        {result.sweepIds.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">(none)</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {result.sweepIds.map((id) => (
              <li key={id}>
                <Link
                  href={`/eval/sweeps/${encodeURIComponent(id)}`}
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-xs text-blue-600 hover:underline"
                >
                  {id.slice(0, 12)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">
          Per-suite breakdown
        </div>
        <SuiteBreakdown sweepIds={result.sweepIds} failedSuites={result.failedSuites} />
      </div>
    </section>
  );
}

/**
 * The promote response gives us {sweepIds, failedSuites}. The contract
 * does not include a per-suite mapping (suite → pass/fail), so we
 * reconstruct it from `failedSuites`: any suite name in there is `fail`,
 * everything else we discovered as a sweep is treated as `pass`. For
 * suites without a corresponding name in either array we fall back to
 * showing the sweep IDs as drill-down links.
 */
function SuiteBreakdown({
  sweepIds,
  failedSuites,
}: {
  sweepIds: ReadonlyArray<string>;
  failedSuites: ReadonlyArray<string>;
}) {
  const failed = new Set(failedSuites);
  if (failedSuites.length === 0 && sweepIds.length === 0) {
    return <p className="mt-1 text-sm text-slate-500">No suites were run by the gate.</p>;
  }
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-slate-200 bg-white">
      <table className="aldo-table">
        <thead>
          <tr>
            <th>Suite</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {failedSuites.length === 0 ? (
            <tr>
              <td className="text-sm text-slate-700">all gate suites</td>
              <td>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-emerald-800">
                  pass
                </span>
              </td>
            </tr>
          ) : (
            [...failed].map((suite) => (
              <tr key={suite}>
                <td className="text-sm">
                  <Link
                    href={`/eval/suites/${encodeURIComponent(suite)}`}
                    className="text-slate-900 hover:underline"
                  >
                    {suite}
                  </Link>
                </td>
                <td>
                  <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-red-800">
                    fail
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
