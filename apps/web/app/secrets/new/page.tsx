import { PageHeader } from '@/components/page-header';
import Link from 'next/link';
import { NewSecretForm } from './form';

export const dynamic = 'force-dynamic';

export default function NewSecretPage() {
  return (
    <>
      <PageHeader
        title="New secret"
        description="Stored encrypted at rest, returned only as a redacted summary. The raw value never leaves this form once submitted."
        actions={
          <Link
            href="/secrets"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
          >
            Back to secrets
          </Link>
        }
      />
      <NewSecretForm />
    </>
  );
}
