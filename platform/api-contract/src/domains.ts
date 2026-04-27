/**
 * Wave-16 — per-tenant custom domains wire types.
 *
 * Surface:
 *   POST   /v1/domains             { hostname }
 *   GET    /v1/domains             list (single row for MVP)
 *   POST   /v1/domains/:hostname/verify
 *   DELETE /v1/domains/:hostname
 *
 * Verification is exclusively via TXT record. The CreateDomainResponse
 * carries the literal record name + value the user must add to their
 * DNS provider; the verify endpoint does a DNS lookup and matches.
 *
 * SSL is provisioned by Fly / Vercel out-of-band once the TXT
 * verification succeeds. The `sslStatus` column on the row is
 * informational — the user-facing instructions live in the wizard.
 *
 * LLM-agnostic — provider names never appear here.
 */

import { z } from 'zod';

/** Hostname validation: RFC-1035 labels, no leading/trailing dots. */
const HOSTNAME = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/,
    'invalid hostname',
  );

export const SslStatus = z.enum(['pending', 'issued', 'failed']);
export type SslStatus = z.infer<typeof SslStatus>;

export const TenantDomain = z.object({
  hostname: z.string(),
  verifiedAt: z.string().nullable(),
  verificationToken: z.string(),
  txtRecordName: z.string(),
  txtRecordValue: z.string(),
  sslStatus: SslStatus,
  createdAt: z.string(),
});
export type TenantDomain = z.infer<typeof TenantDomain>;

export const CreateDomainRequest = z.object({
  hostname: HOSTNAME,
});
export type CreateDomainRequest = z.infer<typeof CreateDomainRequest>;

export const CreateDomainResponse = z.object({
  domain: TenantDomain,
});
export type CreateDomainResponse = z.infer<typeof CreateDomainResponse>;

export const ListDomainsResponse = z.object({
  domains: z.array(TenantDomain),
});
export type ListDomainsResponse = z.infer<typeof ListDomainsResponse>;

export const VerifyDomainResponse = z.object({
  verified: z.boolean(),
  verifiedAt: z.string().nullable(),
  /** Diagnostic when verification failed (e.g. "TXT record not found"). */
  reason: z.string().optional(),
});
export type VerifyDomainResponse = z.infer<typeof VerifyDomainResponse>;

export const DeleteDomainResponse = z.object({
  hostname: z.string(),
  deleted: z.boolean(),
});
export type DeleteDomainResponse = z.infer<typeof DeleteDomainResponse>;
