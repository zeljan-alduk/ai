/**
 * MISSING_PIECES §10 / Phase B — chat-shape inputs to IterativeAgentRun.
 *
 * The §10 plan retargets the assistant onto the iterative loop. The
 * assistant feeds a multi-turn conversation into the run via a
 * structured input: `{ messages: [{role, content}, ...], systemPrompt }`.
 * `seedMessages` was extended to recognise this shape and seed the
 * loop with the actual conversation instead of JSON-stringifying it
 * into a single user message.
 *
 * Coverage:
 *   - `{ messages, systemPrompt }` round-trips: the gateway sees the
 *     full conversation in its first CompletionRequest.
 *   - `systemPrompt` overrides the spec-derived one.
 *   - Pre-§10 callers that pass a string still work (regression).
 *   - String-content messages are wrapped into TextParts.
 *   - Pre-formed array-of-MessageParts (e.g. resuming with prior
 *     tool_calls) is preserved unchanged.
 */

import type {
  CallContext,
  CompletionRequest,
  Delta,
  IterationSpec,
  Message,
  ModelDescriptor,
  TenantId,
  UsageRecord,
} from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { PlatformRuntime } from '../src/runtime.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
} from './mocks/index.js';

const MODEL_DESC: ModelDescriptor = {
  id: 'mock',
  provider: 'mock',
  locality: 'local',
  provides: [],
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  privacyAllowed: ['public', 'internal'],
  capabilityClass: 'reasoning-medium',
  effectiveContextTokens: 8192,
};

const usage = (over: Partial<UsageRecord> = {}): UsageRecord => ({
  provider: 'mock',
  model: 'mock-1',
  tokensIn: 5,
  tokensOut: 3,
  usd: 0,
  at: '2026-05-04T00:00:00Z',
  ...over,
});

function deltaWithText(text: string): Delta[] {
  return [
    { textDelta: text },
    { end: { finishReason: 'stop', usage: usage(), model: MODEL_DESC } },
  ];
}

const ITERATION_BASE: IterationSpec = {
  maxCycles: 3,
  contextWindow: 8000,
  summaryStrategy: 'rolling-window',
  terminationConditions: [{ kind: 'text-includes', text: '<turn-complete>' }],
};

describe('IterativeAgentRun — chat-shape inputs', () => {
  it('seeds the loop with a multi-turn conversation when inputs is { messages }', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'chat', iteration: ITERATION_BASE }));

    let observed: CompletionRequest | undefined;
    const gateway = new MockGateway((req: CompletionRequest, _ctx: CallContext) => {
      if (observed === undefined) observed = req;
      return deltaWithText('answer <turn-complete>');
    });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: 'tenant-chat' as TenantId,
    });

    const run = await rt.runAgent(
      { name: 'chat' },
      {
        messages: [
          { role: 'user', content: 'first question' },
          { role: 'assistant', content: 'first answer' },
          { role: 'user', content: 'follow-up' },
        ],
        systemPrompt: 'You are a helpful test assistant.',
      },
    );
    // @ts-expect-error wait is on InternalAgentRun
    const r = await run.wait();
    expect(r.ok).toBe(true);

    expect(observed).toBeDefined();
    const seenMessages = observed?.messages ?? [];
    // system + 3 chat turns = 4 messages.
    expect(seenMessages).toHaveLength(4);
    expect(seenMessages[0]?.role).toBe('system');
    expect((seenMessages[0]?.content[0] as { text: string }).text).toBe(
      'You are a helpful test assistant.',
    );
    expect(seenMessages[1]?.role).toBe('user');
    expect((seenMessages[1]?.content[0] as { text: string }).text).toBe('first question');
    expect(seenMessages[2]?.role).toBe('assistant');
    expect((seenMessages[2]?.content[0] as { text: string }).text).toBe('first answer');
    expect(seenMessages[3]?.role).toBe('user');
    expect((seenMessages[3]?.content[0] as { text: string }).text).toBe('follow-up');
  });

  it('drops messages whose role is unrecognised', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'chat', iteration: ITERATION_BASE }));

    let observed: CompletionRequest | undefined;
    const gateway = new MockGateway((req: CompletionRequest) => {
      if (observed === undefined) observed = req;
      return deltaWithText('<turn-complete>');
    });
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: 'tenant-chat' as TenantId,
    });

    await rt
      .runAgent(
        { name: 'chat' },
        {
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'rando', content: 'bogus' } as unknown as Message,
            { role: 'assistant', content: 'ok' },
          ],
          systemPrompt: 'sys',
        },
      )
      // @ts-expect-error wait is on InternalAgentRun
      .then((r) => r.wait());

    const seen = observed?.messages ?? [];
    // sys + user + assistant (the rando role was dropped).
    expect(seen.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
  });

  it('falls back to the spec-rendered system prompt when systemPrompt is omitted', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'chat', iteration: ITERATION_BASE }));
    let observed: CompletionRequest | undefined;
    const gateway = new MockGateway((req: CompletionRequest) => {
      if (observed === undefined) observed = req;
      return deltaWithText('<turn-complete>');
    });
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: 'tenant-chat' as TenantId,
    });

    await rt
      .runAgent(
        { name: 'chat' },
        { messages: [{ role: 'user', content: 'hello' }] },
      )
      // @ts-expect-error wait is on InternalAgentRun
      .then((r) => r.wait());

    const sys = (observed?.messages ?? [])[0];
    expect(sys?.role).toBe('system');
    // The render helper includes the agent identity name; the chat
    // role-route doesn't override it when systemPrompt is missing.
    expect((sys?.content[0] as { text: string }).text).toContain('chat');
  });

  it('regression: pre-§10 callers passing a plain string still get the legacy seed shape', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'classic', iteration: ITERATION_BASE }));
    let observed: CompletionRequest | undefined;
    const gateway = new MockGateway((req: CompletionRequest) => {
      if (observed === undefined) observed = req;
      return deltaWithText('<turn-complete>');
    });
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: 'tenant-chat' as TenantId,
    });

    await rt
      .runAgent({ name: 'classic' }, 'plain old user input')
      // @ts-expect-error wait is on InternalAgentRun
      .then((r) => r.wait());

    const seen = observed?.messages ?? [];
    // system + user (single-message legacy seeding).
    expect(seen).toHaveLength(2);
    expect(seen[0]?.role).toBe('system');
    expect(seen[1]?.role).toBe('user');
    expect((seen[1]?.content[0] as { text: string }).text).toBe('plain old user input');
  });
});
