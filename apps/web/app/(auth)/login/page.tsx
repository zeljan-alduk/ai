import { safeNextPath } from '../schemas';
import { LoginForm } from './form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next ?? null);

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight text-slate-900">Sign in</h1>
      <p className="mb-5 text-sm text-slate-500">
        Welcome back. Use the email and password you signed up with.
      </p>
      <LoginForm next={next} />
    </>
  );
}
