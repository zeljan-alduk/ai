import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFromFile, parseYaml } from '../src/loader.js';
import { agentV1YamlSchema } from '../src/schema.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = resolve(here, '..', 'fixtures');

describe('agent.v1 tools.guards (additive, optional)', () => {
  it('the existing code-reviewer fixture (no guards block) still parses', async () => {
    const res = await loadFromFile(resolve(fixturesDir, 'code-reviewer.yaml'));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('load failed');
    expect(res.spec.tools.guards).toBeUndefined();
  });

  it('parses an agent that DOES carry a tools.guards block (full shape)', () => {
    const yaml = `
apiVersion: aldo-ai/agent.v1
kind: Agent
identity:
  name: guarded-agent
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
  guards:
    spotlighting: true
    output_scanner:
      enabled: true
      severity_block: error
      url_allowlist:
        - https://api.github.com/*
    quarantine:
      enabled: true
      capability_class: reasoning-medium
      threshold_chars: 4000
memory: { read: [], write: [], retention: {} }
spawn: { allowed: [] }
escalation: []
subscriptions: []
eval_gate: { required_suites: [], must_pass_before_promote: false }
`;
    const res = parseYaml(yaml);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.spec) throw new Error('load failed');
    const g = res.spec.tools.guards;
    expect(g).toBeDefined();
    expect(g?.spotlighting).toBe(true);
    expect(g?.outputScanner?.enabled).toBe(true);
    expect(g?.outputScanner?.severityBlock).toBe('error');
    expect(g?.outputScanner?.urlAllowlist).toEqual(['https://api.github.com/*']);
    expect(g?.quarantine?.enabled).toBe(true);
    expect(g?.quarantine?.capabilityClass).toBe('reasoning-medium');
    expect(g?.quarantine?.thresholdChars).toBe(4000);
  });

  it('parses an agent with a partial guards block (defaults filled by guards package)', () => {
    const yaml = `
apiVersion: aldo-ai/agent.v1
kind: Agent
identity:
  name: minimal-guards
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
  guards:
    spotlighting: false
memory: { read: [], write: [], retention: {} }
spawn: { allowed: [] }
escalation: []
subscriptions: []
eval_gate: { required_suites: [], must_pass_before_promote: false }
`;
    const res = parseYaml(yaml);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.spec) throw new Error('load failed');
    expect(res.spec.tools.guards?.spotlighting).toBe(false);
    expect(res.spec.tools.guards?.outputScanner).toBeUndefined();
    expect(res.spec.tools.guards?.quarantine).toBeUndefined();
  });

  it('rejects unknown keys inside tools.guards (strict)', () => {
    const raw = {
      apiVersion: 'aldo-ai/agent.v1' as const,
      kind: 'Agent' as const,
      identity: { name: 'x', version: '0.1.0', description: 'd', owner: 'o', tags: [] },
      role: { team: 't', pattern: 'worker' as const },
      model_policy: {
        capability_requirements: [],
        privacy_tier: 'internal' as const,
        primary: { capability_class: 'reasoning-medium' },
        fallbacks: [],
        budget: { usd_per_run: 0.1 },
        decoding: { mode: 'free' as const },
      },
      prompt: { system_file: 'p.md' },
      tools: {
        mcp: [],
        native: [],
        permissions: { network: 'none' as const, filesystem: 'none' as const },
        guards: { bogus_field: true },
      },
      memory: { read: [], write: [], retention: {} },
      spawn: { allowed: [] },
      escalation: [],
      subscriptions: [],
      eval_gate: { required_suites: [], must_pass_before_promote: false },
    };
    const res = agentV1YamlSchema.safeParse(raw);
    expect(res.success).toBe(false);
  });

  it('rejects an out-of-range severity_block', () => {
    const raw = {
      apiVersion: 'aldo-ai/agent.v1' as const,
      kind: 'Agent' as const,
      identity: { name: 'x', version: '0.1.0', description: 'd', owner: 'o', tags: [] },
      role: { team: 't', pattern: 'worker' as const },
      model_policy: {
        capability_requirements: [],
        privacy_tier: 'internal' as const,
        primary: { capability_class: 'reasoning-medium' },
        fallbacks: [],
        budget: { usd_per_run: 0.1 },
        decoding: { mode: 'free' as const },
      },
      prompt: { system_file: 'p.md' },
      tools: {
        mcp: [],
        native: [],
        permissions: { network: 'none' as const, filesystem: 'none' as const },
        guards: { output_scanner: { severity_block: 'PANIC' } },
      },
      memory: { read: [], write: [], retention: {} },
      spawn: { allowed: [] },
      escalation: [],
      subscriptions: [],
      eval_gate: { required_suites: [], must_pass_before_promote: false },
    };
    const res = agentV1YamlSchema.safeParse(raw);
    expect(res.success).toBe(false);
  });
});
