'use client';

/**
 * Wave-4 (Tier-4) — three-pane prompt detail.
 *
 * Layout:
 *   - Left rail: version history (newest at top, click to view).
 *   - Center: prompt body for the selected version (read-only). Variables
 *     are highlighted in the accent colour.
 *   - Right rail: metadata + capability badge + "Run in playground" toggle
 *     + diff selectors.
 *   - Below: tabs for Variables, Diff (against any other version),
 *     Used-by (registered_agents that point at this prompt), Playground.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiClientError, getPromptDiff, getPromptVersion, testPrompt } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/format';
import { previewSubstituteVariables } from '@/lib/prompts';
import type {
  PromptDiffResponse,
  PromptTestResponse,
  PromptVariable,
  PromptVersion,
} from '@aldo-ai/api-contract';
import { useEffect, useMemo, useState } from 'react';

export interface PromptDetailMeta {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly latestVersion: number;
  readonly modelCapability: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PromptDetailViewProps {
  readonly prompt: PromptDetailMeta;
  readonly latest: PromptVersion | null;
  readonly versions: readonly PromptVersion[];
}

export function PromptDetailView({ prompt, latest, versions }: PromptDetailViewProps) {
  // Version selector state. Starts at the latest version.
  const initialVersionId = latest?.id ?? versions[0]?.id ?? null;
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(initialVersionId);
  const [versionCache, setVersionCache] = useState<Record<string, PromptVersion>>(() => {
    const out: Record<string, PromptVersion> = {};
    if (latest) out[latest.id] = latest;
    return out;
  });
  const selectedVersion = useMemo(() => {
    if (selectedVersionId === null) return null;
    return (
      versionCache[selectedVersionId] ?? versions.find((v) => v.id === selectedVersionId) ?? null
    );
  }, [selectedVersionId, versionCache, versions]);

  // Lazy-load full bodies for non-latest versions when the user
  // selects them (the list endpoint already includes everything for
  // the current schema, but we keep the pattern so future paginated
  // history doesn't refactor this view).
  useEffect(() => {
    if (selectedVersionId === null) return;
    if (versionCache[selectedVersionId]) return;
    let cancelled = false;
    void (async () => {
      const v = versions.find((x) => x.id === selectedVersionId);
      if (!v) return;
      try {
        const fresh = await getPromptVersion(prompt.id, v.version);
        if (!cancelled) {
          setVersionCache((prev) => ({ ...prev, [selectedVersionId]: fresh.version }));
        }
      } catch {
        // Silent — the row from listVersions is already populated.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prompt.id, selectedVersionId, versionCache, versions]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)_280px]">
        {/* Left: version history */}
        <aside className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-2">
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-fg-faint">
            History
          </div>
          {versions.map((v) => {
            const active = v.id === selectedVersionId;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedVersionId(v.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex flex-col gap-0.5 rounded px-2 py-1.5 text-left transition-colors',
                  active
                    ? 'bg-fg text-fg-inverse'
                    : 'text-fg-muted hover:bg-bg-subtle hover:text-fg',
                )}
                data-testid={`version-row-${v.version}`}
              >
                <span className="flex items-baseline justify-between gap-2 text-sm font-semibold tabular-nums">
                  <span>v{v.version}</span>
                  <span
                    className={cn('text-[10px]', active ? 'text-fg-inverse/70' : 'text-fg-faint')}
                  >
                    {formatRelativeTime(v.createdAt)}
                  </span>
                </span>
                <span
                  className={cn(
                    'truncate text-[11px]',
                    active ? 'text-fg-inverse/80' : 'text-fg-muted',
                  )}
                >
                  {v.notes || '(no notes)'}
                </span>
              </button>
            );
          })}
        </aside>

        {/* Center: body */}
        <section className="flex flex-col rounded-lg border border-border bg-bg-elevated">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-fg">
                v{selectedVersion?.version ?? '—'}
              </span>
              {selectedVersion?.parentVersionId ? (
                <span className="text-[10px] uppercase tracking-wider text-fg-faint">
                  forked from another version
                </span>
              ) : null}
            </div>
            <span
              className="text-[11px] text-fg-faint tabular-nums"
              title={selectedVersion?.createdAt}
            >
              {selectedVersion ? `by ${selectedVersion.createdBy}` : ''}
            </span>
          </header>
          <pre
            className="overflow-x-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-fg"
            data-testid="prompt-body-display"
          >
            {selectedVersion ? renderHighlighted(selectedVersion.body) : 'No version loaded.'}
          </pre>
        </section>

        {/* Right: metadata + actions */}
        <aside className="flex flex-col gap-3 rounded-lg border border-border bg-bg-elevated p-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fg-faint">Capability</div>
            <Badge
              variant="secondary"
              className="mt-1 font-mono text-[10px] uppercase tracking-wide"
              title="LLM-agnostic capability class — the gateway resolves the actual model"
            >
              {selectedVersion?.modelCapability ?? prompt.modelCapability}
            </Badge>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fg-faint">Variables</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {(selectedVersion?.variablesSchema.variables ?? []).map((v) => (
                <code
                  key={v.name}
                  className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-fg"
                >
                  {v.name}
                </code>
              ))}
              {(selectedVersion?.variablesSchema.variables ?? []).length === 0 ? (
                <span className="text-[11px] text-fg-faint">No variables.</span>
              ) : null}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fg-faint">Created</div>
            <div className="mt-1 text-xs text-fg-muted" title={prompt.createdAt}>
              {formatRelativeTime(prompt.createdAt)} by {prompt.createdBy}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fg-faint">Updated</div>
            <div className="mt-1 text-xs text-fg-muted" title={prompt.updatedAt}>
              {formatRelativeTime(prompt.updatedAt)}
            </div>
          </div>
        </aside>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="playground">
        <TabsList>
          <TabsTrigger value="playground">Playground</TabsTrigger>
          <TabsTrigger value="variables">Variables</TabsTrigger>
          <TabsTrigger value="diff">Diff</TabsTrigger>
          <TabsTrigger value="usedby">Used by</TabsTrigger>
        </TabsList>
        <TabsContent value="playground">
          <PlaygroundPanel
            promptId={prompt.id}
            version={selectedVersion}
            defaultCapability={selectedVersion?.modelCapability ?? prompt.modelCapability}
          />
        </TabsContent>
        <TabsContent value="variables">
          <VariablesPanel variables={selectedVersion?.variablesSchema.variables ?? []} />
        </TabsContent>
        <TabsContent value="diff">
          <DiffPanel
            promptId={prompt.id}
            versions={versions}
            latestVersion={prompt.latestVersion}
          />
        </TabsContent>
        <TabsContent value="usedby">
          <UsedByPanel promptId={prompt.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Playground panel
// ---------------------------------------------------------------------------

function PlaygroundPanel({
  promptId,
  version,
  defaultCapability,
}: {
  promptId: string;
  version: PromptVersion | null;
  defaultCapability: string;
}) {
  const [capability, setCapability] = useState<string>(defaultCapability);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<PromptTestResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset variable form when the selected version's schema changes.
  useEffect(() => {
    if (!version) return;
    setCapability(version.modelCapability);
    const seed: Record<string, string> = {};
    for (const v of version.variablesSchema.variables) seed[v.name] = '';
    setVars(seed);
    setOutput(null);
    setErr(null);
  }, [version]);

  const preview = useMemo(() => {
    if (!version) return '';
    return previewSubstituteVariables(version.body, vars);
  }, [version, vars]);

  async function onRun() {
    if (!version) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await testPrompt(promptId, {
        variables: vars,
        capabilityOverride: capability !== version.modelCapability ? capability : undefined,
        version: version.version,
      });
      setOutput(res);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!version) {
    return <p className="px-4 py-6 text-sm text-fg-muted">No version selected.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg-elevated p-4">
        <h3 className="text-sm font-semibold text-fg">Variables</h3>
        {version.variablesSchema.variables.length === 0 ? (
          <p className="text-xs text-fg-muted">This prompt has no variables.</p>
        ) : (
          version.variablesSchema.variables.map((v) => (
            <label key={v.name} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between text-xs font-medium text-fg-muted">
                <code className="font-mono text-xs text-fg">{v.name}</code>
                <span className="text-[10px] uppercase tracking-wide text-fg-faint">{v.type}</span>
              </span>
              <textarea
                rows={2}
                value={vars[v.name] ?? ''}
                onChange={(e) => setVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
                placeholder={v.description ?? ''}
                className="rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-fg-faint focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                data-testid={`var-input-${v.name}`}
              />
            </label>
          ))
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Capability override</span>
          <select
            value={capability}
            onChange={(e) => setCapability(e.target.value)}
            className="h-9 rounded-md border border-border bg-bg-elevated px-2.5 text-sm text-fg focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            <option value="frontier-reasoning">frontier-reasoning</option>
            <option value="reasoning-medium">reasoning-medium</option>
            <option value="reasoning-fast">reasoning-fast</option>
            <option value="fast">fast</option>
            <option value="local-only">local-only</option>
          </select>
        </label>
        <Button type="button" onClick={onRun} disabled={busy} data-testid="run-playground">
          {busy ? 'Running…' : 'Run prompt'}
        </Button>
      </div>

      <div className="flex flex-col rounded-lg border border-border bg-bg-elevated">
        <header className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Resolved body (preview)
        </header>
        <pre className="max-h-[420px] flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs text-fg">
          {preview}
        </pre>
      </div>

      <div className="flex flex-col rounded-lg border border-border bg-bg-elevated">
        <header className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          <span>Output</span>
          {output ? (
            <span className="font-mono text-[10px] tabular-nums">
              {output.tokensIn}+{output.tokensOut} tok · ${output.costUsd.toFixed(4)} ·{' '}
              {output.latencyMs}ms
            </span>
          ) : null}
        </header>
        {err ? (
          <div role="alert" className="px-3 py-3 text-xs text-danger">
            {err}
          </div>
        ) : output ? (
          <>
            <div className="border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wide text-fg-faint">
              {output.model} · capability:{output.capabilityUsed} · v{output.version}
            </div>
            <pre className="max-h-[380px] flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs text-fg">
              {output.output}
            </pre>
          </>
        ) : (
          <p className="px-3 py-3 text-xs text-fg-muted">
            Run the prompt to see the model's response here.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variables panel
// ---------------------------------------------------------------------------

function VariablesPanel({ variables }: { variables: readonly PromptVariable[] }) {
  if (variables.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-elevated p-6 text-sm text-fg-muted">
        This version declares no variables.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-elevated">
      <table className="w-full text-left text-sm">
        <thead className="bg-bg-subtle text-[11px] uppercase tracking-wider text-fg-muted">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Required</th>
            <th className="px-3 py-2">Description</th>
          </tr>
        </thead>
        <tbody>
          {variables.map((v) => (
            <tr key={v.name} className="border-t border-border align-top">
              <td className="px-3 py-2 font-mono text-xs text-fg">{v.name}</td>
              <td className="px-3 py-2 text-xs">
                <Badge variant="secondary" className="text-[10px]">
                  {v.type}
                </Badge>
              </td>
              <td className="px-3 py-2 text-xs text-fg-muted">{v.required ? 'yes' : 'no'}</td>
              <td className="px-3 py-2 text-xs text-fg-muted">{v.description ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff panel
// ---------------------------------------------------------------------------

function DiffPanel({
  promptId,
  versions,
  latestVersion,
}: {
  promptId: string;
  versions: readonly PromptVersion[];
  latestVersion: number;
}) {
  const [from, setFrom] = useState<number>(versions.length > 1 ? versions[1]!.version : 1);
  const [to, setTo] = useState<number>(latestVersion);
  const [diff, setDiff] = useState<PromptDiffResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-load on mount + when from/to/promptId change. Inlined here so
  // the effect closes over `from`/`to` without a useCallback wrapper.
  useEffect(() => {
    if (versions.length < 2) return;
    let cancelled = false;
    setBusy(true);
    setErr(null);
    void (async () => {
      try {
        const res = await getPromptDiff(promptId, from, to);
        if (!cancelled) setDiff(res);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof ApiClientError ? e.message : (e as Error).message);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, promptId, versions.length]);

  if (versions.length < 2) {
    return (
      <div className="rounded-lg border border-border bg-bg-elevated p-6 text-sm text-fg-muted">
        Create a second version to enable diffing.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-elevated p-3">
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          From
          <select
            value={from}
            onChange={(e) => setFrom(Number(e.target.value))}
            className="h-8 rounded border border-border bg-bg-elevated px-2 text-xs"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.version}>
                v{v.version}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          To
          <select
            value={to}
            onChange={(e) => setTo(Number(e.target.value))}
            className="h-8 rounded border border-border bg-bg-elevated px-2 text-xs"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.version}>
                v{v.version}
              </option>
            ))}
          </select>
        </label>
        {diff ? (
          <span className="ml-auto font-mono text-[11px] text-fg-muted">
            <span className="text-success">+{diff.stats.added}</span>{' '}
            <span className="text-danger">−{diff.stats.removed}</span>{' '}
            <span className="text-fg-faint">·{diff.stats.unchanged}</span>
          </span>
        ) : null}
      </div>
      {err ? (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger"
        >
          {err}
        </div>
      ) : busy && !diff ? (
        <div className="rounded-lg border border-border bg-bg-elevated p-6 text-sm text-fg-muted">
          Computing diff…
        </div>
      ) : diff ? (
        <pre
          className="overflow-x-auto rounded-lg border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed"
          data-testid="diff-display"
        >
          {diff.lines.map((l, i) => (
            <span
              key={i}
              className={cn(
                'block pl-2 -indent-2',
                l.kind === 'added' && 'bg-success/10 text-success',
                l.kind === 'removed' && 'bg-danger/10 text-danger',
                l.kind === 'unchanged' && 'text-fg-muted',
              )}
            >
              {l.kind === 'added' ? '+ ' : l.kind === 'removed' ? '- ' : '  '}
              {l.text || ' '}
            </span>
          ))}
        </pre>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Used-by panel
// ---------------------------------------------------------------------------

interface UsedByEntry {
  readonly agentName: string;
  readonly version: string;
  readonly promptVersion: number;
}

function UsedByPanel({ promptId }: { promptId: string }) {
  const [agents, setAgents] = useState<readonly UsedByEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Hit the same auth-proxy used by request<T>(); we read a
        // freeform shape here so we don't add a Zod schema for the
        // simple {agents} envelope.
        const url = `/api/auth-proxy/v1/prompts/${encodeURIComponent(promptId)}/used-by`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { agents?: UsedByEntry[] };
        if (!cancelled) setAgents(json.agents ?? []);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [promptId]);

  if (err) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
        {err}
      </div>
    );
  }
  if (agents === null) {
    return (
      <div className="rounded-lg border border-border bg-bg-elevated p-6 text-sm text-fg-muted">
        Loading…
      </div>
    );
  }
  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-elevated p-6 text-sm text-fg-muted">
        No agents in this tenant currently reference this prompt.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-elevated">
      <table className="w-full text-left text-sm">
        <thead className="bg-bg-subtle text-[11px] uppercase tracking-wider text-fg-muted">
          <tr>
            <th className="px-3 py-2">Agent</th>
            <th className="px-3 py-2">Agent version</th>
            <th className="px-3 py-2">Prompt version pinned</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a, i) => (
            <tr key={`${a.agentName}-${a.version}-${i}`} className="border-t border-border">
              <td className="px-3 py-2 text-xs font-medium text-fg">{a.agentName}</td>
              <td className="px-3 py-2 text-xs text-fg-muted">{a.version}</td>
              <td className="px-3 py-2 text-xs text-fg-muted tabular-nums">
                {a.promptVersion > 0 ? `v${a.promptVersion}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlight {{variables}} in the body display
// ---------------------------------------------------------------------------

const VAR_HIGHLIGHT_RE = /(\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\})/g;

function renderHighlighted(body: string): React.ReactNode[] {
  const parts = body.split(VAR_HIGHLIGHT_RE);
  return parts.map((part, i) => {
    if (VAR_HIGHLIGHT_RE.test(part)) {
      // Reset RE state — split() with capturing group leaves it set.
      VAR_HIGHLIGHT_RE.lastIndex = 0;
      return (
        <span
          key={i}
          className="rounded bg-accent/15 px-1 font-medium text-accent"
          title="prompt variable"
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
