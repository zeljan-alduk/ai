import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentSpec } from '@meridian/types';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import { AgentNotFoundError, NoPromotedVersionError } from '../src/storage.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = resolve(here, '..', 'fixtures');

async function loadReviewerYaml(): Promise<string> {
  return readFile(resolve(fixturesDir, 'code-reviewer.yaml'), 'utf8');
}

function bump(spec: AgentSpec, version: string): AgentSpec {
  return { ...spec, identity: { ...spec.identity, version } };
}

describe('AgentRegistry', () => {
  it('registers the fixture and loads it by explicit version', async () => {
    const reg = new AgentRegistry();
    const yaml = await loadReviewerYaml();
    const res = reg.register(yaml);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.spec) throw new Error('register failed');

    const got = await reg.load({ name: 'code-reviewer', version: '1.4.0' });
    expect(got.identity.version).toBe('1.4.0');
  });

  it('throws when loading an unknown version', async () => {
    const reg = new AgentRegistry();
    const yaml = await loadReviewerYaml();
    reg.register(yaml);
    await expect(reg.load({ name: 'code-reviewer', version: '9.9.9' })).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
  });

  it('load() with no version returns the promoted version after promote()', async () => {
    const reg = new AgentRegistry();
    const yaml = await loadReviewerYaml();
    const res = reg.register(yaml);
    if (!res.ok || !res.spec) throw new Error('register failed');
    const v1 = res.spec;

    // Add a second version
    const v2 = bump(v1, '1.5.0');
    reg.registerSpec(v2);
    const v3 = bump(v1, '2.0.0');
    reg.registerSpec(v3);

    // No promotion yet: ambiguous, must throw.
    await expect(reg.load({ name: 'code-reviewer' })).rejects.toBeInstanceOf(
      NoPromotedVersionError,
    );

    // Promote the middle version; load() without version should return it.
    await reg.promote({ name: 'code-reviewer', version: '1.5.0' }, { evalReportId: 'abc' });
    const got = await reg.load({ name: 'code-reviewer' });
    expect(got.identity.version).toBe('1.5.0');

    // Re-promote to the highest; pointer flips.
    await reg.promote({ name: 'code-reviewer', version: '2.0.0' }, { evalReportId: 'def' });
    const got2 = await reg.load({ name: 'code-reviewer' });
    expect(got2.identity.version).toBe('2.0.0');
  });

  it('bootstrap: load() without version works when only one version exists', async () => {
    const reg = new AgentRegistry();
    const yaml = await loadReviewerYaml();
    reg.register(yaml);
    const got = await reg.load({ name: 'code-reviewer' });
    expect(got.identity.version).toBe('1.4.0');
  });

  it('list() filters by name and owner', async () => {
    const reg = new AgentRegistry();
    const yaml = await loadReviewerYaml();
    const res = reg.register(yaml);
    if (!res.ok || !res.spec) throw new Error('register failed');
    reg.registerSpec(bump(res.spec, '1.5.0'));

    const byName = await reg.list({ name: 'code-reviewer' });
    expect(byName).toHaveLength(2);

    const byOwner = await reg.list({ owner: 'support-team@meridian-labs' });
    expect(byOwner).toHaveLength(2);

    const none = await reg.list({ owner: 'someone-else' });
    expect(none).toHaveLength(0);
  });

  it('rejects invalid YAML through the register path without storing anything', async () => {
    const reg = new AgentRegistry();
    const invalidYaml = await readFile(resolve(fixturesDir, 'invalid-missing-model.yaml'), 'utf8');
    const res = reg.register(invalidYaml);
    expect(res.ok).toBe(false);
    const list = await reg.list();
    expect(list).toHaveLength(0);
  });

  it('promote() runs an evidence acceptor when provided', async () => {
    const reg = new AgentRegistry({
      acceptEvidence: async (_ref, evidence) =>
        typeof evidence === 'object' &&
        evidence !== null &&
        'pass' in evidence &&
        (evidence as { pass?: boolean }).pass === true,
    });
    const yaml = await loadReviewerYaml();
    reg.register(yaml);

    await expect(
      reg.promote({ name: 'code-reviewer', version: '1.4.0' }, { pass: false }),
    ).rejects.toThrow(/evidence rejected/);

    await reg.promote({ name: 'code-reviewer', version: '1.4.0' }, { pass: true });
    expect(reg.promotedVersion('code-reviewer')).toBe('1.4.0');
  });

  it('validate() exposes the same checks as parseYaml', async () => {
    const reg = new AgentRegistry();
    const yaml = await loadReviewerYaml();
    const res = reg.validate(yaml);
    expect(res.ok).toBe(true);
    const bad = reg.validate('not: valid: yaml: :: [');
    expect(bad.ok).toBe(false);
  });
});
