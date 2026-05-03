/**
 * Local-LLM integration spec — Ollama + LM Studio.
 *
 * Two phases of coverage:
 *
 *   PHASE A — gateway adapter against the developer's own local servers.
 *     Calls the OpenAI-compat /v1/chat/completions endpoint on Ollama
 *     and LM Studio directly. Proves that ALDO's gateway adapter shape
 *     (the openai-compat one in @aldo-ai/gateway/src/providers) reaches
 *     a real local model and gets a non-empty response within timeout.
 *
 *   PHASE B — ALDO platform routing simulator end-to-end.
 *     Signs up against the configured ALDO API, seeds the default
 *     agency, then POSTs a run for `local-summarizer` (a strict-local
 *     agent shipped in agency/support/). The platform's wave-8 router
 *     simulator must accept the route (no `privacy_tier_unroutable`
 *     422) and the resulting run row must surface in /v1/runs.
 *
 * Why only routing in Phase B (not full execution)?
 *   The actual engine spawn from POST /v1/runs is a roadmap item — the
 *   route comment at apps/api/src/routes/runs.ts:81 documents this.
 *   Today the API persists a `queued` row and stops; the engine that
 *   would call the gateway and update the row is wired in a later wave.
 *   Phase A covers the gateway-adapter half so a passing suite proves
 *   that *both halves* work — they just aren't yet stitched together.
 *
 * Skip conditions (silent — log a reason, don't fail):
 *   - OLLAMA_BASE_URL unreachable → skip Phase A Ollama test.
 *   - LM_STUDIO_BASE_URL unreachable → skip Phase A LM Studio test.
 *   - E2E_ALLOW_WRITES !== "true" → skip Phase B (don't create users).
 */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const LMSTUDIO_URL = process.env.LM_STUDIO_BASE_URL ?? 'http://localhost:1234';
const ALDO_API_BASE = process.env.E2E_ALDO_API_BASE ?? 'http://localhost:3001';
const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';
const PROBE_TIMEOUT_MS = 4_000;
const COMPLETION_TIMEOUT_MS = 60_000;

interface OpenAIModelList {
  data?: ReadonlyArray<{ id?: string }>;
}

interface ChatBody {
  choices?: ReadonlyArray<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
}

async function isReachable(baseUrl: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${baseUrl}/v1/models`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function listChatModels(baseUrl: string): Promise<readonly string[]> {
  const res = await fetch(`${baseUrl}/v1/models`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${baseUrl}/v1/models`);
  const body = (await res.json()) as OpenAIModelList;
  const all = (body.data ?? [])
    .map((m) => m.id ?? '')
    .filter((id) => id.length > 0)
    .filter((id) => !/embed/i.test(id));
  // Prefer instruction-tuned chat models over code-completion / base models
  // for the chat-shape test. `codellama` and `code` ids tend to be FIM /
  // base, not RLHF'd for chat — they can return empty completions on
  // single-turn instructions. Sort them to the back so the test picks an
  // instruct model first when one is available.
  return [...all].sort((a, b) => {
    const aCode = /code(llama|gen)|fim/i.test(a) ? 1 : 0;
    const bCode = /code(llama|gen)|fim/i.test(b) ? 1 : 0;
    return aCode - bCode;
  });
}

