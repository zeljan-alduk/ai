/**
 * memory.scan — list entries under a (tenant, scope) bucket whose key
 * starts with `prefix`. Bounded by `limit`.
 */

import { z } from 'zod';
import { type MemoryPolicy, assertTenant, resolveScope } from '../policy.js';
import { scanEntries } from '../store.js';

export const memoryScanInputSchema = z
  .object({
    tenant: z.string().min(1),
    scope: z.enum(['private', 'project', 'org', 'session']),
    prefix: z.string().default(''),
    limit: z.number().int().positive().max(500).default(50),
    agentName: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
  })
  .strict();

export type MemoryScanInput = z.infer<typeof memoryScanInputSchema>;

const entrySchema = z.object({
  scope: z.enum(['private', 'project', 'org', 'session']),
  key: z.string(),
  value: z.unknown(),
  at: z.string(),
  ttl: z.string().optional(),
});

export const memoryScanOutputSchema = z
  .object({
    entries: z.array(entrySchema),
  })
  .strict();

export type MemoryScanOutput = z.infer<typeof memoryScanOutputSchema>;

export async function memoryScan(
  policy: MemoryPolicy,
  input: MemoryScanInput,
): Promise<MemoryScanOutput> {
  assertTenant(policy, input.tenant);
  const resolved = resolveScope(policy, input.scope, input.agentName, input.runId);
  const entries = await scanEntries(
    policy,
    { tenant: input.tenant, resolved },
    input.prefix,
    input.limit,
  );
  return { entries };
}
