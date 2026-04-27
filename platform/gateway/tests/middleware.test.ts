import { createGuardsMiddleware, resolveGuardsConfig } from '@aldo-ai/guards';
import type {
  Budget,
  CallContext,
  CompletionRequest,
  Delta,
  ModelDescriptor,
  RunId,
  TenantId,
  TraceId,
} from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { createGateway } from '../src/gateway.js';
import type { GatewayMiddleware } from '../src/gateway.js';
import { type RegisteredModel, createModelRegistry } from '../src/model-registry.js';
import { buildUsageRecord } from '../src/pricing.js';
import type { ProviderAdapter } from '../src/provider.js';
import { createAdapterRegistry } from '../src/provider.js';

interface MockAdapter extends ProviderAdapter {
  lastRequest: CompletionRequest | null;
}

function createMockAdapter(): MockAdapter {
  const adapter: MockAdapter = {
    kind: 'mock',
    lastRequest: null,
    async *complete(req, model): AsyncIterable<Delta> {
      adapter.lastRequest = req;
      yield { textDelta: 'safe reply' };
      const usage = buildUsageRecord(model, { tokensIn: 5, tokensOut: 5 }, new Date());
      yield { end: { finishReason: 'stop', usage, model } };
    },
    async embed() {
      return [];
    },
  };
  return adapter;
}

const localModel: RegisteredModel = {
  id: 'llama-3.3-70b',
  provider: 'vllm',
  providerKind: 'mock',
  locality: 'on-prem',
  capabilityClass: 'reasoning-medium',
  provides: ['tool-use', 'streaming'],
  privacyAllowed: ['public', 'internal', 'sensitive'],
  effectiveContextTokens: 128_000,
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
};

function ctx(): CallContext {
  return {
    required: [],
    privacy: 'internal',
    budget: { usdMax: 1, usdGrace: 0 } satisfies Budget,
    tenant: 't' as TenantId,
    runId: 'r' as RunId,
    traceId: 'tr' as TraceId,
    agentName: 'unit',
    agentVersion: '0.0.0',
  };
}

describe('gateway middleware', () => {
  it('runs `before` on the request the adapter sees, end-to-end', async () => {
    const adapter = createMockAdapter();
    const tag: GatewayMiddleware = {
      name: 'tag',
      async before(req) {
        return {
          ...req,
          messages: [
            ...req.messages,
            { role: 'system', content: [{ type: 'text', text: 'INJECTED' }] },
          ],
        };
      },
      async after(d) {
        return d;
      },
    };
    const gw = createGateway({
      models: createModelRegistry([localModel]),
      adapters: createAdapterRegistry([adapter]),
      middleware: [tag],
    });
    for await (const _ of gw.completeWith(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      ctx(),
      { primaryClass: 'reasoning-medium' },
    )) {
      // drain
    }
    expect(adapter.lastRequest?.messages.some((m) => m.role === 'system')).toBe(true);
  });

  it('applies @aldo-ai/guards spotlighting end-to-end (inbound tool results wrapped)', async () => {
    const adapter = createMockAdapter();
    const guards = createGuardsMiddleware({ config: resolveGuardsConfig(undefined) });
    const gw = createGateway({
      models: createModelRegistry([localModel]),
      adapters: createAdapterRegistry([adapter]),
      middleware: [guards],
    });

    const req: CompletionRequest = {
      messages: [
        {
          role: 'tool',
          content: [{ type: 'tool_result', callId: 'c1', result: 'raw tool bytes' }],
        },
      ],
    };
    for await (const _ of gw.completeWith(req, ctx(), { primaryClass: 'reasoning-medium' })) {
      // drain
    }

    const seen = adapter.lastRequest;
    const part = seen?.messages[0]?.content[0];
    expect(part?.type).toBe('tool_result');
    if (part?.type !== 'tool_result') throw new Error('unreachable');
    expect(typeof part.result).toBe('string');
    expect(part.result as string).toContain('<untrusted-content');
    expect(part.result as string).toContain('raw tool bytes');
  });

  it('applies `after` to outbound deltas', async () => {
    const adapter = createMockAdapter();
    const seen: string[] = [];
    const tap: GatewayMiddleware = {
      name: 'tap',
      async before(r) {
        return r;
      },
      async after(d) {
        if (d.textDelta) seen.push(d.textDelta);
        return d;
      },
    };
    const gw = createGateway({
      models: createModelRegistry([localModel]),
      adapters: createAdapterRegistry([adapter]),
      middleware: [tap],
    });
    const drained: Delta[] = [];
    for await (const d of gw.completeWith(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      ctx(),
      { primaryClass: 'reasoning-medium' },
    )) {
      drained.push(d);
    }
    expect(seen).toContain('safe reply');
    expect(drained.length).toBeGreaterThan(0);
  });

  it('omits middleware when not configured (back-compat)', async () => {
    const adapter = createMockAdapter();
    const gw = createGateway({
      models: createModelRegistry([localModel]),
      adapters: createAdapterRegistry([adapter]),
    });
    const drained: Delta[] = [];
    for await (const d of gw.completeWith(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      ctx(),
      { primaryClass: 'reasoning-medium' },
    )) {
      drained.push(d);
    }
    expect(drained.some((d) => d.textDelta === 'safe reply')).toBe(true);
  });
});

// Ensure the mock-only descriptor type is referenced (for TS strict).
void ({} as ModelDescriptor);
