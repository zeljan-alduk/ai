/**
 * Auth API wire types.
 *
 * Wave 10 introduces JWT-based session auth. The API issues an opaque
 * (to the client) JWT on signup/login and validates it on every
 * protected request via the `Authorization: Bearer <token>` header.
 *
 * Session storage policy lives in the web app: the token is stored in
 * an HTTP-only cookie (`aldo_session`), never in localStorage or any
 * other client-readable surface. The browser bundle never sees the
 * token directly — server components read the cookie, attach the
 * header, and forward responses.
 *
 * Multi-tenant: a `User` may belong to multiple tenants (`memberships`).
 * Exactly one tenant is "current" per session; switching is a server
 * action that mints a fresh JWT scoped to the new tenant.
 *
 * LLM-agnostic: nothing in this file references a model provider.
 */

import { z } from 'zod';

// Mirrors apps/api password policy. Keep client + server in lockstep.
export const PASSWORD_MIN_LEN = 12;

export const AuthUser = z.object({
  id: z.string(),
  email: z.string().email(),
  createdAt: z.string(),
});
export type AuthUser = z.infer<typeof AuthUser>;

export const AuthTenant = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});
export type AuthTenant = z.infer<typeof AuthTenant>;

/**
 * One row of `users <-> tenants`. The current session is one of these
 * (matched on `tenantSlug`); the rest populate the sidebar's
 * tenant-switcher dropdown.
 */
export const AuthMembership = z.object({
  tenantId: z.string(),
  tenantSlug: z.string(),
  tenantName: z.string(),
  role: z.string(),
});
export type AuthMembership = z.infer<typeof AuthMembership>;

/* ---------------------------- Signup / login ---------------------------- */

export const SignupRequest = z.object({
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN_LEN),
  tenantName: z.string().min(1).max(120),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/**
 * Shared envelope for signup, login, and tenant-switch. The token is
 * the new bearer credential; the web app drops it into the
 * `aldo_session` HTTP-only cookie on receipt and never echoes it to
 * client-readable state.
 */
export const AuthSessionResponse = z.object({
  token: z.string().min(1),
  user: AuthUser,
  tenant: AuthTenant,
  memberships: z.array(AuthMembership),
});
export type AuthSessionResponse = z.infer<typeof AuthSessionResponse>;

/** GET /v1/auth/me — same payload as the session response, minus token. */
export const AuthMeResponse = z.object({
  user: AuthUser,
  tenant: AuthTenant,
  memberships: z.array(AuthMembership),
});
export type AuthMeResponse = z.infer<typeof AuthMeResponse>;

/* ----------------------------- Switch tenant ---------------------------- */

export const SwitchTenantRequest = z.object({
  tenantSlug: z.string().min(1),
});
export type SwitchTenantRequest = z.infer<typeof SwitchTenantRequest>;

/**
 * Switch returns just `{token, tenant}` — memberships are unchanged.
 * Web reuses the existing memberships list from /v1/auth/me until the
 * next full session refresh.
 */
export const SwitchTenantResponse = z.object({
  token: z.string().min(1),
  tenant: AuthTenant,
});
export type SwitchTenantResponse = z.infer<typeof SwitchTenantResponse>;
