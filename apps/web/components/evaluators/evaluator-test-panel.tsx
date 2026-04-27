'use client';

/**
 * Test-evaluator side-panel that's shown when the user clicks "Test"
 * on a saved evaluator row. Calls /v1/evaluators/:id/test.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiClientError, testEvaluator } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Evaluator, TestEvaluatorResponse } from '@aldo-ai/api-contract';
import { useState } from 'react';

export function EvaluatorTestPanel({
  evaluator,
  onClose,
}: {
  evaluator: Evaluator;
  onClose: () => void;
}) {
  const [output, setOutput] = useState('');
  const [expected, setExpected] = useState('');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<TestEvaluatorResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await testEvaluator({
        evaluatorId: evaluator.id,
        output,
        ...(expected ? { expected } : {}),
        ...(input ? { input } : {}),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-md border border-border bg-bg-elevated p-4"
      data-testid="evaluator-test-panel"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Test {evaluator.name}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-fg-muted">Sample input</span>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="(optional)"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-fg-muted">Sample output</span>
          <Input value={output} onChange={(e) => setOutput(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-fg-muted">Expected</span>
          <Input
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            placeholder="(optional)"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button type="button" onClick={go} disabled={output.length === 0 || busy}>
          {busy ? 'Testing…' : 'Run test'}
        </Button>
        {result ? (
          <span
            className={cn(
              'text-xs font-medium',
              result.passed ? 'text-green-700' : 'text-amber-700',
            )}
          >
            {result.passed ? 'Passed' : 'Failed'} · score {result.score.toFixed(2)}
          </span>
        ) : null}
        {error ? <span className="text-xs text-danger">{error}</span> : null}
      </div>
      {result?.detail !== undefined ? (
        <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-border bg-bg-subtle p-3 text-[11px] text-fg">
          {JSON.stringify(result.detail, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
