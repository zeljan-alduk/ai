import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFromFile, parseYaml } from '../src/loader.js';
import { validate } from '../src/validator.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = resolve(here, '..', 'fixtures');

describe('loader.parseYaml', () => {
  it('parses the code-reviewer fixture cleanly', async () => {
    const res = await loadFromFile(resolve(fixturesDir, 'code-reviewer.yaml'));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('load failed');

    // snake -> camel
    expect(res.spec.identity.name).toBe('code-reviewer');
    expect(res.spec.identity.version).toBe('1.4.0');
    expect(res.spec.modelPolicy.privacyTier).toBe('internal');
    expect(res.spec.modelPolicy.primary.capabilityClass).toBe('reasoning-large');
    expect(res.spec.modelPolicy.fallbacks).toHaveLength(2);
    expect(res.spec.modelPolicy.budget.usdMax).toBe(0.5);
    expect(res.spec.modelPolicy.budget.tokensInMax).toBe(120000);
    expect(res.spec.modelPolicy.budget.latencyP95Ms).toBe(45000);
    expect(res.spec.modelPolicy.decoding.mode).toBe('json');
    expect(res.spec.modelPolicy.decoding.jsonSchemaRef).toBe('#/outputs/review');
    expect(res.spec.prompt.systemFile).toBe('prompts/code-reviewer.system.md');
    expect(res.spec.tools.permissions.filesystem).toBe('repo-readonly');
    expect(res.spec.role.reportsTo).toBe('tech-lead');
    expect(res.spec.escalation).toHaveLength(2);
    expect(res.spec.escalation[0]?.condition).toBe('confidence < 0.6');
    expect(res.spec.evalGate.requiredSuites[0]?.minScore).toBe(0.85);
    expect(res.spec.evalGate.mustPassBeforePromote).toBe(true);
    expect(res.spec.inputs?.schemaRef).toBe('schemas/pr_payload.json');
    expect(res.spec.outputs?.review?.jsonSchema).toBeDefined();
  });

  it('reports specific path errors on the invalid fixture', async () => {
    const res = await loadFromFile(resolve(fixturesDir, 'invalid-missing-model.yaml'));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unexpected success');
    const paths = res.errors.map((e) => e.path);
    expect(paths).toContain('model_policy');
  });

  it('reports yaml parse errors at $', () => {
    const res = parseYaml(': : not valid : yaml ::\n  - [\n');
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unexpected success');
    expect(res.errors[0]?.path).toBe('$');
  });

  it('rejects unknown top-level keys with a helpful path', () => {
    const yaml = `
apiVersion: aldo-ai/agent.v1
kind: Agent
mystery: true
identity:
  name: x
  version: 0.1.0
  description: d
  owner: o
  tags: []
role: { team: t, pattern: worker }
model_policy:
  capability_requirements: []
  privacy_tier: internal
  primary: { capability_class: reasoning-medium }
  fallbacks: []
  budget: { usd_per_run: 0.1 }
  decoding: { mode: free }
prompt: { system_file: p.md }
tools:
  mcp: []
  native: []
  permissions: { network: none, filesystem: none }
memory: { read: [], write: [], retention: {} }
spawn: { allowed: [] }
escalation: []
subscriptions: []
eval_gate: { required_suites: [], must_pass_before_promote: false }
`;
    const res = validate(yaml);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unexpected success');
    const paths = res.errors.map((e) => e.path);
    expect(paths).toContain('$');
  });

  it('accepts a bare-array escalation shape as well as the `on` wrapper', () => {
    const yaml = `
apiVersion: aldo-ai/agent.v1
kind: Agent
identity:
  name: x
  version: 0.1.0
  description: d
  owner: o
  tags: []
role: { team: t, pattern: worker }
model_policy:
  capability_requirements: []
  privacy_tier: internal
  primary: { capability_class: reasoning-medium }
  fallbacks: []
  budget: { usd_per_run: 0.1 }
  decoding: { mode: free }
prompt: { system_file: p.md }
tools:
  mcp: []
  native: []
  permissions: { network: none, filesystem: none }
memory: { read: [], write: [], retention: {} }
spawn: { allowed: [] }
escalation:
  - condition: "x > 0"
    to: boss
subscriptions: []
eval_gate: { required_suites: [], must_pass_before_promote: false }
`;
    const res = parseYaml(yaml);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.spec) throw new Error('load failed');
    expect(res.spec.escalation).toHaveLength(1);
    expect(res.spec.escalation[0]?.to).toBe('boss');
  });
});
