'use client';

/**
 * Inline form fields for the New Evaluator dialog. Pure-logic lives in
 * `evaluator-form.ts` (validateDraft, draftToCreateRequest). This file
 * only renders + wires up callbacks.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import type {
  CreateEvaluatorRequest,
  EvaluatorConfig,
  EvaluatorKind,
  TestEvaluatorResponse,
} from '@aldo-ai/api-contract';
import { useMemo, useState } from 'react';
import {
  EVALUATOR_KINDS,
  type EvaluatorDraft,
  JUDGE_CAPABILITY_CLASSES,
  KIND_DESCRIPTIONS,
  KIND_LABELS,
  draftToConfig,
  draftToCreateRequest,
  emptyDraft,
  validateDraft,
} from './evaluator-form';

export interface EvaluatorFormProps {
  submitting?: boolean;
  submitError?: string | null;
  testResult?: TestEvaluatorResponse | null;
  testError?: string | null;
  onSubmit: (req: CreateEvaluatorRequest) => void | Promise<void>;
  onTest: (
    kind: EvaluatorKind,
    config: EvaluatorConfig,
    sample: { output: string; expected?: string; input?: string },
  ) => void | Promise<void>;
}

export function EvaluatorForm({
  submitting,
  submitError,
  testResult,
  testError,
  onSubmit,
  onTest,
}: EvaluatorFormProps) {
  const [draft, setDraft] = useState<EvaluatorDraft>(emptyDraft());
  const [sampleOutput, setSampleOutput] = useState('');
  const [sampleExpected, setSampleExpected] = useState('');
  const [sampleInput, setSampleInput] = useState('');

  const validation = useMemo(() => validateDraft(draft), [draft]);

  function fieldError(field: string): string | undefined {
    return validation.errors.find((e) => e.field === field)?.message;
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!validation.ok) return;
        onSubmit(draftToCreateRequest(draft));
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Name</span>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="contains-ok"
            required
            maxLength={160}
          />
          {fieldError('name') ? (
            <span className="text-[11px] text-danger">{fieldError('name')}</span>
          ) : null}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Kind</span>
          <select
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as EvaluatorKind })}
            className="h-9 rounded-md border border-border bg-bg-elevated px-3 text-sm text-fg focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            {EVALUATOR_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-fg-muted">{KIND_DESCRIPTIONS[draft.kind]}</span>
        </label>
      </div>

      {/* Per-kind config */}
      {draft.kind === 'exact_match' ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Expected value</span>
          <Input
            value={draft.exactMatch.value}
            onChange={(e) =>
              setDraft({ ...draft, exactMatch: { ...draft.exactMatch, value: e.target.value } })
            }
          />
          <label className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={draft.exactMatch.trim}
              onChange={(e) =>
                setDraft({ ...draft, exactMatch: { ...draft.exactMatch, trim: e.target.checked } })
              }
            />
            Trim whitespace before comparing
          </label>
          {fieldError('value') ? (
            <span className="text-[11px] text-danger">{fieldError('value')}</span>
          ) : null}
        </label>
      ) : null}

      {draft.kind === 'contains' ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Substring</span>
          <Input
            value={draft.contains.value}
            onChange={(e) => setDraft({ ...draft, contains: { value: e.target.value } })}
          />
          {fieldError('value') ? (
            <span className="text-[11px] text-danger">{fieldError('value')}</span>
          ) : null}
        </label>
      ) : null}

      {draft.kind === 'regex' ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Regex pattern</span>
          <Input
            value={draft.regex.value}
            onChange={(e) => setDraft({ ...draft, regex: { value: e.target.value } })}
            placeholder="^foo"
          />
          {fieldError('value') ? (
            <span className="text-[11px] text-danger">{fieldError('value')}</span>
          ) : null}
        </label>
      ) : null}

      {draft.kind === 'json_schema' ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">JSON schema</span>
          <textarea
            value={draft.jsonSchema.schema}
            onChange={(e) => setDraft({ ...draft, jsonSchema: { schema: e.target.value } })}
            rows={6}
            className="rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-xs text-fg focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          {fieldError('schema') ? (
            <span className="text-[11px] text-danger">{fieldError('schema')}</span>
          ) : null}
        </label>
      ) : null}

      {draft.kind === 'llm_judge' ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">Capability class (judge)</span>
            <select
              value={draft.llmJudge.modelClass}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  llmJudge: { ...draft.llmJudge, modelClass: e.target.value },
                })
              }
              className="h-9 rounded-md border border-border bg-bg-elevated px-3 text-sm text-fg focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              {JUDGE_CAPABILITY_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-fg-muted">
              The gateway picks the actual model from the configured catalog.
            </span>
            {fieldError('modelClass') ? (
              <span className="text-[11px] text-danger">{fieldError('modelClass')}</span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">Prompt template</span>
            <textarea
              value={draft.llmJudge.prompt}
              onChange={(e) =>
                setDraft({ ...draft, llmJudge: { ...draft.llmJudge, prompt: e.target.value } })
              }
              rows={6}
              className="rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-xs text-fg focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            {fieldError('prompt') ? (
              <span className="text-[11px] text-danger">{fieldError('prompt')}</span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">Output JSON schema</span>
            <textarea
              value={draft.llmJudge.outputSchema}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  llmJudge: { ...draft.llmJudge, outputSchema: e.target.value },
                })
              }
              rows={6}
              className="rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-xs text-fg focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            {fieldError('outputSchema') ? (
              <span className="text-[11px] text-danger">{fieldError('outputSchema')}</span>
            ) : null}
          </label>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-xs text-fg-muted">
        <input
          type="checkbox"
          checked={draft.isShared}
          onChange={(e) => setDraft({ ...draft, isShared: e.target.checked })}
        />
        Share with everyone in this tenant
      </label>

      {/* Test panel — fires before save */}
      <div className="rounded-md border border-border bg-bg-subtle p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Test it before saving
        </h3>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-muted">Sample input</span>
            <Input
              value={sampleInput}
              onChange={(e) => setSampleInput(e.target.value)}
              placeholder="(optional)"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-muted">Sample output</span>
            <Input value={sampleOutput} onChange={(e) => setSampleOutput(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-muted">Expected</span>
            <Input
              value={sampleExpected}
              onChange={(e) => setSampleExpected(e.target.value)}
              placeholder="(optional)"
            />
          </label>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!validation.ok || sampleOutput.length === 0}
            onClick={() => {
              const config = draftToConfig(draft);
              onTest(draft.kind, config, {
                output: sampleOutput,
                ...(sampleExpected ? { expected: sampleExpected } : {}),
                ...(sampleInput ? { input: sampleInput } : {}),
              });
            }}
          >
            Test evaluator
          </Button>
          {testResult ? (
            <span
              className={cn(
                'text-xs font-medium',
                testResult.passed ? 'text-green-700' : 'text-amber-700',
              )}
            >
              {testResult.passed ? 'Passed' : 'Failed'} · score {testResult.score.toFixed(2)}
            </span>
          ) : null}
          {testError ? <span className="text-xs text-danger">{testError}</span> : null}
        </div>
      </div>

      {submitError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {submitError}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={!validation.ok || submitting === true}>
          {submitting ? 'Creating…' : 'Create evaluator'}
        </Button>
      </div>
    </form>
  );
}
