'use client';

/**
 * Wave-4 (Tier-4) — full-page prompt editor.
 *
 * Saves create a new immutable version (the previous body is never
 * mutated). The notes field is the commit message — required at the
 * application layer so v3 → v4 always carries an audit-trail line.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiClientError, createPromptVersion } from '@/lib/api';
import { extractVariableNamesFromBody } from '@/lib/prompts';
import type { PromptVersion } from '@aldo-ai/api-contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

const CAPABILITY_OPTIONS = [
  'frontier-reasoning',
  'reasoning-medium',
  'reasoning-fast',
  'fast',
  'local-only',
] as const;

export interface PromptEditorProps {
  readonly promptId: string;
  readonly currentVersion: PromptVersion;
  readonly nextVersion: number;
}

export function PromptEditor({ promptId, currentVersion, nextVersion }: PromptEditorProps) {
  const router = useRouter();
  const [body, setBody] = useState(currentVersion.body);
  const [notes, setNotes] = useState('');
  const [capability, setCapability] = useState<string>(currentVersion.modelCapability);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variables = useMemo(() => extractVariableNamesFromBody(body), [body]);
  const oldVariables = useMemo(
    () => extractVariableNamesFromBody(currentVersion.body),
    [currentVersion.body],
  );
  const addedVars = variables.filter((v) => !oldVariables.includes(v));
  const removedVars = oldVariables.filter((v) => !variables.includes(v));

  const dirty = body !== currentVersion.body || capability !== currentVersion.modelCapability;
  const canSubmit = dirty && body.length > 0 && notes.trim().length > 0 && !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await createPromptVersion(promptId, {
        body,
        notes: notes.trim(),
        modelCapability: capability,
        variablesSchema: {
          variables: variables.map((n) => ({ name: n, type: 'string', required: true })),
        },
      });
      router.push(`/prompts/${encodeURIComponent(promptId)}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : (err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
      data-testid="prompt-editor"
    >
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-bg-elevated p-4">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-fg">
            Body — saving creates v{nextVersion}
          </h2>
          <span className="text-[11px] text-fg-faint">
            {body.length} chars · {body.split('\n').length} lines
          </span>
        </header>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={26}
          required
          spellCheck={false}
          className="block w-full resize-y rounded-md border border-border bg-bg p-3 font-mono text-xs leading-relaxed text-fg focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          data-testid="editor-body"
        />
      </section>

      <aside className="flex flex-col gap-3">
        <section className="rounded-lg border border-border bg-bg-elevated p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Variables ({variables.length})
          </h3>
          {variables.length === 0 ? (
            <p className="text-xs text-fg-muted">No placeholders detected.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {variables.map((v) => (
                <li
                  key={v}
                  className="flex items-center justify-between rounded border border-border bg-bg-subtle px-2 py-1"
                >
                  <code className="font-mono text-xs text-fg">{v}</code>
                  {addedVars.includes(v) ? (
                    <span className="text-[10px] uppercase tracking-wide text-success">new</span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide text-fg-faint">
                      string
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {removedVars.length > 0 ? (
            <p className="mt-2 text-[11px] text-warning">
              Removed: {removedVars.map((v) => `{{${v}}}`).join(', ')}
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-border bg-bg-elevated p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Capability
          </h3>
          <select
            value={capability}
            onChange={(e) => setCapability(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-bg-elevated px-2.5 text-sm text-fg focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            {CAPABILITY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </section>

        <section className="rounded-lg border border-border bg-bg-elevated p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Commit message
            </span>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why this version?"
              required
              maxLength={2000}
              data-testid="editor-notes"
            />
            <span className="text-[10px] text-fg-faint">
              Required. Shown in version history + diff annotations.
            </span>
          </label>
        </section>

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {error}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button type="submit" disabled={!canSubmit} data-testid="editor-save">
            {submitting ? 'Creating version…' : `Save as v${nextVersion}`}
          </Button>
          <Button asChild variant="ghost" type="button">
            <Link href={`/prompts/${encodeURIComponent(promptId)}`}>Cancel</Link>
          </Button>
        </div>
      </aside>
    </form>
  );
}
