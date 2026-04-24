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
import { NoEligibleModelError } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { createGateway } from '../src/gateway.js';
import { type RegisteredModel, createModelRegistry } from '../src/model-registry.js';
import { buildUsageRecord } from '../src/pricing.js';
import { createAdapterRegistry } from '../src/provider.js';
import type { ProviderAdapter } from '../src/provider.js';

// ---------- Mock adapter ---------------------------------------------------

interface MockAdapter extends ProviderAdapter {
  lastModel: ModelDescriptor | null;
  lastRequest: CompletionRequest | null;
}

function createMockAdapter(): MockAdapter {
  const adapter: MockAdapter = {
    kind: 'mock',
    lastModel: null,
    lastRequest: null,
    async *complete(req, model): AsyncIterable<Delta> {
      adapter.lastModel = model;
      adapter.lastRequest = req;
      yield { textDelta: 'hello ' };
      yield { textDelta: 'world' };
      yield {
        toolCall: {
          type: 'tool_call',
          callId: 'call_1',
          tool: 'noop',
          args: { ok: true },
        },
      };
      const usage = buildUsageRecord(
        model,
        { tokensIn: 10, tokensOut: 5 },
        new Date('2026-04-24T00:00:00Z'),
      );
      yield { end: { finishReason: 'stop', usage, model } };
    },
    async embed(req, model) {
      adapter.lastModel = model;
      return req.input.map(() => [0.1, 0.2, 0.3]);
    },
  };
  return adapter;
}

// ---------- Fixtures -------------------------------------------------------

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

const embedModel: RegisteredModel = {
  id: 'nomic-embed-text',
  provider: 'ollama',
  providerKind: 'mock',
  locality: 'local',
  capabilityClass: 'embeddings',
  provides: ['embeddings'],
  privacyAllowed: ['public', 'internal', 'sensitive'],
  effectiveContextTokens: 8192,
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
};

function makeCtx(overrides: Partial<CallContext> = {}): CallContext {
  const base: CallContext = {
    required: [],
    privacy: 'public',
    budget: { usdMax: 1, usdGrace: 0 } satisfies Budget,
    tenant: 't' as TenantId,
    runId: 'r' as RunId,
    traceId: 'tr' as TraceId,
    agentName: 'unit',
    agentVersion: '0.0.0',
  };
  return { ...base, ...overrides };
}

const request: CompletionRequest = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
};

// ---------- Tests ----------------------------------------------------------

describe('gateway (end-to-end with mock adapter)', () => {
  it('routes to the mock adapter and streams deltas including end marker', async () => {
    const models = createModelRegistry([localModel]);
    const adapter = createMockAdapter();
    const adapters = createAdapterRegistry([adapter]);
    const gateway = createGateway({ models, adapters });

    const deltas: Delta[] = [];
    for await (const d of gateway.completeWith(request, makeCtx(), {
      primaryClass: 'reasoning-medium',
      tokensIn: 10,
      maxTokensOut: 32,
    })) {
      deltas.push(d);
    }

    // Expect: 2 text, 1 tool_call, 1 end
    expect(deltas.filter((d) => d.textDelta).length).toBe(2);
    expect(deltas.filter((d) => d.toolCall).length).toBe(1);
    const endDelta = deltas.find((d) => d.end);
    expect(endDelta).toBeDefined();
    expect(endDelta?.end?.finishReason).toBe('stop');
    expect(endDelta?.end?.usage.provider).toBe('vllm');
    expect(endDelta?.end?.usage.model).toBe('llama-3.3-70b');
    expect(endDelta?.end?.usage.usd).toBe(0);
    expect(endDelta?.end?.model.id).toBe('llama-3.3-70b');
    expect(adapter.lastRequest).toBe(request);
  });

  it('propagates privacy taint: sensitive + cloud-only registry throws NoEligibleModelError', async () => {
    const cloudOnly: RegisteredModel = {
      ...localModel,
      id: 'gpt-5',
      providerKind: 'mock',
      locality: 'cloud',
      privacyAllowed: ['public', 'internal'],
      cost: { usdPerMtokIn: 5, usdPerMtokOut: 40 },
    };
    const models = createModelRegistry([cloudOnly]);
    const adapters = createAdapterRegistry([createMockAdapter()]);
    const gateway = createGateway({ models, adapters });

    await expect(async () => {
      for await (const _ of gateway.completeWith(request, makeCtx({ privacy: 'sensitive' }), {
        primaryClass: 'reasoning-medium',
      })) {
        // drain
      }
    }).rejects.toBeInstanceOf(NoEligibleModelError);
  });

  it('embed() routes to first model with embeddings capability', async () => {
    const models = createModelRegistry([localModel, embedModel]);
    const adapter = createMockAdapter();
    const adapters = createAdapterRegistry([adapter]);
    const gateway = createGateway({ models, adapters });

    const vectors = await gateway.embed({ input: ['a', 'b'] }, makeCtx());
    expect(vectors).toHaveLength(2);
    expect(adapter.lastModel?.id).toBe('nomic-embed-text');
  });

  it('throws UnknownProviderKindError when descriptor points at a missing adapter', async () => {
    const orphan: RegisteredModel = { ...localModel, providerKind: 'no-such-adapter' };
    const models = createModelRegistry([orphan]);
    const adapters = createAdapterRegistry(); // empty
    const gateway = createGateway({ models, adapters });

    await expect(async () => {
      for await (const _ of gateway.completeWith(request, makeCtx(), {
        primaryClass: 'reasoning-medium',
      })) {
        // drain
      }
    }).rejects.toThrow(/no adapter registered/);
  });
});
