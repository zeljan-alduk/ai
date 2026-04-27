import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../src/api/client.js';
import { AgentsTreeProvider } from '../src/views/agents-tree.js';
import { ModelsTreeProvider } from '../src/views/models-tree.js';
import { RunsTreeProvider } from '../src/views/runs-tree.js';

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listAgents: async () => [
      { name: 'reviewer', privacyTier: 'sensitive', description: 'PR reviewer' },
      { name: 'planner', privacyTier: 'standard' },
    ],
    listRuns: async () => [
      { id: 'run_abc1234567890', agentName: 'reviewer', status: 'succeeded' },
      { id: 'run_def0987654321', agentName: 'planner', status: 'failed' },
    ],
    listModels: async () => [
      { id: 'gpt-4o', capabilityClass: 'chat-large', privacyTier: 'standard' },
      { id: 'llama3-70b-local', capabilityClass: 'chat-large', privacyTier: 'sensitive' },
    ],
    ...overrides,
  } as unknown as ApiClient;
}

describe('AgentsTreeProvider', () => {
  it('returns one item per agent when logged in', async () => {
    const tree = new AgentsTreeProvider(() => fakeClient());
    const items = await tree.getChildren();
    expect(items).toHaveLength(2);
    expect(items[0]?.label).toBe('reviewer');
    expect(items[0]?.description).toBe('sensitive');
  });

  it('returns a placeholder when not logged in', async () => {
    const tree = new AgentsTreeProvider(() => null);
    const items = await tree.getChildren();
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toMatch(/Not logged in/);
  });

  it('surfaces api errors as a tree item', async () => {
    const tree = new AgentsTreeProvider(() =>
      fakeClient({
        listAgents: async () => {
          throw new Error('boom');
        },
      } as Partial<ApiClient>),
    );
    const items = await tree.getChildren();
    expect(items[0]?.label).toContain('boom');
  });
});

describe('RunsTreeProvider', () => {
  it('renders status in the label', async () => {
    const tree = new RunsTreeProvider(() => fakeClient());
    const items = await tree.getChildren();
    expect(items[0]?.label).toBe('reviewer · succeeded');
    expect(items[1]?.label).toBe('planner · failed');
  });
});

describe('ModelsTreeProvider', () => {
  it('shows capability + privacy tier', async () => {
    const tree = new ModelsTreeProvider(() => fakeClient());
    const items = await tree.getChildren();
    expect(items[0]?.description).toContain('chat-large');
    expect(items[0]?.description).toContain('standard');
    expect(items[1]?.description).toContain('sensitive');
  });
});
