/**
 * memory.read — fetch a single entry by (tenant, scope, key).
 */

import { z } from 'zod';
import { type MemoryPolicy, assertKey, assertTenant, resolveScope } from '../policy.js';
import { readEntry } from '../store.js';

export const memoryReadInputSchema = z
  .object({
    tenant: z.string().min(1),
    scope: z.enum(['private', 'project', 'org', 'session']),
    key: z.string().min(1),
    agentName: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
  })
  .strict();

export type MemoryReadInput = z.infer<typeof memoryReadInputSchema>;

const entrySchema = z.object({
  scope: z.enum(['private', 'project', 'org', 'session']),
  key: z.string(),
  value: z.unknown(),
  at: z.string(),
  ttl: z.string().optional(),
});

export const memoryReadOutputSchema = z
  .object({
    entry: entrySchema.nullable(),
  })
  .strict();

export type MemoryReadOutput = z.infer<typeof memoryReadOutputSchema>;

export async function memoryRead(
  policy: MemoryPolicy,
  input: MemoryReadInput,
): Promise<MemoryReadOutput> {
  assertTenant(policy, input.tenant);
  assertKey(policy, input.key);
  const resolved = resolveScope(policy, input.scope, input.agentName, input.runId);
  const entry = await readEntry(policy, { tenant: input.tenant, resolved }, input.key);
  return { entry };
}
