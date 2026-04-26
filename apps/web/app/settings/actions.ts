'use server';

/**
 * Server actions for the wave-13 /settings shell. Each action:
 *   - reads the session cookie via `getSession()`,
 *   - calls the corresponding /v1/<surface> endpoint with bearer auth,
 *   - revalidates the right /settings sub-route on success.
 *
 * Errors bubble as `ApiClientError` so the page error boundary can
 * render them; we never swallow them silently.
 */

import {
  createApiKey as createApiKeyClient,
  createInvitation as createInvitationClient,
  deleteApiKey as deleteApiKeyClient,
  deleteInvitation as deleteInvitationClient,
  removeMember as removeMemberClient,
  revokeApiKey as revokeApiKeyClient,
  revokeInvitation as revokeInvitationClient,
  updateMemberRole as updateMemberRoleClient,
} from '@/lib/api-admin';
import { revalidatePath } from 'next/cache';
import '@/lib/api-server-init';

export interface CreateKeyResult {
  ok: boolean;
  key?: string;
  prefix?: string;
  error?: string;
}

export async function createApiKeyAction(formData: FormData): Promise<CreateKeyResult> {
  const name = (formData.get('name') as string | null) ?? '';
  const expiresInDays = Number(formData.get('expiresInDays') ?? 0);
  const scopesRaw = formData.getAll('scope').map((s) => String(s));
  const scopes = scopesRaw.filter((s) => s.length > 0);
  if (name.length === 0) return { ok: false, error: 'name is required' };
  if (scopes.length === 0) return { ok: false, error: 'at least one scope is required' };
  try {
    const created = await createApiKeyClient({
      name,
      scopes,
      ...(expiresInDays > 0 ? { expiresInDays } : {}),
    });
    revalidatePath('/settings/api-keys');
    return { ok: true, key: created.key, prefix: created.apiKey.prefix };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const id = (formData.get('id') as string | null) ?? '';
  if (id.length === 0) return;
  await revokeApiKeyClient(id);
  revalidatePath('/settings/api-keys');
}

export async function deleteApiKeyAction(formData: FormData): Promise<void> {
  const id = (formData.get('id') as string | null) ?? '';
  if (id.length === 0) return;
  await deleteApiKeyClient(id);
  revalidatePath('/settings/api-keys');
}

export interface CreateInviteResult {
  ok: boolean;
  acceptUrl?: string;
  token?: string;
  error?: string;
}

export async function createInviteAction(formData: FormData): Promise<CreateInviteResult> {
  const email = (formData.get('email') as string | null) ?? '';
  const role = (formData.get('role') as string | null) ?? 'member';
  if (email.length === 0) return { ok: false, error: 'email is required' };
  if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
    return { ok: false, error: 'invalid role' };
  }
  try {
    const created = await createInvitationClient({
      email,
      role: role as 'owner' | 'admin' | 'member' | 'viewer',
    });
    revalidatePath('/settings/members');
    return { ok: true, acceptUrl: created.acceptUrl, token: created.token };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const id = (formData.get('id') as string | null) ?? '';
  if (id.length === 0) return;
  await revokeInvitationClient(id);
  revalidatePath('/settings/members');
}

export async function deleteInviteAction(formData: FormData): Promise<void> {
  const id = (formData.get('id') as string | null) ?? '';
  if (id.length === 0) return;
  await deleteInvitationClient(id);
  revalidatePath('/settings/members');
}

export async function changeMemberRoleAction(formData: FormData): Promise<void> {
  const userId = (formData.get('userId') as string | null) ?? '';
  const role = (formData.get('role') as string | null) ?? 'member';
  if (userId.length === 0) return;
  if (!['owner', 'admin', 'member', 'viewer'].includes(role)) return;
  await updateMemberRoleClient(userId, {
    role: role as 'owner' | 'admin' | 'member' | 'viewer',
  });
  revalidatePath('/settings/members');
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const userId = (formData.get('userId') as string | null) ?? '';
  if (userId.length === 0) return;
  await removeMemberClient(userId);
  revalidatePath('/settings/members');
}
