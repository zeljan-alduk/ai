import { PageHeader } from '@/components/page-header';
import { getAuthMe } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Profile is the default settings landing page. Wave-13 ships a
 * skeleton — change-password lands when password-reset does.
 */
export default async function SettingsProfilePage() {
  let email = '';
  let tenantName = '';
  try {
    const me = await getAuthMe();
    email = me.user.email;
    tenantName = me.tenant.name;
  } catch {
    // Layout-level error states already handled.
  }

  return (
    <>
      <PageHeader
        title="Profile"
        description="Your account and current tenant. Account-level changes (password, email) land in a future wave."
      />
      <div className="space-y-4 rounded-md border border-slate-200 bg-white p-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">Email</div>
          <div className="mt-0.5 text-sm font-medium text-slate-900">{email || '—'}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">Active tenant</div>
          <div className="mt-0.5 text-sm font-medium text-slate-900">{tenantName || '—'}</div>
        </div>
        <div className="border-t border-slate-200 pt-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">Change password</div>
          <p className="mt-1 text-sm text-slate-500">
            Coming soon. We&apos;ll wire this up alongside email-based password reset in a future
            wave.
          </p>
        </div>
      </div>
    </>
  );
}
