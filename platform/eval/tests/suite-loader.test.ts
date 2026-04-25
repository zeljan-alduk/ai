import { describe, expect, it } from 'vitest';
import { loadSuiteFromFile, parseSuiteYaml } from '../src/suite-loader.js';

const VALID = `
name: smoke
version: 0.1.0
description: minimal
agent: foo
passThreshold: 0.5
cases:
  - id: c1
    input: hello
    expect:
      kind: contains
      value: ello
`;

describe('suite-loader', () => {
  it('parses a valid YAML suite', () => {
    const r = parseSuiteYaml(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.suite.name).toBe('smoke');
      expect(r.suite.cases).toHaveLength(1);
      expect(r.suite.cases[0]?.expect.kind).toBe('contains');
    }
  });

  it('rejects a suite missing passThreshold', () => {
    const yaml = VALID.replace('passThreshold: 0.5\n', '');
    const r = parseSuiteYaml(yaml);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.path.includes('passThreshold'))).toBe(true);
    }
  });

  it('rejects a case that declares both value and schema', () => {
    const yaml = `
name: smoke
version: 0.1.0
description: minimal
agent: foo
passThreshold: 0.5
cases:
  - id: bad
    input: x
    expect:
      kind: json_schema
      value: oops
      schema:
        type: object
`;
    const r = parseSuiteYaml(yaml);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.message).toMatch(/must not declare 'value'/);
    }
  });

  it('rejects a contains case that also declares schema', () => {
    const yaml = `
name: smoke
version: 0.1.0
description: minimal
agent: foo
passThreshold: 0.5
cases:
  - id: bad
    input: x
    expect:
      kind: contains
      value: y
      schema:
        type: object
`;
    const r = parseSuiteYaml(yaml);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.message).toMatch(/must not declare 'schema'/);
    }
  });

  it('rejects malformed YAML', () => {
    const r = parseSuiteYaml(': : :\n  -');
    expect(r.ok).toBe(false);
  });

  it('rejects a non-mapping root', () => {
    const r = parseSuiteYaml('- a\n- b\n');
    expect(r.ok).toBe(false);
    // Either our pre-Zod lint or Zod itself surfaces this — the message
    // text differs by surface but the failure must be reported.
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  it('loads the bundled code-reviewer-smoke fixture from disk', async () => {
    const path = new URL('../fixtures/code-reviewer-smoke.yaml', import.meta.url).pathname;
    const r = await loadSuiteFromFile(path);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.suite.agent).toBe('code-reviewer');
      expect(r.suite.cases.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('returns a read error for a missing file', async () => {
    const r = await loadSuiteFromFile('/no/such/file.yaml');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.message).toMatch(/read error/);
    }
  });
});
