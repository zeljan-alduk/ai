'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiClientError, createPrompt } from '@/lib/api';
import { extractVariableNamesFromBody } from '@/lib/prompts';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

const CAPABILITY_OPTIONS = [
  { value: 'frontier-reasoning', label: 'frontier-reasoning', hint: 'Best quality; highest cost' },
  { value: 'reasoning-medium', label: 'reasoning-medium', hint: 'Balanced default' },
  { value: 'reasoning-fast', label: 'reasoning-fast', hint: 'Latency-first' },
  { value: 'fast', label: 'fast', hint: 'Cheap + quick' },
  { value: 'local-only', label: 'local-only', hint: 'Local LLMs only (sensitive)' },
] as const;

const NAME_RE = /^[a-z][a-z0-9-]*$/;

export function NewPromptForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [capability, setCapability] = useState<string>('reasoning-medium');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const variables = useMemo(() => extractVariableNamesFromBody(body), [body]);
  const nameValid = name.length > 0 && NAME_RE.test(name);
  const bodyValid = body.length > 0;
  const canSubmit = nameValid && bodyValid && !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const created = await createPrompt({
        name,
        description,
        body,
        modelCapability: capability,
        variablesSchema: {
          variables: variables.map((n) => ({ name: n, type: 'string', required: true })),
        },
      });
      router.push(`/prompts/${encodeURIComponent(created.prompt.id)}`);
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : (err as Error).message;
      setSubmitError(msg);
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
      data-testid="new-prompt-form"
    >
      <div className="flex flex-col gap-6">
        <section className="rounded-lg border border-border bg-bg-elevated p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-tight text-fg">
            1. Identify the prompt
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Name</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                placeholder="code-reviewer-system-prompt"
                required
                maxLength={160}
                aria-invalid={name.length > 0 && !nameValid}
                data-testid="prompt-name-input"
              />
              <span className="text-[11px] text-fg-faint">
                lowercase kebab-case (letters, digits, hyphens)
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Model capability</span>
              <select
                value={capability}
                onChange={(e) => setCapability(e.target.value)}
                className="h-9 rounded-md border border-border bg-bg-elevated px-3 text-sm text-fg focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              >
                {CAPABILITY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-fg-faint">
                {CAPABILITY_OPTIONS.find((c) => c.value === capability)?.hint}
              </span>
            </label>
          </div>
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this prompt does and where it's used."
              rows={2}
              maxLength={2000}
              className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </label>
        </section>

        <section className="rounded-lg border border-border bg-bg-elevated p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-fg">2. Body</h2>
            <span className="text-[11px] text-fg-faint">
              Use <code className="rounded bg-bg-subtle px-1 font-mono">{'{{name}}'}</code> for
              variables — they auto-build the schema on the right.
            </span>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              'You are a {{role}} reviewing code.\n\nReview the following diff:\n{{diff}}\n\nFlag issues at severity: {{severity}}.'
            }
            rows={18}
            required
            className="block w-full resize-y rounded-md border border-border bg-bg p-3 font-mono text-xs leading-relaxed text-fg placeholder:text-fg-faint focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            data-testid="prompt-body-input"
          />
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <section className="rounded-lg border border-border bg-bg-elevated p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-tight text-fg">Variables</h2>
          {variables.length === 0 ? (
            <p className="text-xs text-fg-muted">
              No <code className="rounded bg-bg-subtle px-1 font-mono">{'{{...}}'}</code>{' '}
              placeholders detected yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {variables.map((v) => (
                <li
                  key={v}
                  className="flex items-center justify-between rounded border border-border bg-bg-subtle px-2.5 py-1.5"
                >
                  <code className="font-mono text-xs text-fg">{v}</code>
                  <span className="text-[10px] uppercase tracking-wide text-fg-muted">string</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-fg-faint">
            All inferred as required strings on first save. You can promote to other types after the
            initial version lands.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-bg-elevated p-5">
          <h2 className="mb-2 text-sm font-semibold tracking-tight text-fg">LLM-agnostic</h2>
          <p className="text-xs text-fg-muted">
            Capability classes route through the gateway — switching providers is a config change,
            not a code change. The /test playground supports{' '}
            <span className="font-medium text-fg">capability override</span> so you can compare
            quality across classes without mutating the version.
          </p>
        </section>

        {submitError ? (
          <div
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {submitError}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button type="submit" disabled={!canSubmit} data-testid="prompt-create-submit">
            {submitting ? 'Creating…' : 'Create prompt'}
          </Button>
          <Button asChild variant="ghost" type="button">
            <a href="/prompts">Cancel</a>
          </Button>
        </div>
      </aside>
    </form>
  );
}
