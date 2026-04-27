/**
 * /evaluators — list of evaluators + "New evaluator" Dialog (wave 16).
 *
 * Server-shell that fetches the list; client island handles the
 * dialog + the "Test evaluator" panel.
 *
 * LLM-agnostic: llm_judge config carries an opaque capability-class
 * string; the gateway picks the actual model.
 */

import { ErrorView } from '@/components/error-boundary';
import { EvaluatorsList } from '@/components/evaluators/evaluators-list';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { listEvaluators } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function EvaluatorsPage() {
  let listed: Awaited<ReturnType<typeof listEvaluators>> | null = null;
  let error: unknown = null;
  try {
    listed = await listEvaluators();
  } catch (err) {
    error = err;
  }

  if (error) {
    return (
      <>
        <PageHeader title="Evaluators" description="Reusable scoring functions for eval suites." />
        <ErrorView error={error} context="evaluators" />
      </>
    );
  }
  if (!listed) return null;

  return (
    <>
      <PageHeader
        title="Evaluators"
        description="Tenant-scoped scoring functions. Pick a built-in (exact_match / contains / regex / json_schema) or craft an llm_judge prompt."
      />
      {listed.evaluators.length === 0 ? (
        <EmptyState
          title="No evaluators yet"
          description="Create your first evaluator to start gating eval suites. The simplest one is `contains` — pass when the output mentions an expected substring."
          action={<EvaluatorsList initial={[]} showCreateInEmpty />}
        />
      ) : (
        <EvaluatorsList initial={listed.evaluators} />
      )}
    </>
  );
}
