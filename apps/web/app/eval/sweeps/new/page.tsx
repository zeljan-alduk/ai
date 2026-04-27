import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listModels } from '@/lib/api';
import { listSuites } from '@/lib/eval-client';
import Link from 'next/link';
import { NewSweepForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NewSweepPage({
  searchParams,
}: {
  searchParams: Promise<{ suite?: string }>;
}) {
  const sp = await searchParams;

  let suites: Awaited<ReturnType<typeof listSuites>> | null = null;
  let models: Awaited<ReturnType<typeof listModels>> | null = null;
  let error: unknown = null;
  try {
    [suites, models] = await Promise.all([listSuites(), listModels()]);
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="New sweep"
        description="Pick a suite and the models to evaluate against. Each cell becomes one (case, model) result."
        actions={
          <Link
            href="/eval/sweeps"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
          >
            Back to sweeps
          </Link>
        }
      />
      {error ? (
        <ErrorView error={error} context="the new-sweep form" />
      ) : suites && models ? (
        <NewSweepForm
          suites={suites.suites}
          models={models.models}
          initialSuiteName={sp.suite ?? ''}
        />
      ) : null}
    </>
  );
}
