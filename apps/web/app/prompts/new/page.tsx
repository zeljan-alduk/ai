/**
 * /prompts/new — single-screen editor for creating a prompt (Wave-4 Tier-4).
 *
 * Closes Vellum's "create prompt" flow + LangSmith Hub's authoring
 * surface. The form auto-detects `{{variables}}` from the body and
 * builds a typed schema preview on the side; on submit we POST to
 * /v1/prompts which atomically creates the header + version 1.
 */

import { PageHeader } from '@/components/page-header';
import { NewPromptForm } from './new-prompt-form';

export const dynamic = 'force-dynamic';

export default function NewPromptPage() {
  return (
    <>
      <PageHeader
        title="New prompt"
        description="Author a versioned prompt. The first save creates v1; subsequent edits create v2, v3… and the diff endpoint reconstructs what changed."
      />
      <NewPromptForm />
    </>
  );
}
