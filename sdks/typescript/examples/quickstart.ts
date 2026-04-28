/**
 * Quickstart — list agents, kick off a run, poll until it finishes.
 *
 * Run with:
 *
 *   pnpm install
 *   ALDO_API_KEY=aldo_live_... node --import tsx sdks/typescript/examples/quickstart.ts
 *
 * The script prints each step and exits 0 on success. It deliberately
 * does NOT depend on a specific agent name — it picks the first agent
 * the tenant has and runs against it. Seed the default agency via
 * /welcome before running this if your tenant is empty.
 */

import { Aldo, AldoApiError } from '../src/index.js';

async function main(): Promise<void> {
  const apiKey = process.env.ALDO_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('ALDO_API_KEY env var is required');
  }
  const aldo = new Aldo({
    apiKey,
    baseUrl: process.env.ALDO_BASE_URL,
  });

  const agents = await aldo.agents.list();
  if (agents.length === 0) {
    console.error(
      'No agents in this tenant yet. Visit https://ai.aldo.tech/welcome and seed the default agency first.',
    );
    process.exit(2);
  }
  const target = agents[0];
  if (target === undefined) return;
  console.log(`[quickstart] running agent: ${target.name} (${target.privacyTier})`);

  const created = await aldo.runs.create({ agentName: target.name });
  console.log(`[quickstart] created run ${created.run.id} (status=${created.run.status})`);

  // Poll up to ~30s for completion.
  for (let i = 0; i < 30; i++) {
    const { run } = await aldo.runs.get(created.run.id);
    if (run.status !== 'running') {
      console.log(`[quickstart] run finished: status=${run.status} cost=${run.totalUsd}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  console.warn('[quickstart] run still in flight after 30s — printing latest snapshot');
  console.log(await aldo.runs.get(created.run.id));
}

main().catch((err) => {
  if (err instanceof AldoApiError) {
    console.error(`[quickstart] api error ${err.status} ${err.code}: ${err.message}`);
  } else {
    console.error('[quickstart] failed:', err);
  }
  process.exit(1);
});
