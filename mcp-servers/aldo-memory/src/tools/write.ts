/**
 * memory.write — upsert an entry. Records `at` and the ISO 8601
 * `retention` (TTL) on the entry; not actively swept in v0.
 */

import { z } from 'zod';
import {
  type MemoryPolicy,
  assertKey,
  assertRetention,
  assertTenant,
  resolveScope,
} from '../policy.js';
import { writeEntry } from '../store.js';

export const memoryWriteInputSchema = z
  .object({
    tenant: z.string().min(1),
    scope: z.enum(['private', 'project', 'org', 'session']),
    key: z.string().min(1),
    value: z.unknown(),
    retention: z.string().min(1).describe('ISO 8601 duration, e.g. "P30D" or "PT1H".'),
    agentName: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
  })
  .strict();

export type MemoryWriteInput = z.infer<typeof memoryWriteInputSchema>;

export const memoryWriteOutputSchema = z
  .object({
    ok: z.literal(true),
    at: z.string(),
  })
  .strict();

export type MemoryWriteOutput = z.infer<typeof memoryWriteOutputSchema>;

export async function memoryWrite(
  policy: MemoryPolicy,
  input: MemoryWriteInput,
): Promise<MemoryWriteOutput> {
  assertTenant(policy, input.tenant);
  assertKey(policy, input.key);
  assertRetention(input.retention);
  const resolved = resolveScope(policy, input.scope, input.agentName, input.runId);
  const at = new Date().toISOString();
  await writeEntry(
    policy,
    { tenant: input.tenant, resolved },
    {
      scope: input.scope,
      key: input.key,
      value: input.value,
      at,
      ttl: input.retention,
    },
  );
  return { ok: true, at };
}
