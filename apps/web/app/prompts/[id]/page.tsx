/**
 * /prompts/[id] — three-pane prompt detail (Wave-4 Tier-4).
 *
 * Server component: pulls the prompt detail + version history server-side,
 * passes them to the client island that handles the tabs (Variables /
 * Diff / Used by) and the inline playground.
 */

import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { PromptDetailView } from '@/components/prompts/prompt-detail-view';
import { Button } from '@/components/ui/button';
import { getPrompt, listPromptVersions } from '@/lib/api';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PromptDetailPage({ params }: PageProps) {
  const { id } = await params;
  let detail: Awaited<ReturnType<typeof getPrompt>> | null = null;
  let versions: Awaited<ReturnType<typeof listPromptVersions>> | null = null;
  let error: unknown = null;
  try {
    [detail, versions] = await Promise.all([getPrompt(id), listPromptVersions(id)]);
  } catch (err) {
    error = err;
  }

  if (error) {
    return (
      <>
        <PageHeader title="Prompt" description="" />
        <ErrorView error={error} context="prompt-detail" />
      </>
    );
  }
  if (!detail || !versions) return null;

  const prompt = detail.prompt;

  return (
    <>
      <PageHeader
        title={prompt.name}
        description={prompt.description || 'No description.'}
        actions={
          <Button asChild variant="secondary">
            <Link href={`/prompts/${encodeURIComponent(prompt.id)}/edit`}>
              Edit (creates v{prompt.latestVersion + 1})
            </Link>
          </Button>
        }
      />
      <PromptDetailView
        prompt={{
          id: prompt.id,
          name: prompt.name,
          description: prompt.description,
          latestVersion: prompt.latestVersion,
          modelCapability: prompt.modelCapability,
          createdBy: prompt.createdBy,
          createdAt: prompt.createdAt,
          updatedAt: prompt.updatedAt,
        }}
        latest={prompt.latest}
        versions={versions.versions}
      />
    </>
  );
}
