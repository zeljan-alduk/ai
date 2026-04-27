/**
 * Tests for `aldo agents check <name>`.
 *
 * Two paths matter:
 *   - cloud-only registry + sensitive agent → exit code 2, FIX hint shown.
 *   - cloud + local-reasoning fallback     → exit code 0, local model picked.
 *
 * We also lock down the JSON shape so api-contract drift on the API
 * `/v1/agents/:name/check` envelope is impossible without updating these
 * tests in lockstep.
 */

import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAgentsCheck, setAgentsCheckHooks } from '../src/commands/agents-check.js';
import { loadConfig } from '../src/config.js';
import type { CliIO } from '../src/io.js';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CLOUD_ONLY_MODELS = fileURLToPath(
  new URL('./fixtures/models.cloud-only.yaml', import.meta.url),
);
const LOCAL_FALLBACK_MODELS = fileURLToPath(
  new URL('./fixtures/models.local-fallback.yaml', import.meta.url),
);

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

describe('aldo agents check', () => {
  beforeEach(() => {
    setAgentsCheckHooks(null);
  });
  afterEach(() => {
    setAgentsCheckHooks(null);
  });

  it('exits 2 with a privacy reason when only cloud models are registered', async () => {
    const { io, out } = bufferedIO();
    const code = await runAgentsCheck(
      'security-reviewer',
      {
        agentsDir: FIXTURES_DIR,
        modelsYamlPath: CLOUD_ONLY_MODELS,
      },
      io,
      {
        // Pretend the user has Ollama enabled so the test fixture catalog
        // doesn't get filtered down to nothing on locality grounds.
        loadConfig: () =>
          loadConfig({ env: { OLLAMA_BASE_URL: 'x', GROQ_API_KEY: 'k' }, dotenvFiles: [] }),
      },
    );
    expect(code).toBe(2);
    const text = out();
    expect(text).toContain('security-reviewer');
    expect(text).toContain('privacy=sensitive');
    expect(text).toMatch(/no eligible model/);
    expect(text).toMatch(/sensitive/);
    expect(text).toContain('FIX:');
  });

  it('exits 0 and selects the local fallback when cloud + local-reasoning are registered', async () => {
    const { io, out } = bufferedIO();
    const code = await runAgentsCheck(
      'security-reviewer',
      {
        agentsDir: FIXTURES_DIR,
        modelsYamlPath: LOCAL_FALLBACK_MODELS,
      },
      io,
      {
        loadConfig: () =>
          loadConfig({ env: { OLLAMA_BASE_URL: 'x', GROQ_API_KEY: 'k' }, dotenvFiles: [] }),
      },
    );
    expect(code).toBe(0);
    const text = out();
    expect(text).toContain('security-reviewer');
    expect(text).toContain('would route to mlx-qwen-fixture');
    expect(text).toContain('local');
  });

  it('--json emits a structured envelope for the success path', async () => {
    const { io, out } = bufferedIO();
    const code = await runAgentsCheck(
      'security-reviewer',
      {
        agentsDir: FIXTURES_DIR,
        modelsYamlPath: LOCAL_FALLBACK_MODELS,
        json: true,
      },
      io,
      {
        loadConfig: () =>
          loadConfig({ env: { OLLAMA_BASE_URL: 'x', GROQ_API_KEY: 'k' }, dotenvFiles: [] }),
      },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out()) as {
      ok: boolean;
      agent: { name: string; privacyTier: string; primaryClass: string };
      chosen: { id: string; locality: string; classUsed: string } | null;
      trace: ReadonlyArray<{ capabilityClass: string; chosen: string | null }>;
      reason: string | null;
      fix: string | null;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.agent.name).toBe('security-reviewer');
    expect(parsed.agent.privacyTier).toBe('sensitive');
    expect(parsed.chosen).not.toBeNull();
    expect(parsed.chosen?.id).toBe('mlx-qwen-fixture');
    expect(parsed.chosen?.classUsed).toBe('local-reasoning');
    expect(parsed.trace.length).toBeGreaterThanOrEqual(2);
    expect(parsed.fix).toBeNull();
  });

  it('--json emits a structured envelope for the failure path with FIX hint', async () => {
    const { io, out } = bufferedIO();
    const code = await runAgentsCheck(
      'security-reviewer',
      {
        agentsDir: FIXTURES_DIR,
        modelsYamlPath: CLOUD_ONLY_MODELS,
        json: true,
      },
      io,
      {
        loadConfig: () =>
          loadConfig({ env: { OLLAMA_BASE_URL: 'x', GROQ_API_KEY: 'k' }, dotenvFiles: [] }),
      },
    );
    expect(code).toBe(2);
    const parsed = JSON.parse(out()) as {
      ok: boolean;
      chosen: unknown | null;
      reason: string | null;
      fix: string | null;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.chosen).toBeNull();
    // The last class tried is `local-reasoning` (the fallback) — its
    // failure mode is "no model registered". The primary class' failure
    // ("no model allows privacy=sensitive") shows up in the trace, not
    // the aggregate `reason`.
    expect(parsed.reason).toMatch(/local-reasoning/);
    expect(parsed.fix).not.toBeNull();
    expect(parsed.fix ?? '').toMatch(/sensitive|local/);
  });
});
