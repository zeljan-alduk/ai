/**
 * MISSING_PIECES §9 / Phase A — leaf-loop `iteration` block validation.
 *
 * Distinct from the wave-9 `composite.iteration` (multi-agent supervisor
 * pattern). This block describes a SINGLE-agent loop and is enforced by
 * the engine's `runAgent` branch in Phase A as a typed sentinel; Phase B
 * replaces the sentinel with the actual loop body.
 *
 * Tests cover Zod validation, the snake_case → camelCase loader
 * translation, and mutual exclusivity with `composite`.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFromFile, parseYaml } from '../src/loader.js';
import { agentV1YamlSchema } from '../src/schema.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const agencyRoot = resolve(repoRoot, 'agency');

/** Build a minimal raw agent.v1 doc and merge an `iteration` block onto it. */
function withIteration(iteration: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: 'aldo-ai/agent.v1',
    kind: 'Agent',
    identity: { name: 'looper', version: '0.1.0', description: 'd', owner: 'o', tags: [] },
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
    tools: { mcp: [], native: [], permissions: { network: 'none', filesystem: 'none' } },
    memory: { read: [], write: [], retention: {} },
    spawn: { allowed: [] },
    escalation: [],
    subscriptions: [],
    eval_gate: { required_suites: [], must_pass_before_promote: false },
    iteration,
    ...extra,
  };
}