async function chatOnce(
  baseUrl: string,
  model: string,
  text: string,
): Promise<{ reply: string; tokens: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), COMPLETION_TIMEOUT_MS);
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Reply with one short sentence. No preamble.' },
        { role: 'user', content: text },
      ],
      stream: false,
    }),
    signal: ctrl.signal,
  });
  clearTimeout(t);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from ${baseUrl}/v1/chat/completions\n${body}`);
  }
  const body = (await res.json()) as ChatBody;
  return {
    reply: body.choices?.[0]?.message?.content ?? '',
    tokens: body.usage?.total_tokens ?? 0,
  };
}

// ─────────────────────────────────────────────── PHASE A — Gateway adapters

test.describe('local LLMs — gateway adapter shape', () => {
  test('Ollama: openai-compat /v1 surface answers a chat completion', async () => {
    const reachable = await isReachable(OLLAMA_URL);
    test.skip(!reachable, `Ollama not reachable at ${OLLAMA_URL} — start it with \`ollama serve\``);

    const models = await listChatModels(OLLAMA_URL);
    expect(models.length, 'Ollama must report at least one chat model').toBeGreaterThan(0);

    const chosen = models[0] as string;
    const { reply, tokens } = await chatOnce(OLLAMA_URL, chosen, 'Reply with one short sentence: what is 2 + 2?');
    expect(reply.length, `[${chosen}] reply must not be empty`).toBeGreaterThan(0);
    expect(tokens, 'usage must be populated').toBeGreaterThan(0);
  });

  test('LM Studio: openai-compat /v1 surface answers a chat completion', async () => {
    const reachable = await isReachable(LMSTUDIO_URL);
    test.skip(
      !reachable,
      `LM Studio not reachable at ${LMSTUDIO_URL} — start with \`lms server start\``,
    );

    const models = await listChatModels(LMSTUDIO_URL);
    if (models.length === 0) {
      test.skip(true, 'LM Studio reachable but no chat model loaded — `lms get qwen/qwen3-4b -y && lms load qwen/qwen3-4b -y`');
      return;
    }
    const chosen = models[0] as string;
    const { reply } = await chatOnce(LMSTUDIO_URL, chosen, 'Reply with one short sentence: what is 2 + 2?');
    expect(reply.length, `[${chosen}] reply must not be empty`).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────── PHASE B — Platform routing

test.describe('local LLMs — ALDO platform routing', () => {
  test('platform refuses to run a sensitive agent when no eligible model exists', async ({
    request,
  }) => {
    test.skip(
      !ALLOW_WRITES,
      'E2E_ALLOW_WRITES is not "true" — refusing to create a real user in the target environment',
    );

    const suffix = randomUUID().slice(0, 8);
    const email = `e2e+local-llm-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Q9!`;

    // 1. Signup yields a JWT.
    const signup = await request.post(`${ALDO_API_BASE}/v1/auth/signup`, {
      data: {
        email,
        password,
        tenantName: `E2E Local LLM ${suffix}`,
      },
    });
    expect(signup.status(), 'signup must succeed').toBe(201);
    const token = (await signup.json()).token as string;
    const auth = { Authorization: `Bearer ${token}` };

    // 2. Seed the default agency so we can target a known agent.
    const seed = await request.post(`${ALDO_API_BASE}/v1/tenants/me/seed-default`, {
      headers: auth,
    });
    expect(seed.status(), 'seed must succeed').toBe(200);

    // 3. backend-engineer is `privacy_tier: sensitive` AND requires
    //    capabilities that only frontier-class models claim. Without
    //    cloud keys configured (and with only local servers active),
    //    the wave-8 router simulator MUST refuse the route.
    const refused = await request.post(`${ALDO_API_BASE}/v1/runs`, {
      headers: { ...auth, 'content-type': 'application/json' },
      data: {
        agentName: 'backend-engineer',
        inputs: { task: 'noop' },
      },
    });
    expect(refused.status(), 'sensitive + heavy capability requirements MUST 422').toBe(422);
    const err = await refused.json();
    expect(err.error?.code, 'unrouteable error code').toBe('privacy_tier_unroutable');
    expect(err.error?.details?.privacyTier, 'echoes the privacy tier').toBe('sensitive');
  });

  test('platform accepts a sensitive agent that fits a discovered local model', async ({
    request,
  }) => {
    test.skip(
      !ALLOW_WRITES,
      'E2E_ALLOW_WRITES is not "true" — refusing to create a real user in the target environment',
    );
    const ollamaUp = await isReachable(OLLAMA_URL);
    test.skip(!ollamaUp, `Ollama not reachable at ${OLLAMA_URL} — start it with \`ollama serve\``);

    const suffix = randomUUID().slice(0, 8);
    const email = `e2e+local-llm-ok-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Q9!`;

    const signup = await request.post(`${ALDO_API_BASE}/v1/auth/signup`, {
      data: {
        email,
        password,
        tenantName: `E2E Local LLM OK ${suffix}`,
      },
    });
    expect(signup.status()).toBe(201);
    const token = (await signup.json()).token as string;
    const auth = { Authorization: `Bearer ${token}` };

    const seed = await request.post(`${ALDO_API_BASE}/v1/tenants/me/seed-default`, {
      headers: auth,
    });
    expect(seed.status()).toBe(200);

    // local-summarizer has privacy_tier: sensitive + requires only
    // [streaming] which every Ollama model claims. The router must
    // accept this route and the run row must persist as `queued`.
    const accepted = await request.post(`${ALDO_API_BASE}/v1/runs`, {
      headers: { ...auth, 'content-type': 'application/json' },
      data: {
        agentName: 'local-summarizer',
        inputs: { task: 'A short text to summarise.' },
      },
    });
    expect(accepted.status(), 'compatible local route MUST be accepted').toBe(202);
    const created = await accepted.json();
    expect(created.run?.status, 'run is queued (engine spawn is roadmap)').toBe('queued');
    expect(created.run?.agentName).toBe('local-summarizer');

    // Cross-check: the run is visible on /v1/runs filtered to the
    // tenant's default project.
    const list = await request.get(`${ALDO_API_BASE}/v1/runs`, { headers: auth });
    expect(list.status()).toBe(200);
    const runs = (await list.json()).runs as Array<{ id: string }>;
    expect(
      runs.some((r) => r.id === created.run.id),
      'created run must surface on /v1/runs',
    ).toBe(true);
  });
});
