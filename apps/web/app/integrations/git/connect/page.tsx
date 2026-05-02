/**
 * /integrations/git/connect — wave-18 (Tier 3.5).
 *
 * Server-rendered shell. The actual form is a client island so input
 * state stays out of the URL and we can show the one-time webhook
 * secret + URL in-place after the connect call returns.
 */

import { ConnectGitRepoForm } from '@/components/integrations/git-connect-form';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { listProjects } from '@/lib/api';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ConnectGitRepoPage() {
  let projectsResp: Awaited<ReturnType<typeof listProjects>> | null = null;
  try {
    projectsResp = await listProjects();
  } catch {
    projectsResp = null;
  }
  const projects = projectsResp?.projects.map((p) => ({ slug: p.slug, name: p.name })) ?? [];

  return (
    <>
      <PageHeader
        title="Connect a repo"
        description="Read-only sync of agent specs from a GitHub or GitLab repo. We'll list every YAML under your spec_path and register each one against the chosen project. Push webhooks trigger a re-sync automatically."
        actions={
          <Link href="/integrations/git">
            <Button variant="secondary">Back</Button>
          </Link>
        }
      />
      <ConnectGitRepoForm projects={projects} />
    </>
  );
}
