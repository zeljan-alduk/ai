/**
 * /projects — list + create. Wave 17 foundation.
 *
 * Projects are tenant-scoped named groupings. This page is the entry
 * point for managing them. In this wave the entity exists but
 * agents/runs/datasets are NOT yet scoped by project_id — clicking
 * a project just opens its settings, not a filtered view of work.
 * Once retrofit lands, each project row will deep-link into its
 * scoped /agents, /runs, etc.
 */

import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { CreateProjectButton } from '@/components/projects/create-project-button';
import { ProjectsList } from '@/components/projects/projects-list';
import { listProjects } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const sp = await searchParams;
  const showArchived = sp.archived === '1';

  let listed: Awaited<ReturnType<typeof listProjects>> | null = null;
  let error: unknown = null;
  try {
    listed = await listProjects({ includeArchived: showArchived });
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description="Group agents, runs, datasets, and evaluators into named projects. Active projects only by default."
        actions={<CreateProjectButton />}
      />
      {error ? (
        <ErrorView error={error} context="projects" />
      ) : listed ? (
        <ProjectsList projects={listed.projects} showArchived={showArchived} />
      ) : null}
    </>
  );
}
