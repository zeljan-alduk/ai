/**
 * GitHub runner tests — success / failure / timeout / signature.
 *
 * "Signature" for GitHub is the Authorization header: every dispatch
 * MUST send `Authorization: Bearer <token>` so a misconfigured runner
 * never lands an unauthenticated comment.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { githubRunner } from '../src/runners/github.js';
import type { IntegrationEventPayload } from '../src/types.js';
import { type MockServerHandle, patchFetchToServer, startMockServer } from './_helpers.js';

const PAYLOAD: IntegrationEventPayload = {
  event: 'run_failed',
  tenantId: 't-1',
  title: 'Run failed',
  body: 'reviewer/0.1.0 hit a guard',
  link: 'https://app.aldo.test/runs/abc',
  metadata: {},
  occurredAt: '2026-04-26T12:00:00Z',
};

let server: MockServerHandle;
let unpatch: () => void;

beforeEach(async () => {
  server = await startMockServer();
  unpatch = patchFetchToServer(['api.github.com'], server.url);
});

afterEach(async () => {
  unpatch();
  await server.close();
});

describe('githubRunner', () => {
  it('success: posts a comment to /repos/:repo/issues/:n/comments and returns ok=true', async () => {
    server.setResponse({ status: 201, body: '{"id":1}' });
    const result = await githubRunner.dispatch(PAYLOAD, {
      repo: 'aldo-tech-labs/aldo',
      token: 'ghp_test',
      issueNumber: 42,
    });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(201);
    expect(server.requests).toHaveLength(1);
    const req = server.requests[0];
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe('/repos/aldo-tech-labs/aldo/issues/42/comments');
    const parsed = JSON.parse(req?.body ?? '{}') as { body?: string };
    expect(parsed.body).toContain('Run failed');
    expect(parsed.body).toContain('https://app.aldo.test/runs/abc');
  });

  it('failure: 401 returns ok=false with the status code', async () => {
    server.setResponse({ status: 401, body: '{"message":"Bad credentials"}' });
    const result = await githubRunner.dispatch(PAYLOAD, {
      repo: 'aldo-tech-labs/aldo',
      token: 'ghp_bad',
      issueNumber: 42,
    });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.error).toContain('Bad credentials');
  });

  it('timeout: AbortError surfaces as timedOut', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as typeof fetch;
    try {
      const result = await githubRunner.dispatch(PAYLOAD, {
        repo: 'aldo-tech-labs/aldo',
        token: 'ghp_test',
        issueNumber: 42,
      });
      expect(result.ok).toBe(false);
      expect(result.timedOut).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('signature: every request carries Authorization: Bearer <token>', async () => {
    server.setResponse({ status: 201 });
    await githubRunner.dispatch(PAYLOAD, {
      repo: 'aldo-tech-labs/aldo',
      token: 'ghp_xyz',
      issueNumber: 42,
    });
    expect(server.requests).toHaveLength(1);
    const auth = server.requests[0]?.headers.authorization;
    expect(auth).toBe('Bearer ghp_xyz');
    // x-github-api-version + accept must also be present so GitHub
    // routes the request to the modern API surface.
    expect(server.requests[0]?.headers['x-github-api-version']).toBe('2022-11-28');
    expect(server.requests[0]?.headers.accept).toContain('vnd.github');
  });
});
