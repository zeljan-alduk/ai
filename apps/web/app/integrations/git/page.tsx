/**
 * /integrations/git — wave-18 (Tier 3.5) Git integration list view.
 *
 * Server component. Fetches the connected repos for the active tenant
 * (across all projects) and renders one row per repo with provider,
 * owner/name, project, sync status, and a "Sync now" + "Disconnect"
 * action surface. Empty state offers a "Connect a repo" CTA.
 *
 * Net-new competitive wedge — closest peer ships nothing equivalent.
 */

import { ErrorView } from '@/components/error-boundary';
import { ConnectedRepoRowActions } from '@/components/integrations/git-row-actions';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { listProjects } from '@/lib/api';
import { listGitRepos } from '@/lib/api-admin';
import { formatRelativeTime } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PROVIDER_LABEL: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab' };

export default async function GitIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const sp = await searchParams;

  let listed: Awaited<ReturnType<typeof listGitRepos>> | null = null;
  let projects: Awaited<ReturnType<typeof listProjects>> | null = null;
  let error: unknown = null;

  try {
    [listed, projects] = await Promise.all([
      listGitRepos(sp.project !== undefined ? { project: sp.project } : {}),
      listProjects().catch(() => null),
    ]);
  } catch (err) {
    error = err;
  }

  const projectNameById = new Map<string, string>();
  if (projects) {
    for (const p of projects.projects) projectNameById.set(p.id, p.name);
  }

  return (
    <>
      <PageHeader
        title="Git integration"
        description="Sync agent specs from a GitHub or GitLab repo into the registry. Read-only — every push triggers a re-sync. PAT auth in v0; OAuth apps land in a follow-up."
        actions={
          <Link href="/integrations/git/connect">
            <Button>Connect a repo</Button>
          </Link>
        }
      />

      {error ? (
        <ErrorView error={error} context="git integration" />
      ) : listed === null ? null : listed.repos.length === 0 ? (
        <EmptyState
          title="No connected repos yet"
          description="Connect a GitHub or GitLab repo and we'll keep the agent registry in sync with the YAML files in your spec_path. Manual + push-webhook triggers."
          action={
            <Link href="/integrations/git/connect">
              <Button>Connect a repo</Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-bg-elevated">
          <table className="aldo-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Repository</th>
                <th>Branch</th>
                <th>Spec path</th>
                <th>Project</th>
                <th>Last sync</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {listed.repos.map((r) => (
                <tr key={r.id} className="hover:bg-bg-subtle">
                  <td className="font-medium text-fg">
                    <span className="inline-flex items-center gap-1.5">
                      <ProviderDot provider={r.provider} />
                      {PROVIDER_LABEL[r.provider] ?? r.provider}
                    </span>
                  </td>
                  <td className="font-mono text-xs">
                    {r.repoOwner}/{r.repoName}
                  </td>
                  <td className="font-mono text-xs text-fg-muted">{r.defaultBranch}</td>
                  <td className="font-mono text-xs text-fg-muted">{r.specPath}</td>
                  <td className="text-xs text-fg-muted">
                    {projectNameById.get(r.projectId) ?? r.projectId.slice(0, 8)}
                  </td>
                  <td className="text-xs text-fg-muted">
                    {r.lastSyncedAt ? formatRelativeTime(r.lastSyncedAt) : '—'}
                  </td>
                  <td>
                    <SyncBadge status={r.lastSyncStatus} error={r.lastSyncError} />
                  </td>
                  <td>
                    <ConnectedRepoRowActions repo={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ProviderDot({ provider }: { provider: string }) {
  const cls = provider === 'github' ? 'bg-fg' : provider === 'gitlab' ? 'bg-accent' : 'bg-fg-muted';
  return <span aria-hidden className={`inline-block h-3 w-3 rounded-sm ${cls}`} />;
}

function SyncBadge({ status, error }: { status: string; error: string | null }) {
  if (status === 'ok') {
    return (
      <span className="rounded bg-success/15 px-2 py-0.5 text-xs font-medium text-success">ok</span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        className="rounded bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger"
        title={error ?? undefined}
      >
        failed
      </span>
    );
  }
  return (
    <span className="rounded bg-bg-subtle px-2 py-0.5 text-xs font-medium text-fg-muted">
      pending
    </span>
  );
}
