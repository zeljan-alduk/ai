'use client';

import {
  changeMemberRoleAction,
  deleteInviteAction,
  removeMemberAction,
  revokeInviteAction,
} from '@/app/settings/actions';

export function ChangeRoleSelect({
  userId,
  currentRole,
}: {
  userId: string;
  currentRole: string;
}) {
  return (
    <form action={changeMemberRoleAction} className="inline">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={currentRole}
        onChange={(e) => {
          if (confirm(`Change role to "${e.target.value}"?`) && e.target.form !== null) {
            e.target.form.requestSubmit();
          } else {
            e.target.value = currentRole;
          }
        }}
        className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
      >
        <option value="owner">owner</option>
        <option value="admin">admin</option>
        <option value="member">member</option>
        <option value="viewer">viewer</option>
      </select>
    </form>
  );
}

export function RemoveMemberButton({ userId }: { userId: string }) {
  return (
    <form action={removeMemberAction} className="inline">
      <input type="hidden" name="userId" value={userId} />
      <button
        type="submit"
        onClick={(e) => {
          if (!confirm('Remove this member from the tenant?')) {
            e.preventDefault();
          }
        }}
        className="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50"
      >
        Remove
      </button>
    </form>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  return (
    <form action={revokeInviteAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="rounded px-2 py-1 text-xs text-amber-700 hover:bg-amber-50">
        Revoke
      </button>
    </form>
  );
}

export function DeleteInviteButton({ id }: { id: string }) {
  return (
    <form action={deleteInviteAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50">
        Delete
      </button>
    </form>
  );
}
