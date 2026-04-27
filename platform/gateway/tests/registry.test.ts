import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DuplicateModelError } from '../src/errors.js';
import { createModelRegistry, parseModelsYaml } from '../src/model-registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '../fixtures/models.yaml');

describe('model registry', () => {
  it('parses the seed YAML catalogue without error', () => {
    const yaml = readFileSync(fixturePath, 'utf8');
    const models = parseModelsYaml(yaml);
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id === 'claude-opus-4-7')).toBe(true);
    expect(models.some((m) => m.id === 'qwen2.5-coder:32b')).toBe(true);
  });

  it('rejects duplicate ids', () => {
    const m = {
      id: 'dup',
      provider: 'x',
      providerKind: 'mock',
      locality: 'local' as const,
      capabilityClass: 'reasoning-small',
      provides: [],
      privacyAllowed: ['public' as const],
      effectiveContextTokens: 1024,
      cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
    };
    expect(() => createModelRegistry([m, { ...m }])).toThrow(DuplicateModelError);
  });

  it('list/get/register/remove round-trip', () => {
    const reg = createModelRegistry();
    reg.register({
      id: 'one',
      provider: 'x',
      providerKind: 'mock',
      locality: 'local',
      capabilityClass: 'reasoning-small',
      provides: [],
      privacyAllowed: ['public'],
      effectiveContextTokens: 1024,
      cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
    });
    expect(reg.get('one')?.id).toBe('one');
    expect(reg.list()).toHaveLength(1);
    expect(reg.remove('one')).toBe(true);
    expect(reg.get('one')).toBeUndefined();
  });
});
