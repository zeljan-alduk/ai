'use client';

/**
 * "Save as eval case" affordance for /playground.
 *
 * Bundles the prompt + manually-edited expected-output into a fresh
 * eval suite (one-case) via POST /v1/eval/suites. The suite name +
 * version are user-supplied so re-saving doesn't collide.
 *
 * Out of scope (per wave-13 brief): wiring custom evaluators into an
 * existing suite. Bumping the suite version on each save keeps the
 * surface simple — evaluator promotion lives in /eval, not here.
 *
 * LLM-agnostic: the suite YAML emitted here references no provider.
 */

import { AUTH_PROXY_PREFIX } from '@/lib/api';
import { useState } from 'react';
import type { ColumnState } from './playground-state.js';

export function SaveAsEvalCaseButton({
  systemPrompt,
  userPrompt,
  firstColumn,
}: {
  systemPrompt: string;
  userPrompt: string;
  firstColumn: ColumnState | null;
}) {
  const [open, setOpen] = useState(false);
  const [suiteName, setSuiteName] = useState('playground-saved');
  const [suiteVersion, setSuiteVersion] = useState('0.1.0');
  const [agent, setAgent] = useState('playground');
  const [expected, setExpected] = useState(firstColumn?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const onSave = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const yaml = renderSuiteYaml({
        name: suiteName.trim(),
        version: suiteVersion.trim(),
        agent: agent.trim(),
        systemPrompt,
        userPrompt,
        expected,
      });
      const res = await fetch(`${AUTH_PROXY_PREFIX}/v1/eval/suites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ yaml }),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          const env = JSON.parse(text) as { error?: { message?: string } };
          if (env.error?.message) msg = env.error.message;
        } catch {
          // fall through
        }
        setFeedback(`failed: ${msg}`);
        return;
      }
      setFeedback(`saved suite ${suiteName}@${suiteVersion}`);
      setTimeout(() => setOpen(false), 1500);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {open ? (
        <div className="rounded border border-slate-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium text-slate-900">Save as eval case</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-xs">
              <span className="block text-slate-500">Suite name</span>
              <input
                value={suiteName}
                onChange={(e) => setSuiteName(e.target.value)}
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </label>
            <label className="text-xs">
              <span className="block text-slate-500">Version</span>
              <input
                value={suiteVersion}
                onChange={(e) => setSuiteVersion(e.target.value)}
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </label>
            <label className="text-xs">
              <span className="block text-slate-500">Agent under test</span>
              <input
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </label>
          </div>
          <label className="mt-2 block text-xs">
            <span className="block text-slate-500">Expected output (must contain)</span>
            <textarea
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs font-mono"
              rows={4}
            />
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
            >
              {busy ? 'saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
            {feedback ? <span className="text-xs text-slate-600">{feedback}</span> : null}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
        >
          Save as eval case
        </button>
      )}
    </div>
  );
}

/**
 * Build a minimal-but-valid `eval/suite.v1` YAML with one `contains`
 * case. Round-trips through the same parser the API uses on the way in
 * so re-uploads behave identically to a hand-authored suite.
 */
export function renderSuiteYaml(opts: {
  name: string;
  version: string;
  agent: string;
  systemPrompt: string;
  userPrompt: string;
  expected: string;
}): string {
  const inputJson = JSON.stringify({
    system: opts.systemPrompt || undefined,
    messages: [{ role: 'user', content: opts.userPrompt }],
  });
  const lines = [
    `name: ${opts.name}`,
    `version: ${opts.version}`,
    `description: ${JSON.stringify('Saved from /playground')}`,
    `agent: ${opts.agent}`,
    'passThreshold: 0.5',
    'cases:',
    '  - id: case-1',
    `    input: ${inputJson}`,
    '    expect:',
    '      kind: contains',
    `      value: ${JSON.stringify(opts.expected)}`,
    '    weight: 1',
    `    tags: ["playground"]`,
  ];
  return lines.join('\n');
}