describe('agent.v1 iteration block — Zod validation', () => {
  it('accepts an iteration block with all three termination kinds', () => {
    const raw = withIteration({
      max_cycles: 30,
      context_window: 128000,
      summary_strategy: 'rolling-window',
      termination_conditions: [
        { kind: 'text-includes', text: '<task-complete>' },
        {
          kind: 'tool-result',
          tool: 'aldo-shell.shell.exec',
          match: { exit_code: 0 },
        },
        { kind: 'budget-exhausted' },
      ],
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(true);
  });

  it('accepts an iteration block with an empty termination_conditions array (max_cycles is the floor)', () => {
    const raw = withIteration({
      max_cycles: 5,
      context_window: 32000,
      summary_strategy: 'periodic-summary',
      termination_conditions: [],
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(true);
  });

  it('defaults termination_conditions to [] when the key is omitted', () => {
    const raw = withIteration({
      max_cycles: 5,
      context_window: 32000,
      summary_strategy: 'rolling-window',
    });
    const res = agentV1YamlSchema.safeParse(raw);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.iteration?.termination_conditions).toEqual([]);
    }
  });

  it('rejects max_cycles <= 0', () => {
    const raw = withIteration({
      max_cycles: 0,
      context_window: 1000,
      summary_strategy: 'rolling-window',
      termination_conditions: [],
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects an unknown summary_strategy', () => {
    const raw = withIteration({
      max_cycles: 5,
      context_window: 1000,
      summary_strategy: 'wishful-thinking',
      termination_conditions: [],
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects an unknown termination_conditions kind', () => {
    const raw = withIteration({
      max_cycles: 5,
      context_window: 1000,
      summary_strategy: 'rolling-window',
      termination_conditions: [{ kind: 'never', text: 'x' }],
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects a tool-result match with neither exit_code nor contains', () => {
    const raw = withIteration({
      max_cycles: 5,
      context_window: 1000,
      summary_strategy: 'rolling-window',
      termination_conditions: [{ kind: 'tool-result', tool: 'shell.exec', match: {} }],
    });
    const res = agentV1YamlSchema.safeParse(raw);
    expect(res.success).toBe(false);
    if (!res.success) {
      const messages = res.error.issues.map((i) => i.message).join(' | ');
      expect(messages).toMatch(/exit_code|contains/);
    }
  });

  it('rejects unknown keys inside iteration (strict)', () => {
    const raw = withIteration({
      max_cycles: 5,
      context_window: 1000,
      summary_strategy: 'rolling-window',
      termination_conditions: [],
      bogus: true,
    });
    expect(agentV1YamlSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects iteration declared alongside composite (mutually exclusive)', () => {
    const raw = withIteration(
      {
        max_cycles: 3,
        context_window: 8000,
        summary_strategy: 'rolling-window',
        termination_conditions: [],
      },
      {
        composite: {
          strategy: 'sequential',
          subagents: [{ agent: 'reviewer' }],
        },
      },
    );
    const res = agentV1YamlSchema.safeParse(raw);
    expect(res.success).toBe(false);
    if (!res.success) {
      const messages = res.error.issues.map((i) => i.message).join(' | ');
      expect(messages).toMatch(/leaf-loop|composite\.strategy/);
    }
  });

  it('parses a spec with NO iteration block (additive — pre-§9 specs unaffected)', () => {
    const yaml = `
apiVersion: aldo-ai/agent.v1
kind: Agent
identity: { name: leaf, version: 0.1.0, description: d, owner: o, tags: [] }
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
    expect(res.spec.iteration).toBeUndefined();
  });
});

describe('agent.v1 iteration block — snake_case <-> camelCase round-trip', () => {
  it('translates max_cycles/context_window/summary_strategy + every termination kind', () => {
    const yaml = `
apiVersion: aldo-ai/agent.v1
kind: Agent
identity: { name: looper, version: 0.1.0, description: d, owner: o, tags: [] }
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
iteration:
  max_cycles: 30
  context_window: 128000
  summary_strategy: rolling-window
  termination_conditions:
    - kind: text-includes
      text: <task-complete>
    - kind: tool-result
      tool: aldo-shell.shell.exec
      match:
        exit_code: 0
        contains: typecheck OK
    - kind: budget-exhausted
`;
    const res = parseYaml(yaml);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.spec) throw new Error('parse failed');
    const it = res.spec.iteration;
    expect(it).toBeDefined();
    expect(it?.maxCycles).toBe(30);
    expect(it?.contextWindow).toBe(128000);
    expect(it?.summaryStrategy).toBe('rolling-window');
    expect(it?.terminationConditions).toHaveLength(3);
    const [first, second, third] = it?.terminationConditions ?? [];
    expect(first).toEqual({ kind: 'text-includes', text: '<task-complete>' });
    expect(second).toEqual({
      kind: 'tool-result',
      tool: 'aldo-shell.shell.exec',
      match: { exitCode: 0, contains: 'typecheck OK' },
    });
    expect(third).toEqual({ kind: 'budget-exhausted' });
  });

  it('loads the §9 reference agent (agency/development/local-coder-iterative.yaml)', async () => {
    const res = await loadFromFile(
      resolve(agencyRoot, 'development', 'local-coder-iterative.yaml'),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('load failed');
    const it = res.spec.iteration;
    expect(it).toBeDefined();
    expect(it?.maxCycles).toBe(30);
    expect(it?.contextWindow).toBe(128000);
    expect(it?.summaryStrategy).toBe('rolling-window');
    // Three termination conditions: tool-result, text-includes, budget-exhausted.
    const kinds = it?.terminationConditions.map((c) => c.kind);
    expect(kinds).toEqual(['tool-result', 'text-includes', 'budget-exhausted']);
    // No composite block (mutually exclusive).
    expect(res.spec.composite).toBeUndefined();
  });

  it('preserves termination_conditions order (the loop fires the first match)', () => {
    const yaml = `
apiVersion: aldo-ai/agent.v1
kind: Agent
identity: { name: order, version: 0.1.0, description: d, owner: o, tags: [] }
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
iteration:
  max_cycles: 4
  context_window: 8000
  summary_strategy: periodic-summary
  termination_conditions:
    - kind: budget-exhausted
    - kind: text-includes
      text: DONE
`;
    const res = parseYaml(yaml);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.spec) throw new Error('parse failed');
    const kinds = res.spec.iteration?.terminationConditions.map((c) => c.kind);
    expect(kinds).toEqual(['budget-exhausted', 'text-includes']);
  });
});
