'use client';

/**
 * "Save as eval row" — capture a finished run into a dataset as a
 * single labelled example, ready for the eval suite.
 *
 * The natural next click after a swap-model comparison is "this run
 * was better, keep it as the expected output." This dialog is the
 * shortest path from there to a row in a dataset.
 *
 * Pre-fill heuristic (best-effort, user can edit before saving):
 *   input    = first `message` event with role=user
 *   expected = last  `message` event with role=assistant
 * Both fields fall back to empty strings if the run shape doesn't
 * match (composite agents, tool-only runs, etc.) — the user types
 * them in.
 *
 * Metadata captured on every row so the dataset can trace back to
 * provenance: { runId, agentName, agentVersion, lastModel,
 * lastProvider }. The eval harness ignores metadata; it's there for
 * the human reviewing the dataset.
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ApiClientError, createDatasetExample, listDatasets } from '@/lib/api';
import type { RunDetail, RunEvent } from '@aldo-ai/api-contract';
import { useEffect, useMemo, useState } from 'react';

/**
 * Picker only needs `id` + `name` from each dataset. Defining a local
 * shape avoids a Zod input/output mismatch on the full `Dataset` type
 * (the schema uses `.default([])`, which makes the inferred input
 * type slightly looser than the parsed output type).
 */
type DatasetPick = { readonly id: string; readonly name: string };

const SPLITS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'eval', label: 'eval (default)' },
  { value: 'train', label: 'train' },
  { value: 'holdout', label: 'holdout' },
];

export function SaveAsEvalRowButton({ run }: { run: RunDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Save as eval row
        </Button>
      </DialogTrigger>
      {open ? <SaveAsEvalRowForm run={run} onDone={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function SaveAsEvalRowForm({ run, onDone }: { run: RunDetail; onDone: () => void }) {
  const [datasets, setDatasets] = useState<ReadonlyArray<DatasetPick> | null>(null);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState<string>('');
  const [input, setInput] = useState<string>(() => deriveInputText(run.events));
  const [expected, setExpected] = useState<string>(() => deriveExpectedText(run.events));
  const [label, setLabel] = useState<string>('');
  const [split, setSplit] = useState<string>('eval');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the user's datasets once when the dialog opens. This is
  // intentionally a flat list — wide-tenant pagination is the dataset
  // page's job, not this picker's.
  useEffect(() => {
    let cancelled = false;
    listDatasets()
      .then((res) => {
        if (cancelled) return;
        const picks: ReadonlyArray<DatasetPick> = res.datasets.map((d) => ({
          id: d.id,
          name: d.name,
        }));
        setDatasets(picks);
        if (picks.length > 0 && datasetId === '') {
          const first = picks[0];
          if (first !== undefined) setDatasetId(first.id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setDatasetsError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  const metadata = useMemo<Record<string, unknown>>(
    () => ({
      runId: run.id,
      agentName: run.agentName,
      agentVersion: run.agentVersion,
      ...(run.lastProvider !== null ? { lastProvider: run.lastProvider } : {}),
      ...(run.lastModel !== null ? { lastModel: run.lastModel } : {}),
      capturedAt: new Date().toISOString(),
    }),
    [run.id, run.agentName, run.agentVersion, run.lastProvider, run.lastModel],
  );

  const submit = async () => {
    if (datasetId === '') {
      setError('Pick a dataset first.');
      return;
    }
    if (input.trim() === '') {
      setError('Input is empty — type or paste what to ask the agent.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createDatasetExample(datasetId, {
        input,
        expected: expected.trim() === '' ? undefined : expected,
        metadata,
        ...(label.trim() !== '' ? { label: label.trim() } : {}),
        split,
      });
      onDone();
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Save run as eval row</DialogTitle>
        <DialogDescription>
          Captures the run&rsquo;s input and final output into a dataset example. The eval harness
          can then replay this row against any model on this agent spec.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4 text-sm">
        <Field label="Dataset">
          {datasets === null ? (
            datasetsError !== null ? (
              <span className="text-rose-700">{datasetsError}</span>
            ) : (
              <span className="text-slate-500">Loading datasets…</span>
            )
          ) : datasets.length === 0 ? (
            <span className="text-slate-500">
              No datasets yet —{' '}
              <a href="/datasets/new" className="text-blue-600 hover:underline">
                create one
              </a>{' '}
              first.
            </span>
          ) : (
            <select
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1.5"
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          label="Input"
          hint="What you want to ask the agent. Pre-filled from the first user message."
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-[12px] leading-relaxed"
            placeholder="The user prompt that started this run…"
          />
        </Field>

        <Field
          label="Expected output"
          hint="The reference answer. Pre-filled from the run's final assistant message — edit if you want a different gold-standard."
        >
          <textarea
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            rows={4}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-[12px] leading-relaxed"
            placeholder="(optional) the reference output the eval scorer should compare to"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Label" hint="Optional tag — e.g. good, bad, edge-case.">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
              placeholder="(optional)"
            />
          </Field>
          <Field label="Split">
            <select
              value={split}
              onChange={(e) => setSplit(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1.5"
            >
              {SPLITS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <details className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-slate-700">
            Provenance metadata
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-slate-700">
            {JSON.stringify(metadata, null, 2)}
          </pre>
        </details>

        {error !== null ? (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
            {error}
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          disabled={submitting || datasets === null || datasets.length === 0 || datasetId === ''}
        >
          {submitting ? 'Saving…' : 'Save row'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
      {hint !== undefined ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

// ──────────────────────────────── Pre-fill helpers ─────────────────────────

function deriveInputText(events: ReadonlyArray<RunEvent>): string {
  for (const ev of events) {
    if (ev.type !== 'message') continue;
    const p = ev.payload as Record<string, unknown> | null | undefined;
    if (p === null || p === undefined) continue;
    if (p.role !== 'user') continue;
    if (typeof p.text === 'string') return p.text;
  }
  return '';
}

function deriveExpectedText(events: ReadonlyArray<RunEvent>): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev === undefined || ev.type !== 'message') continue;
    const p = ev.payload as Record<string, unknown> | null | undefined;
    if (p === null || p === undefined) continue;
    if (p.role !== 'assistant') continue;
    if (typeof p.text === 'string') return p.text;
  }
  return '';
}
