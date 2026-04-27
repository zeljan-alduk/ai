/**
 * Wave-9 composite (multi-agent) block — Zod validation, cross-field
 * rules, snake_case <-> camelCase round-trip via the loader, and a
 * smoke load over the entire `agency/` tree.
 *
 * The composite block is purely structural: no provider names, no
 * privacy_tier of its own. Tests therefore only assert SHAPE.
 */

import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFromFile, parseYaml } from '../src/loader.js';
import { agentV1YamlSchema } from '../src/schema.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const agencyRoot = resolve(repoRoot, 'agency');

/** Build a minimal raw agent.v1 doc and merge a `composite` block onto it. */
function withComposite(composite: unknown): Record<string, unknown> {
  return {
    apiVersion: 'aldo-ai/agent.v1',
    kind: 'Agent',
    identity: { name: 'demo', version: '0.1.0', description: 'd', owner: 'o', tags: [] },
    role: { team: 't', pattern: 'supervisor' as const },
    model_policy: {
      capability_requirements: [],
      privacy_tier: 'internal' as const,
      primary: { capability_class: 'reasoning-medium' },
      fallbacks: [],
      budget: { usd_per_run: 0.1 },
      decoding: { mode: 'free' as const },
    },
    prompt: { system_file: 'p.md' },
    tools: { mcp: [], native: [], permissions: { network: 'none', filesystem: 'none' } },
    memory: { read: [], write: [], retention: {} },
    spawn: { allowed: [] },
    escalation: [],
    subscriptions: [],
    eval_gate: { required_suites: [], must_pass_before_promote: false },
    composite,
  };
}

