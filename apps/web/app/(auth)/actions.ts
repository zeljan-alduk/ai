'use server';

import '@/lib/api-server-init';

/**
 * Server actions for the auth forms.
 *
 * Why server actions and not a client-side fetch? Two reasons:
 *
 *   1. The bearer token is set by the server here, never copied through
 *      the browser. The client form posts plaintext credentials to the
 *      action; the action calls /v1/auth/{signup,login}, drops the
 *      response token into the HTTP-only cookie via `setSession()`,
 *      and redirects.
 *
 *   2. We can use `useFormState` for inline error rendering with no
 *      hand-written fetch wiring on the client. The password value
 *      lives in the form state for the duration of one submit and is
 *      then discarded.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { ApiClientError, getAuthMe, listAgents, login, signup } from '@/lib/api';
import { clearSession, setSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { LoginFormSchema, SignupFormSchema, safeNextPath } from './schemas';
import type { AuthFormState } from './state';

// AuthFormState + EMPTY_AUTH_STATE live in ./state because a `'use server'`
// file can only export async functions to client components — non-async
// exports come through as `undefined`. Client islands import them
// directly from ./state; only server actions live here.

function formStringField(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

/**
 * After a successful auth, decide whether the new user goes to the
 * onboarding stub or the runs list. Engineer O is wiring the
 * tenant-seeding endpoint; until then, "zero agents in the tenant"
 * is the authoritative onboarding signal.
 */
async function postAuthRedirectTarget(): Promise<string> {
  try {
    const agents = await listAgents({ limit: 1 });
    if (agents.agents.length === 0) return '/welcome';
  } catch {
    // If the agents endpoint is unreachable for any reason (network
    // hiccup, 401 against a stale cookie), fall through to /runs and
    // let the page handle its own error state.
  }
  return '/runs';
}

export async function signupAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = SignupFormSchema.safeParse({
    tenantName: formStringField(form, 'tenantName'),
    email: formStringField(form, 'email'),
    password: formStringField(form, 'password'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: 'Please fix the errors below.', fieldErrors };
  }

  let result: Awaited<ReturnType<typeof signup>>;
  try {
    result = await signup(parsed.data);
  } catch (err) {
    return formErrorFromApi(err, 'Sign up failed.');
  }

  await setSession(result.token);
  const next = safeNextPath(formStringField(form, 'next')) ?? (await postAuthRedirectTarget());
  redirect(next);
}

export async function loginAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = LoginFormSchema.safeParse({
    email: formStringField(form, 'email'),
    password: formStringField(form, 'password'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: 'Please fix the errors below.', fieldErrors };
  }

  let result: Awaited<ReturnType<typeof login>>;
  try {
    result = await login(parsed.data);
  } catch (err) {
    return formErrorFromApi(err, 'Login failed.');
  }

  await setSession(result.token);
  const next = safeNextPath(formStringField(form, 'next')) ?? (await postAuthRedirectTarget());
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  // Try the server-side invalidation first, but never block the cookie
  // clear — the user expects "logout" to drop the session immediately.
  try {
    const { logout } = await import('@/lib/api');
    await logout();
  } catch {
    /* best-effort */
  }
  await clearSession();
  redirect('/login');
}

/**
 * Server action that runs `getAuthMe` to confirm the cookie still
 * resolves to a valid user. Pages that want to short-circuit a
 * client-side render after a tenant switch can call this.
 */
export async function refreshSession(): Promise<{ ok: boolean }> {
  try {
    await getAuthMe();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function formErrorFromApi(err: unknown, fallback: string): AuthFormState {
  if (err instanceof ApiClientError) {
    // 4xx with a server-specified code/message — surface the message.
    if (err.kind === 'http_4xx') {
      return { error: err.message, fieldErrors: {} };
    }
    if (err.kind === 'network') {
      return {
        error: 'Could not reach the control-plane API. Try again in a moment.',
        fieldErrors: {},
      };
    }
    if (err.kind === 'http_5xx') {
      return {
        error: 'The API is temporarily unavailable. Please retry.',
        fieldErrors: {},
      };
    }
    if (err.kind === 'parse' || err.kind === 'envelope') {
      return {
        error: 'Unexpected response shape from the API. Contact your operator.',
        fieldErrors: {},
      };
    }
  }
  return { error: fallback, fieldErrors: {} };
}
