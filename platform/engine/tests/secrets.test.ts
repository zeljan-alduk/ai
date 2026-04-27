/**
 * Engine ↔ secrets integration test.
 *
 * Verifies the load-bearing claim: when a tool call's args contain
 * `secret://API_KEY`, the ToolHost sees the resolved plaintext but
 * the `tool_call` run-event payload still carries the literal
 * `secret://API_KEY` (i.e. the plaintext never leaks into the audit
 * log).
 *
 * The secrets package satisfies the `SecretArgResolver` interface from
 * `@aldo-ai/engine` via shape-only typing — no compile-time dep flows
 * the other way.
 */

import { InMemorySecretStore, hasRefs, resolveInArgs } from '@aldo-ai/secrets';
import type { Delta, RunEvent, TenantId, ToolRef } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import type { InternalAgentRun, SecretArgResolver } from '../src/agent-run.js';
import { PlatformRuntime } from '../src/runtime.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
  textCompletion,
} from './mocks/index.js';

const TENANT = 'tenant-a' as TenantId;

function toolCallThenStop(callId: string, tool: string, args: unknown): Delta[] {
  return [
    { toolCall: { type: 'tool_call', callId, tool, args } },
    {
      end: {
        finishReason: 'tool_use',
        usage: {
          provider: 'mock',
          model: 'mock-1',
          tokensIn: 1,
          tokensOut: 1,
          usd: 0,
          at: new Date().toISOString(),
        },
        model: {
          id: 'mock-1',
          provider: 'mock',
          locality: 'local',
          provides: [],
          cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
          privacyAllowed: ['public', 'internal', 'sensitive'],
          capabilityClass: 'reasoning-medium',
          effectiveContextTokens: 8192,
        },
      },
    },
  ];
}

describe('engine secret resolution', () => {
  it('resolves secret://NAME in tool args; tool sees plaintext but run events stay masked', async () => {
    // Set up the secret store with a single API_KEY.
    const store = new InMemorySecretStore();
    await store.set(TENANT, 'API_KEY', 'sk-real-9999');

    // Adapter wiring InMemorySecretStore behind the engine's
    // SecretArgResolver shape. The engine never imports the package
    // directly — this is the pattern the API/CLI follow in production.
    const resolver: SecretArgResolver = {
      hasRefs,
      resolveInArgs: (value, ctx) => resolveInArgs(value, store, ctx),
    };

    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'caller' }));

    let call = 0;
    const gateway = new MockGateway(() => {
      if (call++ === 0) {
        return toolCallThenStop('c-1', 'http_get', {
          url: 'https://example.test/x',
          headers: { Authorization: 'Bearer ${secret://API_KEY}' },
        });
      }
      return textCompletion('done');
    });

    // Capture exactly what the tool sees.
    const seen: { tool: ToolRef; args: unknown }[] = [];
    const toolHost = new MockToolHost((tool, args) => {
      seen.push({ tool, args });
      return { received: true };
    });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      secretResolver: resolver,
    });

    const run = (await rt.spawn({ name: 'caller' }, 'go')) as InternalAgentRun;

    // Drain events into a buffer concurrently.
    const events: RunEvent[] = [];
    const drain = (async () => {
      for await (const ev of run.events()) events.push(ev);
    })();

    const result = await run.wait();
    await drain;
    expect(result.ok).toBe(true);

    // 1) Tool received the resolved plaintext.
    expect(seen).toHaveLength(1);
    const sentArgs = seen[0]?.args as { headers: { Authorization: string } };
    expect(sentArgs.headers.Authorization).toBe('Bearer sk-real-9999');

    // 2) The `tool_call` run event still shows the un-resolved reference.
    const toolCallEvent = events.find((e) => e.type === 'tool_call');
    expect(toolCallEvent).toBeDefined();
    const tcPayload = toolCallEvent?.payload as {
      args: { headers: { Authorization: string } };
    };
    expect(tcPayload.args.headers.Authorization).toBe('Bearer ${secret://API_KEY}');

    // 3) Audit log captured one row carrying the caller agent name.
    const audit = (await store.recentAudit?.(TENANT, 'API_KEY', 10)) ?? [];
    expect(audit.length).toBe(1);
    expect(audit[0]?.caller).toBe('caller');
  });

  it('does nothing when the resolver is absent (back-compat path)', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'caller' }));

    let call = 0;
    const gateway = new MockGateway(() => {
      if (call++ === 0) {
        return toolCallThenStop('c-1', 'echo', { msg: 'plain literal' });
      }
      return textCompletion('done');
    });

    const seen: unknown[] = [];
    const toolHost = new MockToolHost((_tool, args) => {
      seen.push(args);
      return { ok: true };
    });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = (await rt.spawn({ name: 'caller' }, 'go')) as InternalAgentRun;
    await run.wait();
    expect(seen).toEqual([{ msg: 'plain literal' }]);
  });
});
