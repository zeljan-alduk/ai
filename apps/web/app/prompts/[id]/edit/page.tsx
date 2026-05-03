/**
 * /prompts/[id]/edit — full-page editor (Wave-4 Tier-4).
 *
 * Loads the latest version, hands it to the client editor, and on
 * save creates a new version (mandatory commit message). Cancel
 * returns to the detail page.
 */

import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { PromptEditor } from '@/components/prompts/prompt-editor';
import { getPrompt } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditPromptPage({ params }: PageProps) {
  const { id } = await params;
  let detail: Awaited<ReturnType<typeof getPrompt>> | null = null;
  let error: unknown = null;
  try {
    detail = await getPrompt(id);
  } catch (err) {
    error = err;
  }

  if (error) {
    return (
      <>
        <PageHeader title="Edit prompt" description="" />
        <ErrorView error={error} context="prompt-edit" />
      </>
    );
  }
  if (!detail || !detail.prompt.latest) return null;

  return (
    <>
      <PageHeader
        title={`Edit ${detail.prompt.name}`}
        description={`Saving creates v${detail.prompt.latestVersion + 1}. The previous version is preserved for diff and replay.`}
      />
      <PromptEditor
        promptId={detail.prompt.id}
        currentVersion={detail.prompt.latest}
        nextVersion={detail.prompt.latestVersion + 1}
      />
    </>
  );
}
