/**
 * Client + server validation schemas for the auth forms.
 *
 * Re-exports the API-contract Zod shapes so the wire stays the source
 * of truth, but adds web-only ergonomic guards (e.g. matching password
 * confirmation, trimming the email). The server is always the final
 * arbiter — these schemas are about fast feedback, not security.
 */

import { LoginRequest, PASSWORD_MIN_LEN, SignupRequest } from '@aldo-ai/api-contract';
import { z } from 'zod';

export { PASSWORD_MIN_LEN };

export const SignupFormSchema = SignupRequest.extend({
  email: z.string().trim().email('Enter a valid email address.'),
  tenantName: z
    .string()
    .trim()
    .min(1, 'Workspace name is required.')
    .max(120, 'Workspace name must be 120 characters or fewer.'),
  password: z
    .string()
    .min(PASSWORD_MIN_LEN, `Password must be at least ${PASSWORD_MIN_LEN} characters.`),
});
export type SignupFormSchema = z.infer<typeof SignupFormSchema>;

export const LoginFormSchema = LoginRequest.extend({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});
export type LoginFormSchema = z.infer<typeof LoginFormSchema>;

/**
 * Whitelist for the `?next=` redirect target. We only follow same-app
 * relative paths so a malicious link can't bounce a fresh login to an
 * external origin.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/')) return null;
  // Block protocol-relative URLs ("//evil.example/foo") and any URL
  // that looks like it carries a scheme.
  if (raw.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  // Block redirecting back into the auth flow itself.
  if (
    raw === '/login' ||
    raw === '/signup' ||
    raw.startsWith('/login?') ||
    raw.startsWith('/signup?')
  ) {
    return null;
  }
  return raw;
}
