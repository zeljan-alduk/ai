/**
 * Tests for `aldo models discover`.
 *
 * The discover() function is hoist-injected via the hooks parameter so
 * we never hit a real port. We exercise:
 *   - exit 1 + polite copy when nothing found
 *   - exit 0 + table when models are returned
 *   - --json output shape
 *   - --timeout flag passes through to discover()
 */

import type { DiscoveredModel } from '@aldo-ai/local-discovery';
import { describe, expect, it, vi } from 'vitest';
import { type ModelsDiscoverHooks, runModelsDiscover } from '../src/commands/models-discover.js';
import type { CliIO } from '../src/io.js';

function bufferedIO(): { io: CliIO; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s) => {
        out.push(s);
      },
      stderr: (s) => {
        err.push(s);
      },
      isTTY: false,
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

function mkModel(overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
  return {
    id: 'qwen2.5:7b',
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

describe('runModelsDiscover', () => {
  it('exits 1 with a polite message when nothing is found', async () => {
    const { io, out } = bufferedIO();
    const fakeDiscover: ModelsDiscoverHooks['discover'] = vi.fn(async () => []);
    const code = await runModelsDiscover({}, io, { discover: fakeDiscover });
    expect(code).toBe(1);
    expect(out()).toContain('no local LLM servers found on default ports');
    expect(out()).toContain('Ollama');
    expect(out()).toContain('vLLM');
  });

  it('exits 0 and prints a table when discovery finds models', async () => {
    const { io, out } = bufferedIO();
    const fakeDiscover: ModelsDiscoverHooks['discover'] = vi.fn(async () => [
      mkModel({ id: 'qwen2.5:7b', source: 'ollama' }),
      mkModel({
        id: 'llama-3.3-70b',
        provider: 'vllm',
        source: 'vllm',
        providerConfig: { baseUrl: 'http://localhost:8000/v1' },
      }),
    ]);
    const code = await runModelsDiscover({}, io, { discover: fakeDiscover });
    expect(code).toBe(0);
    const stdout = out();
    expect(stdout).toContain('id');
    expect(stdout).toContain('source');
    expect(stdout).toContain('capabilityClass');
    expect(stdout).toContain('locality');
    expect(stdout).toContain('baseUrl');
    expect(stdout).toContain('qwen2.5:7b');
    expect(stdout).toContain('llama-3.3-70b');
    expect(stdout).toContain('http://localhost:11434/v1');
    expect(stdout).toContain('http://localhost:8000/v1');
    expect(stdout).toContain('2 models discovered');
  });

  it('emits JSON when --json is set and exits 0', async () => {
    const { io, out } = bufferedIO();
    const fakeDiscover: ModelsDiscoverHooks['discover'] = vi.fn(async () => [
      mkModel({ id: 'qwen' }),
    ]);
    const code = await runModelsDiscover({ json: true }, io, {
      discover: fakeDiscover,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out()) as {
      ok: boolean;
      models: ReadonlyArray<{ id: string; source: string; baseUrl: string | null }>;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0]?.id).toBe('qwen');
    expect(parsed.models[0]?.source).toBe('ollama');
    expect(parsed.models[0]?.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('emits JSON failure when --json + nothing found', async () => {
    const { io, out } = bufferedIO();
    const fakeDiscover: ModelsDiscoverHooks['discover'] = vi.fn(async () => []);
    const code = await runModelsDiscover({ json: true }, io, {
      discover: fakeDiscover,
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(out()) as { ok: boolean; models: readonly unknown[] };
    expect(parsed.ok).toBe(false);
    expect(parsed.models).toEqual([]);
  });

  it('passes --timeout through to discover()', async () => {
    const { io } = bufferedIO();
    const fakeDiscover: ModelsDiscoverHooks['discover'] = vi.fn(async () => []);
    await runModelsDiscover({ timeoutMs: 250 }, io, { discover: fakeDiscover });
    expect(fakeDiscover).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 250 }));
  });

  it('uses the singular noun when exactly one model is found', async () => {
    const { io, out } = bufferedIO();
    const fakeDiscover: ModelsDiscoverHooks['discover'] = vi.fn(async () => [
      mkModel({ id: 'only-one' }),
    ]);
    const code = await runModelsDiscover({}, io, { discover: fakeDiscover });
    expect(code).toBe(0);
    expect(out()).toContain('1 model discovered');
  });
});
