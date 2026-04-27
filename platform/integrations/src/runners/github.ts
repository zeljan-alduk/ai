/**
 * GitHub runner — POST a comment on a configured issue/PR.
 *
 * Scope: one (repo, issueNumber) pair per integration. Advanced
 * routing (per-event repo, branch matching, PR commit comments) is a
 * follow-up; for MVP a single comment thread per integration keeps
 * the configuration sane.
 *
 * Token storage: the API encrypts `token` via @aldo-ai/secrets before
 * insert; the runner receives the decrypted value in `config.token`.
 * Never log the token.
 *
 * Trigger policy: by default we comment on `run_failed` and
 * `guards_blocked`; success-only events would be spammy. The runner
 * still dispatches whatever the dispatcher hands it — the dispatcher
 * does the event filter via `integrations.events`. So this runner
 * just renders the payload regardless of which event fired.
 */

import {
  GithubConfig,
  type IntegrationDispatchResult,
  type IntegrationEventPayload,
  type IntegrationRunner,
} from '../types.js';
import { fetchWithTimeout } from './_fetch.js';

const GITHUB_API = 'https://api.github.com';

export const githubRunner: IntegrationRunner = {
  kind: 'github',
  validateConfig(config: unknown): void {
    GithubConfig.parse(config);
  },
  async dispatch(
    payload: IntegrationEventPayload,
    config: Record<string, unknown>,
  ): Promise<IntegrationDispatchResult> {
    let parsed: GithubConfig;
    try {
      parsed = GithubConfig.parse(config);
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }

    const url = `${GITHUB_API}/repos/${parsed.repo}/issues/${parsed.issueNumber}/comments`;
    const body = { body: renderComment(payload) };

    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          // GitHub requires a UA; "aldo-ai-integrations" is opaque
          // so a viewer of the audit log can pin the source.
          'user-agent': 'aldo-ai-integrations',
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${parsed.token}`,
          'x-github-api-version': '2022-11-28',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await safeText(res);
        return { ok: false, statusCode: res.status, error: text || `github ${res.status}` };
      }
      return { ok: true, statusCode: res.status };
    } catch (err) {
      if (isTimeout(err)) return { ok: false, timedOut: true, error: 'github dispatch timeout' };
      return { ok: false, error: errorMessage(err) };
    }
  },
};

function renderComment(payload: IntegrationEventPayload): string {
  const link = payload.link !== null ? `\n\n[Open in ALDO AI](${payload.link})` : '';
  return [
    `**${payload.title}**`,
    '',
    payload.body,
    '',
    `\`event: ${payload.event}\` · \`at: ${payload.occurredAt}\``,
    link,
  ].join('\n');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
