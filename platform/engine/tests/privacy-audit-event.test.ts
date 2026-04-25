/**
 * Wave-8: every successful sensitive-tier model call must emit an
 * audit row of type `routing.privacy_sensitive_resolved` onto the
 * run-event stream. Public/internal-tier calls MUST NOT emit one —
 * the row is the privacy-tier audit trail and must be unambiguous.
 *
 * The router's privacy filter is responsible for the *fail* path; this
 * test pins the *succeed* path. Together they make the
 * `privacy_tier: sensitive` guarantee provable end-to-end.
 */

import type { AgentRef, RunEvent, TenantId } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { PlatformRuntime } from '../src/runtime.js';
import { InMemoryRunStore } from '../src/stores/postgres-run-store.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
  textCompletion,
} from './mocks/index.js';

const TENANT = 'tenant-priv-audit' as TenantId;

describe('routing.privacy_sensitive_resolved audit event', () => {
  it('emits exactly one row when a sensitive-tier agent completes a model turn', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'security-reviewer',
        modelPolicy: {
          capabilityRequirements: [],
          privacyTier: 'sensitive',
          primary: { capabilityClass: 'local-reasoning' },
          fallbacks: [],
          budget: { usdMax: 1, usdGrace: 0.1 },
          decoding: { mode: 'free' },
        },
      }),
    );
    const gateway = new MockGateway(() => textCompletion('done', 'mock-local-7b'));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const ref: AgentRef = { name: 'security-reviewer' };
    const run = await rt.spawn(ref, 'go');
    const collected: RunEvent[] = [];
    for await (const ev of run.events()) {
      collected.push(ev);
    }

    const auditRows = collected.filter(
      (e) => e.type === ('routing.privacy_sensitive_resolved' as RunEvent['type']),
    );
    expect(auditRows).toHaveLength(1);
    const audit = auditRows[0];
    expect(audit).toBeDefined();
    if (!audit) return;
    const payload = audit.payload as {
      agent: string;
      model: string;
      provider: string;
      classUsed: string;
    };
    expect(payload.agent).toBe('security-reviewer');
    expect(payload.model).toBe('mock-local-7b');
    expect(typeof payload.provider).toBe('string');
    expect(typeof payload.classUsed).toBe('string');
  });

  it('does NOT emit the audit row for a public-tier agent', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'public-helper' }));
    const gateway = new MockGateway(() => textCompletion('hi', 'mock-cloud-medium'));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = await rt.spawn({ name: 'public-helper' }, 'go');
    const collected: RunEvent[] = [];
    for await (const ev of run.events()) {
      collected.push(ev);
    }
    const auditRows = collected.filter(
      (e) => e.type === ('routing.privacy_sensitive_resolved' as RunEvent['type']),
    );
    expect(auditRows).toHaveLength(0);
  });

  it('persists the audit row through the RunStore so the API can read it', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'security-reviewer',
        modelPolicy: {
          capabilityRequirements: [],
          privacyTier: 'sensitive',
          primary: { capabilityClass: 'local-reasoning' },
          fallbacks: [],
          budget: { usdMax: 1, usdGrace: 0.1 },
          decoding: { mode: 'free' },
        },
      }),
    );
    const gateway = new MockGateway(() => textCompletion('done', 'mock-local-stored'));
    const runStore = new InMemoryRunStore();
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      runStore,
    });

    const run = await rt.spawn({ name: 'security-reviewer' }, 'go');
    for await (const _ev of run.events()) {
      // drain
    }

    const stored = await runStore.listEvents(run.id);
    const auditRows = stored.filter((e) => e.type === 'routing.privacy_sensitive_resolved');
    expect(auditRows).toHaveLength(1);
    const payload = auditRows[0]?.payload as { model: string; agent: string };
    expect(payload.agent).toBe('security-reviewer');
    expect(payload.model).toBe('mock-local-stored');
  });
});
