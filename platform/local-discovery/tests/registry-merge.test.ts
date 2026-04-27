import { type RegisteredModel, createModelRegistry } from '@aldo-ai/gateway';
import { describe, expect, it } from 'vitest';
import { mergeIntoList, mergeIntoRegistry } from '../src/registry-merge.js';
import type { DiscoveredModel } from '../src/types.js';

function makeDiscovered(overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
  return {
    id: 'auto-id',
    provider: 'ollama',
    providerKind: 'openai-compat',
    locality: 'local',
    capabilityClass: 'local-reasoning',
    provides: ['streaming'],
    privacyAllowed: ['public', 'internal', 'sensitive'],
    effectiveContextTokens: 8192,
    cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
    providerConfig: { baseUrl: 'http://localhost:11434/v1' },
    discoveredAt: '2026-04-25T00:00:00.000Z',
    source: 'ollama',
    ...overrides,
  };
}

function yamlRow(id: string): RegisteredModel {
  return {
    id,
    provider: 'anthropic',
    providerKind: 'anthropic',
    locality: 'cloud',
    capabilityClass: 'reasoning-large',
    provides: ['streaming'],
    privacyAllowed: ['public', 'internal'],
    effectiveContextTokens: 200000,
    cost: { usdPerMtokIn: 15, usdPerMtokOut: 75 },
    providerConfig: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
  };
}

describe('mergeIntoRegistry', () => {
  it('registers all discovered models when ids are unique', () => {
    const reg = createModelRegistry();
    const result = mergeIntoRegistry(reg, [
      makeDiscovered({ id: 'qwen' }),
      makeDiscovered({ id: 'llama' }),
    ]);
    expect(result.added).toBe(2);
    expect(result.skipped).toEqual([]);
    expect(
      reg
        .list()
        .map((m) => m.id)
        .sort(),
    ).toEqual(['llama', 'qwen']);
  });

  it('YAML entries always win on duplicate id', () => {
    const reg = createModelRegistry([yamlRow('qwen')]);
    const result = mergeIntoRegistry(reg, [makeDiscovered({ id: 'qwen', provider: 'ollama' })]);
    expect(result.added).toBe(0);
    expect(result.skipped).toEqual(['qwen']);
    // The registry still has the YAML row's provider, not the discovered one.
    expect(reg.get('qwen')?.provider).toBe('anthropic');
  });

  it('partial overlap: registers only the missing ids', () => {
    const reg = createModelRegistry([yamlRow('shared')]);
    const result = mergeIntoRegistry(reg, [
      makeDiscovered({ id: 'shared' }),
      makeDiscovered({ id: 'fresh' }),
    ]);
    expect(result.added).toBe(1);
    expect(result.skipped).toEqual(['shared']);
    expect(reg.get('fresh')?.provider).toBe('ollama');
    expect(reg.get('shared')?.provider).toBe('anthropic');
  });

  it('strips discovery metadata before registering', () => {
    const reg = createModelRegistry();
    mergeIntoRegistry(reg, [makeDiscovered({ id: 'qwen' })]);
    const stored = reg.get('qwen') as Record<string, unknown> | undefined;
    expect(stored).toBeDefined();
    if (stored !== undefined) {
      expect('discoveredAt' in stored).toBe(false);
      expect('source' in stored).toBe(false);
    }
  });

  it('registers discovered models with the documented privacy default', () => {
    const reg = createModelRegistry();
    mergeIntoRegistry(reg, [makeDiscovered({ id: 'qwen' })]);
    expect(reg.get('qwen')?.privacyAllowed).toEqual(['public', 'internal', 'sensitive']);
  });
});

describe('mergeIntoList', () => {
  it('concatenates new ids and drops collisions', () => {
    const yaml = [yamlRow('shared'), yamlRow('cloudy')];
    const out = mergeIntoList(yaml, [
      makeDiscovered({ id: 'shared' }),
      makeDiscovered({ id: 'fresh' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['shared', 'cloudy', 'fresh']);
  });

  it('preserves YAML ordering', () => {
    const yaml = [yamlRow('a'), yamlRow('b'), yamlRow('c')];
    const out = mergeIntoList(yaml, [makeDiscovered({ id: 'd' })]);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('deduplicates within the discovered set', () => {
    const out = mergeIntoList<{ id: string }>(
      [],
      [makeDiscovered({ id: 'dup' }), makeDiscovered({ id: 'dup' })],
    );
    expect(out).toHaveLength(1);
  });
});
