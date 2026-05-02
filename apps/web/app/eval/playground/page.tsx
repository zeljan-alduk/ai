/**
 * /eval/playground — Wave-3 (Tier-3.1) eval scorer playground.
 *
 * Closes the Braintrust-playground / LangSmith-evaluators-as-product
 * gap. Pick one evaluator + one dataset (+ optional sample size), hit
 * Run, watch per-row scores stream in alongside aggregate stats. The
 * playground does NOT save to a suite — it's evaluator development,
 * not suite execution. A future "Save as suite" promotion converts a
 * playground session into a permanent suite + sweep.
 *
 * Server shell: prefetches the evaluator + dataset lists so the picker
 * bar renders without a roundtrip. Everything below the header is the
 * client island `PlaygroundView` which owns the run lifecycle.
 *
 * LLM-agnostic: we never branch on a provider name. Only `llm_judge`
 * evaluator rows touch a model and they go through the gateway.
 */

import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listDatasets, listEvaluators } from '@/lib/api';
import Link from 'next/link';
import { PlaygroundView } from './playground-view';

export const dynamic = 'force-dynamic';

export default async function EvalPlaygroundPage() {
  let evaluators: Awaited<ReturnType<typeof listEvaluators>> | null = null;
  let datasets: Awaited<ReturnType<typeof listDatasets>> | null = null;
  let error: unknown = null;
  try {
    [evaluators, datasets] = await Promise.all([listEvaluators(), listDatasets()]);
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Playground"
        description="Bulk-score one evaluator against one dataset. Pick, hit Run, watch rows score live."
        actions={
          <>
            <Link
              href="/evaluators"
              className="rounded-md border border-border bg-bg-elevated px-3 py-1 text-sm text-fg hover:bg-bg-subtle"
            >
              Manage evaluators
            </Link>
            <Link
              href="/datasets"
              className="rounded-md border border-border bg-bg-elevated px-3 py-1 text-sm text-fg hover:bg-bg-subtle"
            >
              Manage datasets
            </Link>
          </>
        }
      />
      {error ? (
        <ErrorView error={error} context="playground" />
      ) : evaluators && datasets ? (
        <PlaygroundView
          initialEvaluators={evaluators.evaluators}
          initialDatasets={datasets.datasets}
        />
      ) : null}
    </>
  );
}
