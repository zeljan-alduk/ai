/**
 * /prompts — gallery of prompt cards (Wave-4 Tier-4).
 *
 * Server component. Pulls the list, renders cards with the latest
 * version + capability badge + last-updated. CTA links to the
 * /prompts/new editor.
 *
 * Closes Vellum (entire product) + LangSmith Hub. Prompts are
 * tenant + project scoped, versioned working artifacts the same way
 * agents and datasets are.
 *
 * LLM-agnostic: never branches on a provider name. The model
 * capability badge surfaces a capability class string the gateway
 * resolves at /test time.
 */

import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { PromptCard } from '@/components/prompts/prompt-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { listPrompts } from '@/lib/api';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface SearchParams {
  /**
   * Wave-17 picker: when present, scopes the prompts list to a single
   * project. The slug is opaque on the client; the API resolves it to
   * the row's `project_id`. Falls back to "all projects in this tenant"
   * when omitted.
   */
  project?: string;
}

export default async function PromptsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const projectSlug = sp.project?.trim() ? sp.project.trim() : undefined;

  let listed: Awaited<ReturnType<typeof listPrompts>> | null = null;
  let error: unknown = null;
  try {
    listed = await listPrompts(projectSlug !== undefined ? { project: projectSlug } : {});
  } catch (err) {
    error = err;
  }

  if (error) {
    return (
      <>
        <PageHeader
          title="Prompts"
          description="Versioned prompt templates with diff and a built-in playground."
        />
        <ErrorView error={error} context="prompts" />
      </>
    );
  }
  if (!listed) return null;

  return (
    <>
      <PageHeader
        title="Prompts"
        description="Author, version, diff, and exercise prompt templates from the playground. Reference a stable version from any agent spec via promptRef."
        actions={
          <Button asChild>
            <Link href="/prompts/new">New prompt</Link>
          </Button>
        }
      />
      {listed.prompts.length === 0 ? (
        <EmptyState
          title="No prompts in this tenant yet"
          description="Capture a prompt template once, version it, diff revisions, and exercise it from a built-in playground. Agents reference a versioned prompt via promptRef so a body change doesn't require touching every spec."
          illustration={<EmptyPromptsIllustration />}
          action={
            <Button asChild>
              <Link href="/prompts/new">Create your first prompt</Link>
            </Button>
          }
        />
      ) : (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="prompts-grid"
        >
          {listed.prompts.map((p) => (
            <PromptCard key={p.id} prompt={p} />
          ))}
        </div>
      )}
    </>
  );
}

function EmptyPromptsIllustration() {
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="prompts-empty-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#3730a3" />
        </linearGradient>
      </defs>
      <rect
        x="14"
        y="18"
        width="56"
        height="48"
        rx="6"
        stroke="url(#prompts-empty-grad)"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M22 30 L48 30"
        stroke="url(#prompts-empty-grad)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M22 40 L62 40"
        stroke="url(#prompts-empty-grad)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.7"
      />
      <path
        d="M22 50 L40 50"
        stroke="url(#prompts-empty-grad)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.4"
      />
      <circle cx="62" cy="50" r="6" fill="url(#prompts-empty-grad)" opacity="0.3" />
    </svg>
  );
}
