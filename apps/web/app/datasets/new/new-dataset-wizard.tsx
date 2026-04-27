'use client';

import {
  type DatasetSourceKind,
  type NewDatasetDraft,
  parsePasteContent,
  parseTagsField,
  validateDraft,
} from '@/components/datasets/dataset-filters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ApiClientError,
  createDataset,
  createDatasetExample,
  importDatasetExamples,
} from '@/lib/api';
import { cn } from '@/lib/cn';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

const SOURCES: ReadonlyArray<{ kind: DatasetSourceKind; label: string; hint: string }> = [
  { kind: 'csv', label: 'CSV upload', hint: 'Header row + commas; first column = input.' },
  { kind: 'jsonl', label: 'JSONL upload', hint: 'One JSON object per line.' },
  { kind: 'paste', label: 'Paste JSON', hint: 'Paste a JSON array of {input, expected, ...}.' },
  { kind: 'empty', label: 'Start empty', hint: 'Add rows by hand from the dataset page.' },
];

export function NewDatasetWizard() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsField, setTagsField] = useState('');
  const [source, setSource] = useState<DatasetSourceKind>('empty');
  const [pasteContent, setPasteContent] = useState('');
  const [file, setFile] = useState<File | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const draft: NewDatasetDraft = useMemo(() => {
    const d: NewDatasetDraft = {
      name,
      description,
      tags: parseTagsField(tagsField),
      source,
    };
    if (source === 'paste') d.pasteContent = pasteContent;
    if ((source === 'csv' || source === 'jsonl') && file) d.file = file;
    return d;
  }, [name, description, tagsField, source, pasteContent, file]);

  const validation = useMemo(() => validateDraft(draft), [draft]);

  // Show the parsed preview inline so the user sees what they'll create.
  const pasteSample = useMemo(() => {
    if (source !== 'paste' || !pasteContent.trim()) return null;
    try {
      const parsed = parsePasteContent(pasteContent);
      return parsed.slice(0, 3);
    } catch {
      return null;
    }
  }, [source, pasteContent]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!validation.ok) return;
    setSubmitting(true);
    try {
      const created = await createDataset({
        name: draft.name.trim(),
        description: draft.description,
        tags: draft.tags,
      });
      const id = created.dataset.id;
      if (source === 'paste' && pasteContent.trim()) {
        const rows = parsePasteContent(pasteContent);
        for (const row of rows) {
          const r = (row as Record<string, unknown>) ?? {};
          const req: Parameters<typeof createDatasetExample>[1] = {
            input: r.input ?? r,
          };
          if (r.expected !== undefined) req.expected = r.expected;
          if (r.metadata !== undefined && typeof r.metadata === 'object' && r.metadata) {
            req.metadata = r.metadata as Record<string, unknown>;
          }
          if (typeof r.label === 'string') req.label = r.label;
          if (typeof r.split === 'string') req.split = r.split;
          await createDatasetExample(id, req);
        }
      } else if ((source === 'csv' || source === 'jsonl') && file) {
        await importDatasetExamples(id, file);
      }
      router.push(`/datasets/${encodeURIComponent(id)}`);
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : (err as Error).message;
      setSubmitError(msg);
      setSubmitting(false);
    }
  }

  function fieldError(field: string): string | undefined {
    return validation.errors.find((e) => e.field === field)?.message;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" data-testid="new-dataset-form">
      <section className="rounded-md border border-border bg-bg-elevated p-5">
        <h2 className="mb-3 text-sm font-semibold text-fg">1. Identify the dataset</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="invoice-tagging-v1"
              required
              maxLength={160}
              aria-invalid={fieldError('name') != null}
            />
            {fieldError('name') ? (
              <span className="text-[11px] text-danger">{fieldError('name')}</span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">Tags (comma-separated)</span>
            <Input
              value={tagsField}
              onChange={(e) => setTagsField(e.target.value)}
              placeholder="invoices, tagging, eval-gate"
            />
          </label>
        </div>
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's in this dataset and what it gates."
            rows={3}
            maxLength={2000}
            className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          {fieldError('description') ? (
            <span className="text-[11px] text-danger">{fieldError('description')}</span>
          ) : null}
        </label>
      </section>

      <section className="rounded-md border border-border bg-bg-elevated p-5">
        <h2 className="mb-3 text-sm font-semibold text-fg">2. Choose a source</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SOURCES.map((s) => (
            <button
              key={s.kind}
              type="button"
              onClick={() => setSource(s.kind)}
              aria-pressed={source === s.kind}
              className={cn(
                'flex flex-col gap-1 rounded-md border p-3 text-left transition-colors min-h-touch',
                source === s.kind
                  ? 'border-fg bg-bg-subtle'
                  : 'border-border bg-bg-elevated hover:bg-bg-subtle',
              )}
            >
              <span className="text-sm font-medium text-fg">{s.label}</span>
              <span className="text-[11px] text-fg-muted">{s.hint}</span>
            </button>
          ))}
        </div>
        {source === 'csv' || source === 'jsonl' ? (
          <div className="mt-3">
            <input
              type="file"
              accept={source === 'csv' ? '.csv,text/csv' : '.jsonl,application/x-ndjson'}
              onChange={(e) => setFile(e.target.files?.[0])}
              aria-label="Source file"
              className="block w-full text-sm text-fg file:mr-3 file:rounded-md file:border-0 file:bg-bg-subtle file:px-3 file:py-2 file:text-xs file:font-medium file:text-fg hover:file:bg-bg-elevated"
            />
            {file ? (
              <p className="mt-1 text-[11px] text-fg-muted">
                {file.name} ({Math.round(file.size / 1024)} KiB)
              </p>
            ) : null}
            {fieldError('file') ? (
              <p className="mt-1 text-[11px] text-danger">{fieldError('file')}</p>
            ) : null}
          </div>
        ) : null}
        {source === 'paste' ? (
          <div className="mt-3">
            <textarea
              value={pasteContent}
              onChange={(e) => setPasteContent(e.target.value)}
              placeholder='[{"input":"hello","expected":"world"}]'
              rows={8}
              className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-xs text-fg placeholder:text-fg-faint focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            {fieldError('pasteContent') ? (
              <p className="mt-1 text-[11px] text-danger">{fieldError('pasteContent')}</p>
            ) : null}
            {pasteSample ? (
              <div className="mt-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                  Preview ({pasteSample.length} of array)
                </h3>
                <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-bg-subtle p-3 text-[11px] text-fg">
                  {JSON.stringify(pasteSample, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {submitError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {submitError}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!validation.ok || submitting}>
          {submitting ? 'Creating…' : 'Create dataset'}
        </Button>
        <Button asChild variant="secondary">
          <a href="/datasets">Cancel</a>
        </Button>
      </div>
    </form>
  );
}
