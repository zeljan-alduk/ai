import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listInvitations, listMembers } from '@/lib/api-admin';
import { formatRelativeTime } from '@/lib/format';
import { InviteDialog } from './invite-dialog';
import {
  ChangeRoleSelect,
  DeleteInviteButton,
  RemoveMemberButton,
  RevokeInviteButton,
} from './member-actions';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  let members: Awaited<ReturnType<typeof listMembers>> | null = null;
  let invitations: Awaited<ReturnType<typeof listInvitations>> | null = null;
  let error: unknown = null;
  try {
    [members, invitations] = await Promise.all([listMembers(), listInvitations()]);
  } catch (err) {
    error = err;
  }

  const pending = invitations?.invitations.filter(
    (i) => i.acceptedAt === null && i.revokedAt === null,
  );
  const past = invitations?.invitations.filter(
    (i) => i.acceptedAt !== null || i.revokedAt !== null,
  );

  return (
    <>
      <PageHeader
        title="Members"
        description="Users with access to this tenant. Roles determine what each member can do — see /settings/roles for details."
        actions={<InviteDialog />}
      />
      {error ? (
        <ErrorView error={error} context="members" />
      ) : (
        <>
          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Active members ({members?.members.length ?? 0})
          </h3>
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <table className="aldo-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members?.members.map((m) => (
                  <tr key={m.userId}>
                    <td className="font-medium text-slate-900">{m.email}</td>
                    <td>
                      <ChangeRoleSelect userId={m.userId} currentRole={m.role} />
                    </td>
                    <td className="text-xs text-slate-500">{formatRelativeTime(m.joinedAt)}</td>
                    <td className="text-right">
                      <RemoveMemberButton userId={m.userId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pending && pending.length > 0 ? (
            <>
              <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Pending invitations ({pending.length})
              </h3>
              <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                <table className="aldo-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Sent</th>
                      <th>Expires</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((i) => (
                      <tr key={i.id}>
                        <td className="font-medium text-slate-900">{i.email}</td>
                        <td>
                          <span className="font-mono text-xs">{i.role}</span>
                        </td>
                        <td className="text-xs text-slate-500">
                          {formatRelativeTime(i.createdAt)}
                        </td>
                        <td className="text-xs text-slate-500">
                          {formatRelativeTime(i.expiresAt)}
                        </td>
                        <td className="text-right">
                          <RevokeInviteButton id={i.id} />
                          <DeleteInviteButton id={i.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {past && past.length > 0 ? (
            <>
              <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Past invitations ({past.length})
              </h3>
              <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                <table className="aldo-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {past.map((i) => (
                      <tr key={i.id}>
                        <td className="font-medium text-slate-900">{i.email}</td>
                        <td>
                          <span className="font-mono text-xs">{i.role}</span>
                        </td>
                        <td className="text-xs">
                          {i.acceptedAt ? (
                            <span className="text-emerald-700">accepted</span>
                          ) : i.revokedAt ? (
                            <span className="text-amber-700">revoked</span>
                          ) : null}
                        </td>
                        <td className="text-right">
                          <DeleteInviteButton id={i.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
