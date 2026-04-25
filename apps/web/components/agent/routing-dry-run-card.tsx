'use client';

/**
 * "Routing dry-run" card on the agent detail page.
 *
 * Wave-8: lets an operator click a button that POSTs to
 * `/v1/agents/:name/check` and renders the per-class filter outcomes
 * inline. We deliberately do NOT auto-fire on page load — the operator
 * has to click. That keeps the agent detail page cheap and avoids
 * confusing newcomers with a routing trace before they've asked for
 * one.
 *
 * The card is intentionally compact: privacy + class-trace + the
 * chosen model on success, or the FIX hint on failure. No modal, no
 * state outside this component.
 */

import { ApiClientError, checkAgent } from '@/lib/api';
import type { CheckAgentResponse } from '@aldo-ai/api-contract';
import { useState } from 'react';

export function RoutingDryRunCard({ agentName }: { agentName: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [result, setResult] = useState<CheckAgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = async (): Promise<void> => {
    setStatus('loading');
    setError(null);
    setResult(null);
    try {
      const res = await checkAgent(agentName);
      setResult(res);
      setStatus('ok');
    } catch (err) {
      const msg =
        err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : 'failed';
      setError(msg);
      setStatus('error');
    }
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Routing dry-run</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Simulate this agent's routing against the live catalog. Read-only — no provider is
            contacted.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void onClick();
          }}
          disabled={status === 'loading'}
          className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === 'loading' ? 'Checking…' : 'Run dry-run'}
        </button>
      </div>

      {status === 'error' ? (
        <p className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </p>
      ) : null}

      {status === 'ok' && result !== null ? <ResultBody result={result} /> : null}
    </div>
  );
}

function ResultBody({ result }: { result: CheckAgentResponse }) {
  return (
    <div className="mt-3 flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-700">
        <span className="font-medium">privacy</span>
        <span className="font-mono">{result.agent.privacyTier}</span>
        <span className="font-medium">primary</span>
        <span className="font-mono">{result.agent.primaryClass}</span>
        {result.agent.fallbackClasses.length > 0 ? (
          <>
            <span className="font-medium">fallback</span>
            <span className="font-mono">{result.agent.fallbackClasses.join(' → ')}</span>
          </>
        ) : null}
      </div>

      <ul className="rounded border border-slate-200 bg-slate-50 p-2">
        {result.trace.map((t, i) => (
          <li key={`${t.capabilityClass}-${i}`} className="py-1">
            <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-slate-700">
              <span className="font-mono">{t.capabilityClass}</span>
              <span className="text-slate-500">
                {t.preFilter} pre / {t.passCapability} cap / {t.passPrivacy} privacy /{' '}
                {t.passBudget} budget
              </span>
              {t.chosen !== null ? (
                <span className="text-emerald-700">→ {t.chosen}</span>
              ) : (
                <span className="text-amber-700">{t.reason}</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {result.ok && result.chosen !== null ? (
        <p className="text-emerald-800">
          Would route to <span className="font-mono">{result.chosen.id}</span> (
          {result.chosen.locality}, est. ${result.chosen.estimatedUsd.toFixed(6)} on class{' '}
          <span className="font-mono">{result.chosen.classUsed}</span>).
        </p>
      ) : (
        <div className="text-rose-800">
          <p>No eligible model — {result.reason}</p>
          {result.fix !== null ? (
            <p className="mt-1 text-rose-700">
              <span className="font-semibold">FIX:</span> {result.fix}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
