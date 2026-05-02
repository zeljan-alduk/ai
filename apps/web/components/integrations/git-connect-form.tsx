'use client';

/**
 * Git connect form. Client island — captures the PAT, calls
 * `connectGitRepo`, then displays the one-time webhook secret + URL
 * for the customer to paste into GitHub/GitLab. After the secret has
 * been acknowledged the user can navigate to the repo list.
 */

import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api';
import { type GitConnectResponse, type GitProvider, connectGitRepo } from '@/lib/api-admin';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface ProjectChoice {
  readonly slug: string;
  readonly name: string;
}

export function ConnectGitRepoForm({ projects }: { projects: ReadonlyArray<ProjectChoice> }) {
  const router = useRouter();
  const [provider, setProvider] = useState<GitProvider>('github');
  const [project, setProject] = useState(projects[0]?.slug ?? '');
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [specPath, setSpecPath] = useState('aldo/agents');
  const [accessToken, setAccessToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GitConnectResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (project.trim().length === 0) {
      setError('Pick a project to attach this repo to.');
      return;
    }
    if (repoOwner.trim().length === 0 || repoName.trim().length === 0) {
      setError('Repo owner + name are required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await connectGitRepo({
        provider,
        project: project.trim(),
        repoOwner: repoOwner.trim(),
        repoName: repoName.trim(),
        defaultBranch: defaultBranch.trim() || 'main',
        specPath: specPath.trim() || 'aldo/agents',
        ...(accessToken.trim().length > 0 ? { accessToken: accessToken.trim() } : {}),
      });
      setResult(res);
      // Drop the PAT from local state once we've sent it.
      setAccessToken('');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Connection failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (result !== null) {
    return (
      <ConnectionSuccess
        result={result}
        onContinue={() => {
          router.push('/integrations/git');
          router.refresh();
        }}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" autoComplete="off">
      <section className="rounded-md border border-border bg-bg-elevated p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Repository
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Provider">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as GitProvider)}
              className="min-h-touch rounded border border-border bg-bg-elevated px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
            </select>
          </FormField>
          <FormField label="Project">
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="min-h-touch rounded border border-border bg-bg-elevated px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {projects.length === 0 ? <option value="">— no projects —</option> : null}
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name} ({p.slug})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Owner / org">
            <input
              type="text"
              value={repoOwner}
              onChange={(e) => setRepoOwner(e.target.value)}
              placeholder={provider === 'github' ? 'acme' : 'acme'}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="min-h-touch rounded border border-border bg-bg-elevated px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </FormField>
          <FormField label="Repo name">
            <input
              type="text"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="agents"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="min-h-touch rounded border border-border bg-bg-elevated px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </FormField>
          <FormField label="Default branch">
            <input
              type="text"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              placeholder="main"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="min-h-touch rounded border border-border bg-bg-elevated px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </FormField>
          <FormField label="Spec path">
            <input
              type="text"
              value={specPath}
              onChange={(e) => setSpecPath(e.target.value)}
              placeholder="aldo/agents"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="min-h-touch rounded border border-border bg-bg-elevated px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </FormField>
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          Every <code className="font-mono">.yaml</code> file under{' '}
          <code className="font-mono">{specPath || 'aldo/agents'}</code> is parsed as an agent spec.
          Files that fail validation are reported but do not abort the sync.
        </p>
      </section>

      <section className="rounded-md border border-border bg-bg-elevated p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">Access</h2>
        <FormField
          label={
            provider === 'github'
              ? 'GitHub Personal Access Token (optional)'
              : 'GitLab access token (optional)'
          }
        >
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={provider === 'github' ? 'ghp_…' : 'glpat-…'}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className="min-h-touch rounded border border-border bg-bg-elevated px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </FormField>
        <p className="mt-2 text-xs text-fg-muted">
          {provider === 'github'
            ? 'Needs only the `repo:read` (or `public_repo` for public mirrors) scope. Stored encrypted in your secret store; never round-tripped on read.'
            : 'A Project Access Token with `read_repository` scope is enough. Stored encrypted in your secret store.'}
        </p>
        <p className="mt-1 text-xs text-fg-muted">Leave empty for a public repo with no auth.</p>
      </section>

      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={() => router.push('/integrations/git')}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </form>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[11px] uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function ConnectionSuccess({
  result,
  onContinue,
}: {
  result: GitConnectResponse;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-md border border-success/30 bg-success/10 p-5">
        <h2 className="text-sm font-semibold text-success">Repo connected</h2>
        <p className="mt-1 text-sm text-fg">
          {result.repo.repoOwner}/{result.repo.repoName} ({result.repo.provider}) is now linked. Run
          a sync from the list, or paste the webhook below into your provider's settings to trigger
          sync automatically on every push.
        </p>
      </section>

      <section className="rounded-md border border-border bg-bg-elevated p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Webhook
        </h2>
        <div className="grid grid-cols-1 gap-3 text-sm">
          <Field label="URL">
            <code className="block break-all rounded border border-border bg-bg-subtle px-3 py-2 font-mono text-xs">
              {result.webhookUrl}
            </code>
            <p className="mt-1 text-xs text-fg-muted">
              Prepend your tenant's API host (e.g.{' '}
              <code className="font-mono">https://api.aldo.tech</code>).
            </p>
          </Field>
          <Field label="Signing secret (one-time view)">
            <code className="block break-all rounded border border-danger/40 bg-bg-subtle px-3 py-2 font-mono text-xs">
              {result.webhookSecret}
            </code>
            <p className="mt-1 text-xs text-fg-muted">
              Copy this now — we never display it again. GitHub: paste into the webhook "Secret"
              field. GitLab: paste into "Secret token".
            </p>
          </Field>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={onContinue}>Done — I&apos;ve copied it</Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </div>
  );
}
