import { PageHeader } from '@/components/page-header';
import { acceptInviteAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function InviteAcceptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const token = typeof sp.token === 'string' ? sp.token : '';

  return (
    <div className="mx-auto max-w-md py-12">
      <PageHeader
        title="Accept invitation"
        description="You've been invited to a tenant. Set a password (if you don't already have an account) and accept."
      />
      <form
        action={acceptInviteAction}
        className="space-y-4 rounded-md border border-slate-200 bg-white p-5"
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="token" value={token} />
        <label className="block text-xs text-slate-700">
          Password (only required for new accounts)
          <input
            type="password"
            name="password"
            minLength={12}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="At least 12 characters"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Accept invitation
        </button>
      </form>
    </div>
  );
}
