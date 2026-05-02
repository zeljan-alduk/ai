/**
 * Unit tests for `forkGalleryTemplate`.
 *
 * Covers the helper in isolation against an in-memory
 * `RegisteredAgentStore`, so the apps/api route test can focus on
 * wire-level concerns (auth, error envelope, audit log) without
 * re-asserting the registry-level invariants.
 *
 * The fixture tree mirrors the production `agency/<team>/<id>.yaml`
 * layout:
 *
 *   tests/fixtures/forkable-agency/
 *     delivery/
 *       widget-engineer.yaml
 *     support/
 *       widget-reviewer.yaml
 *
 * LLM-agnostic: fixtures declare capability + privacy_tier; no
 * provider names appear.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TemplateInvalidError, TemplateNotFoundError, forkGalleryTemplate } from '../src/seed.js';
import { InMemoryRegisteredAgentStore } from '../src/stores/in-memory.js';

let dir: string;

const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const projectA = 'project-aaaa';

const widgetEngineerYaml = `apiVersion: aldo-ai/agent.v1
kind: Agent
identity:
  name: widget-engineer
  version: 1.2.3
  description: Forkable test fixture.
  owner: delivery@fork-test
  tags: [fixture]
role:
  team: delivery
  pattern: worker
model_policy:
  capability_requirements: [reasoning]
  privacy_tier: internal
  primary:
    capability_class: reasoning-medium
  fallbacks: []
  budget:
    usd_per_run: 0.5
  decoding:
    mode: free
prompt:
  system_file: prompts/sample.md
tools:
  mcp: []
  native: []
  permissions:
    network: none
    filesystem: none
memory:
  read: []
  write: []
  retention: {}
spawn:
  allowed: []
escalation: []
subscriptions: []
eval_gate:
  required_suites: []
  must_pass_before_promote: false
`;

// Deliberately broken — flips a required string into a number so the
// Zod schema rejects it. We want the helper to surface a typed
// `TemplateInvalidError` rather than panic.
const invalidYaml = `apiVersion: aldo-ai/agent.v1
kind: Agent
identity:
  name: 12345
  version: 0.1.0
  description: invalid
  owner: oops
  tags: []
role:
  team: delivery
  pattern: worker
model_policy:
  capability_requirements: []
  privacy_tier: internal
  primary:
    capability_class: reasoning-medium
  fallbacks: []
  budget:
    usd_per_run: 0.1
  decoding:
    mode: free
prompt:
  system_file: prompts/sample.md
tools:
  mcp: []
  native: []
  permissions:
    network: none
    filesystem: none
memory: { read: [], write: [], retention: {} }
spawn: { allowed: [] }
escalation: []
subscriptions: []
eval_gate: { required_suites: [], must_pass_before_promote: false }
`;

beforeAll(async () => {
  dir = join(tmpdir(), `fork-gallery-test-${Date.now()}`);
  await mkdir(join(dir, 'delivery'), { recursive: true });
  await mkdir(join(dir, 'support'), { recursive: true });
  await writeFile(join(dir, 'delivery', 'widget-engineer.yaml'), widgetEngineerYaml);
  await writeFile(join(dir, 'support', 'broken-spec.yaml'), invalidYaml);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('forkGalleryTemplate', () => {
  it('forks a template into a tenant + project under the template name', async () => {
    const store = new InMemoryRegisteredAgentStore();
    const out = await forkGalleryTemplate(store, {
      directory: dir,
      templateId: 'widget-engineer',
      tenantId: tenantA,
      projectId: projectA,
    });
    expect(out.agentName).toBe('widget-engineer');
    expect(out.version).toBe('1.2.3');
    expect(out.agent.tenantId).toBe(tenantA);
    expect(out.agent.projectId).toBe(projectA);
    // The resolved spec must reflect the (unchanged) template name.
    expect(out.agent.spec.identity.name).toBe('widget-engineer');
  });

  it('rotates the name to `-2`, `-3`, … on slug collisions', async () => {
    const store = new InMemoryRegisteredAgentStore();
    const opts = {
      directory: dir,
      templateId: 'widget-engineer',
      tenantId: tenantA,
      projectId: projectA,
    } as const;
    const first = await forkGalleryTemplate(store, opts);
    const second = await forkGalleryTemplate(store, opts);
    const third = await forkGalleryTemplate(store, opts);
    expect(first.agentName).toBe('widget-engineer');
    expect(second.agentName).toBe('widget-engineer-2');
    expect(third.agentName).toBe('widget-engineer-3');
    // Each persisted spec carries its own (rewritten) identity.name —
    // a downstream re-validation never sees a row whose YAML name
    // disagrees with the registry key.
    expect(second.agent.spec.identity.name).toBe('widget-engineer-2');
    expect(third.agent.spec.identity.name).toBe('widget-engineer-3');
    // The persisted YAML must also carry the rewritten name.
    expect(third.agent.specYaml).toContain('name: widget-engineer-3');
    expect(third.agent.specYaml).not.toContain('name: widget-engineer\n');
  });

  it('respects an explicit name override and does NOT rotate', async () => {
    const store = new InMemoryRegisteredAgentStore();
    // Pre-seed a row that would normally trigger collision rotation.
    await forkGalleryTemplate(store, {
      directory: dir,
      templateId: 'widget-engineer',
      tenantId: tenantA,
      projectId: projectA,
    });
    const out = await forkGalleryTemplate(store, {
      directory: dir,
      templateId: 'widget-engineer',
      tenantId: tenantA,
      projectId: projectA,
      nameOverride: 'my-named-fork',
    });
    expect(out.agentName).toBe('my-named-fork');
    expect(out.agent.spec.identity.name).toBe('my-named-fork');
  });

  it('isolates collision counters per tenant', async () => {
    const store = new InMemoryRegisteredAgentStore();
    const aOut = await forkGalleryTemplate(store, {
      directory: dir,
      templateId: 'widget-engineer',
      tenantId: tenantA,
      projectId: projectA,
    });
    // Tenant B gets the un-suffixed name even though tenant A already
    // consumed it — `register` is tenant-scoped.
    const bOut = await forkGalleryTemplate(store, {
      directory: dir,
      templateId: 'widget-engineer',
      tenantId: tenantB,
      projectId: projectA,
    });
    expect(aOut.agentName).toBe('widget-engineer');
    expect(bOut.agentName).toBe('widget-engineer');
  });

  it('throws TemplateNotFoundError for an unknown templateId', async () => {
    const store = new InMemoryRegisteredAgentStore();
    await expect(
      forkGalleryTemplate(store, {
        directory: dir,
        templateId: 'no-such-template',
        tenantId: tenantA,
        projectId: projectA,
      }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it('throws TemplateInvalidError when the YAML fails the schema', async () => {
    const store = new InMemoryRegisteredAgentStore();
    await expect(
      forkGalleryTemplate(store, {
        directory: dir,
        templateId: 'broken-spec',
        tenantId: tenantA,
        projectId: projectA,
      }),
    ).rejects.toBeInstanceOf(TemplateInvalidError);
  });
});
