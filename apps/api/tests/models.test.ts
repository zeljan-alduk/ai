import { ListModelsResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

describe('GET /v1/models', () => {
  let envNoKeys: TestEnv;
  let envWithKeys: TestEnv;

  beforeAll(async () => {
    envNoKeys = await setupTestEnv({
      // Explicitly clear common keys so the harness doesn't pick up a
      // dev-shell's real env. The base setup also doesn't read process.env
      // directly here — `Env` is what flows in.
    });
    envWithKeys = await setupTestEnv({
      ANTHROPIC_API_KEY: 'sk-test',
      GROQ_API_KEY: 'gsk_test',
      VLLM_BASE_URL: 'http://vllm.test:8000/v1',
    });
  });

  afterAll(async () => {
    await envNoKeys.teardown();
    await envWithKeys.teardown();
  });

  it('returns rows from the gateway fixture', async () => {
    const res = await envNoKeys.app.request('/v1/models');
    expect(res.status).toBe(200);
    const body = ListModelsResponse.parse(await res.json());
    expect(body.models.length).toBeGreaterThan(0);
    // Provider strings stay opaque; just check they round-trip through the schema.
    expect(body.models.every((m) => typeof m.provider === 'string' && m.provider.length > 0)).toBe(
      true,
    );
  });

  it('local Ollama models default to available (default base URL is configured)', async () => {
    const res = await envNoKeys.app.request('/v1/models');
    const body = ListModelsResponse.parse(await res.json());
    const ollama = body.models.filter((m) => m.provider === 'ollama');
    expect(ollama.length).toBeGreaterThan(0);
    expect(ollama.every((m) => m.available)).toBe(true);
  });

  it('cloud models without their key are unavailable', async () => {
    const res = await envNoKeys.app.request('/v1/models');
    const body = ListModelsResponse.parse(await res.json());
    const anthropic = body.models.filter((m) => m.provider === 'anthropic');
    expect(anthropic.length).toBeGreaterThan(0);
    expect(anthropic.every((m) => m.available === false)).toBe(true);
  });

  it('the available flag flips when provider env vars are set', async () => {
    const res = await envWithKeys.app.request('/v1/models');
    const body = ListModelsResponse.parse(await res.json());
    const anthropic = body.models.filter((m) => m.provider === 'anthropic');
    expect(anthropic.length).toBeGreaterThan(0);
    expect(anthropic.every((m) => m.available)).toBe(true);

    const groq = body.models.filter((m) => m.provider === 'groq');
    expect(groq.length).toBeGreaterThan(0);
    expect(groq.every((m) => m.available)).toBe(true);

    const vllm = body.models.filter((m) => m.provider === 'vllm');
    expect(vllm.length).toBeGreaterThan(0);
    expect(vllm.every((m) => m.available)).toBe(true);

    // Other clouds (e.g. openai) still unavailable.
    const openai = body.models.filter((m) => m.provider === 'openai');
    expect(openai.every((m) => m.available === false)).toBe(true);
  });

  it('local-LLM discovery is disabled in the harness (ALDO_LOCAL_DISCOVERY=none)', async () => {
    // Sanity: the harness sets ALDO_LOCAL_DISCOVERY=none so /v1/models
    // doesn't burn its budget on closed localhost ports during tests.
    // The catalog still lists every YAML row.
    const res = await envNoKeys.app.request('/v1/models');
    const body = ListModelsResponse.parse(await res.json());
    expect(body.models.length).toBeGreaterThan(0);
    // Discovery would have stamped these provider tags; with discovery
    // disabled, only YAML-seeded rows appear. The fixture has no
    // `lmstudio` or `llamacpp` provider, so they must be absent.
    expect(body.models.some((m) => m.provider === 'lmstudio')).toBe(false);
    expect(body.models.some((m) => m.provider === 'llamacpp')).toBe(false);
  });
});
