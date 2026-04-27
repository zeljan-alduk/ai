/**
 * Secrets API wire types.
 *
 * Secrets are tenant-scoped opaque blobs (provider keys, OAuth tokens,
 * webhook signing keys) referenced from agent specs as
 * `secret://<name>` and resolved only at tool-call time inside
 * ToolHost. They never appear in agent prompts, run events, traces,
 * or logs. The API never returns raw values — only redacted summaries
 * + last-edited metadata.
 */
import { z } from 'zod';

/** Compact secret record. The raw value is never sent in either
 *  direction except in `SetSecretRequest`. */
export const SecretSummary = z.object({
  name: z.string(),
  /** Hash of the raw value, for audit / change-detection. */
  fingerprint: z.string(),
  /** Last 4 chars of the value, for human reference. */
  preview: z.string(),
  /** Optional list of agent specs that reference this secret. */
  referencedBy: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SecretSummary = z.infer<typeof SecretSummary>;

export const ListSecretsResponse = z.object({
  secrets: z.array(SecretSummary),
});
export type ListSecretsResponse = z.infer<typeof ListSecretsResponse>;

export const SetSecretRequest = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/, {
    message: 'secret names are SCREAMING_SNAKE_CASE',
  }),
  value: z.string().min(1),
});
export type SetSecretRequest = z.infer<typeof SetSecretRequest>;

/** The Set response is the same compact summary so the CLI can echo
 *  the fingerprint + preview without a second GET. */
export const SetSecretResponse = SecretSummary;
export type SetSecretResponse = z.infer<typeof SetSecretResponse>;
