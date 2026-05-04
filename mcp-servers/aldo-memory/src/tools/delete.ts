/**
 * memory.delete — remove a single entry. Returns deleted: false (and
 * ok: true) when the key was already absent — the caller doesn't have
 * to pre-check.
 */

import { z } from 'zod';
import { type MemoryPolicy, assertKey, assertTenant, resolveScope } from '../policy.js';
import { deleteEntry } from '../store.js';

export const memoryDeleteInputSchema = z
  .object({
    tenant: z.string().min(1),
    scope: z.enum(['private', 'project', 'org', 'session']),
    key: z.string().min(1),
    agentName: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
  })
  .strict();

export type MemoryDeleteInput = z.infer<typeof memoryDeleteInputSchema>;

export const memoryDeleteOutputSchema = z
  .object({
    ok: z.literal(true),
    deleted: z.boolean(),
  })
  .strict();

export type MemoryDeleteOutput = z.infer<typeof memoryDeleteOutputSchema>;

export async function memoryDelete(
  policy: MemoryPolicy,
  input: MemoryDeleteInput,
): Promise<MemoryDeleteOutput> {
  assertTenant(policy, input.tenant);
  assertKey(policy, input.key);
  const resolved = resolveScope(policy, input.scope, input.agentName, input.runId);
  const deleted = await deleteEntry(policy, { tenant: input.tenant, resolved }, input.key);
  return { ok: true, deleted };
}
