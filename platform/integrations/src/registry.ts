/**
 * Runner registry — maps `IntegrationKind` to its `IntegrationRunner`.
 *
 * Adding a new kind means: (1) add a runner module under
 * `runners/<kind>.ts`, (2) extend `IntegrationKind` in `types.ts`,
 * (3) register the runner here. The dispatcher and the API route
 * never branch on kind themselves — they look it up in this table.
 */

import { discordRunner } from './runners/discord.js';
import { emailRunner } from './runners/email.js';
import { githubRunner } from './runners/github.js';
import { slackRunner } from './runners/slack.js';
import { telegramRunner } from './runners/telegram.js';
import { webhookRunner } from './runners/webhook.js';
import type { IntegrationKind, IntegrationRunner } from './types.js';

const RUNNERS: Readonly<Record<IntegrationKind, IntegrationRunner>> = {
  slack: slackRunner,
  github: githubRunner,
  webhook: webhookRunner,
  discord: discordRunner,
  // MISSING_PIECES §14-B
  telegram: telegramRunner,
  email: emailRunner,
};

export function getRunner(kind: IntegrationKind): IntegrationRunner {
  const runner = RUNNERS[kind];
  if (runner === undefined) {
    throw new Error(`unknown integration kind: ${kind}`);
  }
  return runner;
}

/** All registered runners — handy for tests + the kind-picker UI. */
export function listRunners(): readonly IntegrationRunner[] {
  return Object.values(RUNNERS);
}
