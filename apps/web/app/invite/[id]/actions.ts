'use server';

import { redirect } from 'next/navigation';

/**
 * Accept an invitation. Public path — no session required, the token
 * is the credential. On success we redirect to /login (the recipient
 * needs to authenticate next).
 */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  const id = (formData.get('id') as string | null) ?? '';
  const token = (formData.get('token') as string | null) ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  if (id.length === 0 || token.length === 0) {
    redirect('/login?invite=invalid');
  }
  const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
  const res = await fetch(`${apiBase}/v1/invitations/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id,
      token,
      ...(password.length >= 12 ? { password } : {}),
    }),
  });
  if (!res.ok) {
    redirect('/login?invite=failed');
  }
  redirect('/login?invite=accepted');
}