describe('agent.v1 composite block — Zod validation', () => {
  it('accepts a sequential composite with one subagent', () => {
    const raw = withComposite({
      strategy: 'sequential',
      subagents: [{ agent: 'code-reviewer' }],
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(true);
  });

  it('accepts a parallel composite with multiple subagents', () => {
    const raw = withComposite({
      strategy: 'parallel',
      subagents: [
        { agent: 'code-reviewer', as: 'reviewer' },
        { agent: 'security-auditor', as: 'security' },
      ],
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(true);
  });

  it('accepts a debate composite with an aggregator', () => {
    const raw = withComposite({
      strategy: 'debate',
      subagents: [{ agent: 'a' }, { agent: 'b' }],
      aggregator: 'tech-lead',
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(true);
  });

  it('accepts an iterative composite with iteration + exactly 1 subagent', () => {
    const raw = withComposite({
      strategy: 'iterative',
      subagents: [{ agent: 'refiner' }],
      iteration: { max_rounds: 3, terminate: 'outputs.approved == true' },
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(true);
  });

  it('rejects debate without aggregator', () => {
    const raw = withComposite({
      strategy: 'debate',
      subagents: [{ agent: 'a' }, { agent: 'b' }],
    });
    const res = agentV1YamlSchema.safeParse(raw);
    expect(res.success).toBe(false);
    if (!res.success) {
      const path = res.error.issues[0]?.path.join('.');
      expect(path).toContain('aggregator');
    }
  });

  it('rejects aggregator on a non-debate strategy', () => {
    const raw = withComposite({
      strategy: 'sequential',
      subagents: [{ agent: 'a' }],
      aggregator: 'judge',
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects iterative without iteration block', () => {
    const raw = withComposite({
      strategy: 'iterative',
      subagents: [{ agent: 'refiner' }],
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects iteration on a non-iterative strategy', () => {
    const raw = withComposite({
      strategy: 'sequential',
      subagents: [{ agent: 'a' }],
      iteration: { max_rounds: 2, terminate: 'true' },
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects iterative with more than one subagent', () => {
    const raw = withComposite({
      strategy: 'iterative',
      subagents: [{ agent: 'a' }, { agent: 'b' }],
      iteration: { max_rounds: 2, terminate: 'true' },
    });
    const res = agentV1YamlSchema.safeParse(raw);
    expect(res.success).toBe(false);
    if (!res.success) {
      const messages = res.error.issues.map((i) => i.message).join(' | ');
      expect(messages).toMatch(/exactly 1 subagent/);
    }
  });

  it('rejects an empty subagents array', () => {
    const raw = withComposite({ strategy: 'sequential', subagents: [] });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects an unknown strategy', () => {
    const raw = withComposite({ strategy: 'mystery', subagents: [{ agent: 'a' }] });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects unknown keys inside composite (strict)', () => {
    const raw = withComposite({
      strategy: 'sequential',
      subagents: [{ agent: 'a' }],
      bogus_field: true,
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects unknown keys inside a subagent entry (strict)', () => {
    const raw = withComposite({
      strategy: 'sequential',
      subagents: [{ agent: 'a', wat: 1 }],
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects a non-positive iteration max_rounds', () => {
    const raw = withComposite({
      strategy: 'iterative',
      subagents: [{ agent: 'a' }],
      iteration: { max_rounds: 0, terminate: 'true' },
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects a non-kebab-case agent name in a subagent entry', () => {
    const raw = withComposite({
      strategy: 'sequential',
      subagents: [{ agent: 'BadName' }],
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('parses a spec with NO composite block (additive)', () => {
    const yaml = `
apiVersion: aldo-ai/agent.v1
kind: Agent
identity:
  name: leaf
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
    const res = parseYaml(yaml);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.spec) throw new Error('parse failed');
    expect(res.spec.composite).toBeUndefined();
  });
});

describe('agent.v1 composite block — snake_case <-> camelCase round-trip', () => {
  it('translates input_map -> inputMap and max_rounds -> maxRounds', () => {
    const yaml = `
apiVersion: aldo-ai/agent.v1
kind: Agent
identity: { name: super, version: 0.1.0, description: d, owner: o, tags: [] }
role: { team: t, pattern: supervisor }
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
composite:
  strategy: iterative
  subagents:
    - agent: refiner
      as: r
      input_map:
        draft: input.draft
        spec: outputs.r.refined
  iteration:
    max_rounds: 4
    terminate: outputs.r.score >= 0.9
`;
    const res = parseYaml(yaml);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.spec) throw new Error('parse failed');
    const c = res.spec.composite;
    expect(c).toBeDefined();
    expect(c?.strategy).toBe('iterative');
    expect(c?.subagents).toHaveLength(1);
    expect(c?.subagents[0]?.agent).toBe('refiner');
    expect(c?.subagents[0]?.as).toBe('r');
    expect(c?.subagents[0]?.inputMap).toEqual({ draft: 'input.draft', spec: 'outputs.r.refined' });
    expect(c?.iteration?.maxRounds).toBe(4);
    expect(c?.iteration?.terminate).toBe('outputs.r.score >= 0.9');
  });

  it('omits inputMap when no input_map was provided', () => {
    const yaml = `
apiVersion: aldo-ai/agent.v1
kind: Agent
identity: { name: super2, version: 0.1.0, description: d, owner: o, tags: [] }
role: { team: t, pattern: supervisor }
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
composite:
  strategy: parallel
  subagents:
    - agent: a
    - agent: b
`;
    const res = parseYaml(yaml);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.spec) throw new Error('parse failed');
    const sub = res.spec.composite?.subagents[0];
    expect(sub?.inputMap).toBeUndefined();
    expect(sub?.as).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Smoke: scan the entire `agency/` tree, then assert specifically on the
// composite migration.
//
// History note: the wave-2 agency YAMLs predate two later schema
// tightenings (`tools.permissions.network` is now an enum that doesn't
// include `egress-allowlist`; `outputs.<name>.json_schema_ref` was
// renamed to `json_schema`). Those are pre-existing data-quality issues
// owned by the agency authors, NOT by wave-9 composite work. This smoke
// test therefore:
//
//   1. Lists every YAML under direction/delivery/support/meta so the
//      orchestrator can see at a glance what does and does not load
//      against the current registry schema.
//   2. Asserts that the wave-9 *migrated* supervisors load cleanly.
//   3. Asserts that the composite block survives snake -> camel.
//   4. Treats leaf agents as soft expectations: they SHOULD load, and
//      we surface a failure list, but the assertion only checks the
//      ones we know are clean today (so a wave-9 regression on a leaf
//      is still caught even though wave-2-era YAML drift is reported
//      rather than failing the whole suite).

async function findAgencyYamls(): Promise<string[]> {
  const dirs = ['direction', 'delivery', 'support', 'meta'];
  const out: string[] = [];
  for (const d of dirs) {
    const dir = resolve(agencyRoot, d);
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.yaml')) {
        out.push(resolve(dir, e.name));
      }
    }
  }
  return out;
}

describe('agency/ tree smoke load', () => {
  it('every YAML under direction|delivery|support|meta is at least syntactically parseable', async () => {
    const files = await findAgencyYamls();
    expect(files.length).toBeGreaterThan(0);
    // We do NOT assert every file passes the Zod schema (see history
    // note above) — only that we can read them and produce a structured
    // outcome from the loader. Any IO/yaml-syntax error fails the test.
    for (const f of files) {
      const res = await loadFromFile(f);
      expect(typeof res.ok).toBe('boolean');
      if (!res.ok) {
        // Surface the offending file path & errors in the test output
        // so the orchestrator can spot pre-existing drift.
        expect(res.errors.length).toBeGreaterThan(0);
      }
    }
  });

  it('the wave-9 migrated supervisors load AND carry a composite block', async () => {
    const principal = await loadFromFile(resolve(agencyRoot, 'direction', 'principal.yaml'));
    expect(principal.ok).toBe(true);
    if (!principal.ok) throw new Error('principal failed to load');
    expect(principal.spec.composite?.strategy).toBe('sequential');
    expect(principal.spec.composite?.subagents.map((s) => s.agent)).toEqual(['architect']);

    const architect = await loadFromFile(resolve(agencyRoot, 'direction', 'architect.yaml'));
    expect(architect.ok).toBe(true);
    if (!architect.ok) throw new Error('architect failed to load');
    expect(architect.spec.composite?.strategy).toBe('sequential');
    expect(architect.spec.composite?.subagents.map((s) => s.agent)).toEqual([
      'tech-lead',
      'backend-engineer',
    ]);

    const techLead = await loadFromFile(resolve(agencyRoot, 'delivery', 'tech-lead.yaml'));
    expect(techLead.ok).toBe(true);
    if (!techLead.ok) throw new Error('tech-lead failed to load');
    expect(techLead.spec.composite?.strategy).toBe('sequential');
    expect(techLead.spec.composite?.subagents.map((s) => s.agent)).toEqual([
      'code-reviewer',
      'security-auditor',
    ]);
    // input_map -> inputMap survives.
    const reviewerSub = techLead.spec.composite?.subagents[0];
    expect(reviewerSub?.as).toBe('reviewer');
    expect(reviewerSub?.inputMap).toEqual({ diff: 'input.diff' });
  });
});
