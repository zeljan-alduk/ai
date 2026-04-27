import { safeNextPath } from '../schemas';
import { SignupForm } from './form';

export const dynamic = 'force-dynamic';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next ?? null);

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight text-slate-900">
        Create your workspace
      </h1>
      <p className="mb-5 text-sm text-slate-500">
        Spin up a tenant + admin user in one step. Local models work out of the box; bring your own
        provider keys via Secrets.
      </p>
      <SignupForm next={next} />
    </>
  );
}
