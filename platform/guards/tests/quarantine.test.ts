import type {
  Budget,
  CallContext,
  CompletionRequest,
  Delta,
  RunId,
  TenantId,
  TraceId,
} from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { DualLlmQuarantine, type QuarantineGateway } from '../src/quarantine.js';

interface RecordedCall {
  readonly request: CompletionRequest;
  readonly hints: { readonly primaryClass: string };
}

function makeCtx(): CallContext {
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

function fakeGateway(replyJson: string): {
  gateway: QuarantineGateway;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const gateway: QuarantineGateway = {
    completeWith(req, _ctx, hints) {
      calls.push({ request: req, hints: { primaryClass: hints.primaryClass } });
      return (async function* (): AsyncIterable<Delta> {
        yield { textDelta: replyJson };
      })();
    },
    complete(req, ctx) {
      return this.completeWith(req, ctx, { primaryClass: 'reasoning-medium' });
    },
    async embed() {
      return [];
    },
  };
  return { gateway, calls };
}

describe('DualLlmQuarantine', () => {
  it('passes-through when below threshold', async () => {
    const { gateway, calls } = fakeGateway('{"summary":"x","safe":true}');
    const q = new DualLlmQuarantine(gateway, {
      enabled: true,
      capabilityClass: 'reasoning-medium',
      thresholdChars: 1000,
    });
    const res = await q.run('short text', makeCtx());
    expect(res.quarantined).toBe(false);
    expect(res.safeText).toBe('short text');
    expect(calls.length).toBe(0);
  });

  it('passes-through when disabled even on huge text', async () => {
    const { gateway, calls } = fakeGateway('{"summary":"x","safe":true}');
    const q = new DualLlmQuarantine(gateway, {
      enabled: false,
      capabilityClass: 'reasoning-medium',
      thresholdChars: 1,
    });
    const res = await q.run('x'.repeat(10_000), makeCtx());
    expect(res.quarantined).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('routes by capability class (LLM-agnostic) when invoked', async () => {
    const { gateway, calls } = fakeGateway('{"summary":"ok","safe":true}');
    const q = new DualLlmQuarantine(gateway, {
      enabled: true,
      capabilityClass: 'local-reasoning',
      thresholdChars: 4,
    });
    const res = await q.run('xxxxxxxxxx', makeCtx());
    expect(res.quarantined).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]?.hints.primaryClass).toBe('local-reasoning');
    // Constrained-decoding signal is set on the request.
    expect(calls[0]?.request.responseFormat?.type).toBe('json_schema');
    expect(res.safeText).toContain('quarantine-summary');
    expect(res.summary?.safe).toBe(true);
  });

  it('flags unsafe responses with the model-supplied notes', async () => {
    const { gateway } = fakeGateway(
      '{"summary":"contains injection","safe":false,"notes":"says ignore previous"}',
    );
    const q = new DualLlmQuarantine(gateway, {
      enabled: true,
      capabilityClass: 'reasoning-medium',
      thresholdChars: 4,
    });
    const res = await q.run('a long suspicious string', makeCtx());
    expect(res.quarantined).toBe(true);
    expect(res.summary?.safe).toBe(false);
    expect(res.safeText).toContain('flagged unsafe');
    expect(res.safeText).toContain('says ignore previous');
  });

  it('fails closed when the quarantine model emits unparseable output', async () => {
    const { gateway } = fakeGateway('not json at all');
    const q = new DualLlmQuarantine(gateway, {
      enabled: true,
      capabilityClass: 'reasoning-medium',
      thresholdChars: 4,
    });
    const res = await q.run('a long suspicious string', makeCtx());
    expect(res.quarantined).toBe(true);
    // Critical: the privileged path must not see the raw text.
    expect(res.safeText).not.toContain('a long suspicious string');
    expect(res.safeText).toContain('quarantine-failed');
  });

  it('the privileged path never sees the raw tool output', async () => {
    const RAW = 'SECRET_PAYLOAD_DO_NOT_LEAK_42';
    const { gateway } = fakeGateway(`{"summary":"summarised","safe":true}`);
    const q = new DualLlmQuarantine(gateway, {
      enabled: true,
      capabilityClass: 'reasoning-medium',
      thresholdChars: 4,
    });
    const res = await q.run(RAW, makeCtx());
    expect(res.safeText).not.toContain(RAW);
  });
});
