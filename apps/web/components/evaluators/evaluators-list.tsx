'use client';

/**
 * Client island for /evaluators — list table + Dialog for create + the
 * Test panel that calls /v1/evaluators/:id/test (or the inline variant
 * for evaluators that haven't been saved yet).
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ApiClientError, createEvaluator, deleteEvaluator, testEvaluator } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import type { Evaluator, EvaluatorKind, TestEvaluatorResponse } from '@aldo-ai/api-contract';
import { useState } from 'react';
import { KIND_LABELS } from './evaluator-form';
import { EvaluatorForm } from './evaluator-form-ui';
import { EvaluatorTestPanel } from './evaluator-test-panel';

export interface EvaluatorsListProps {
  initial: ReadonlyArray<Evaluator>;
  /** When rendered inside an empty-state, the create button is the only CTA. */
  showCreateInEmpty?: boolean;
}

export function EvaluatorsList({ initial, showCreateInEmpty }: EvaluatorsListProps) {
  const [evaluators, setEvaluators] = useState<Evaluator[]>([...initial]);
  const [open, setOpen] = useState(false);
  const [activeTest, setActiveTest] = useState<Evaluator | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onDelete(id: string) {
    setDeleteError(null);
    try {
      await deleteEvaluator(id);
      setEvaluators((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setDeleteError(err instanceof ApiClientError ? err.message : (err as Error).message);
    }
  }

  if (showCreateInEmpty) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>New evaluator</Button>
        </DialogTrigger>
        <NewEvaluatorDialogBody
          onCreated={(ev) => {
            setEvaluators((prev) => [ev, ...prev]);
            setOpen(false);
          }}
        />
      </Dialog>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>New evaluator</Button>
          </DialogTrigger>
          <NewEvaluatorDialogBody
            onCreated={(ev) => {
              setEvaluators((prev) => [ev, ...prev]);
              setOpen(false);
            }}
          />
        </Dialog>
      </div>
      {deleteError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {deleteError}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-md border border-border bg-bg-elevated">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="evaluators-table">
            <thead className="bg-bg-subtle text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Shared</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {evaluators.map((ev) => (
                <tr key={ev.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium text-fg">{ev.name}</td>
                  <td className="px-3 py-2 text-xs">
                    <Badge variant="secondary">{KIND_LABELS[ev.kind]}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-muted">
                    {ev.isShared ? 'shared' : 'private'}
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-muted" title={ev.updatedAt}>
                    {formatRelativeTime(ev.updatedAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveTest(ev)}
                      >
                        Test
                      </Button>
                      {ev.ownedByMe !== false ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(ev.id)}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {activeTest ? (
        <EvaluatorTestPanel evaluator={activeTest} onClose={() => setActiveTest(null)} />
      ) : null}
    </div>
  );
}

function NewEvaluatorDialogBody({
  onCreated,
}: {
  onCreated: (ev: Evaluator) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestEvaluatorResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>New evaluator</DialogTitle>
        <DialogDescription>
          Pick a kind. For llm_judge, use {'{{input}}'}, {'{{output}}'}, {'{{expected}}'} in the
          prompt template.
        </DialogDescription>
      </DialogHeader>
      <EvaluatorForm
        submitting={submitting}
        submitError={submitError}
        testResult={testResult}
        testError={testError}
        onSubmit={async (req) => {
          setSubmitting(true);
          setSubmitError(null);
          try {
            const created = await createEvaluator(req);
            onCreated(created.evaluator);
          } catch (err) {
            setSubmitError(err instanceof ApiClientError ? err.message : (err as Error).message);
            setSubmitting(false);
          }
        }}
        onTest={async (kind: EvaluatorKind, config, sample) => {
          setTestError(null);
          setTestResult(null);
          try {
            const res = await testEvaluator({
              kind,
              config,
              output: sample.output,
              ...(sample.expected ? { expected: sample.expected } : {}),
              ...(sample.input ? { input: sample.input } : {}),
            });
            setTestResult(res);
          } catch (err) {
            setTestError(err instanceof ApiClientError ? err.message : (err as Error).message);
          }
        }}
      />
    </DialogContent>
  );
}
