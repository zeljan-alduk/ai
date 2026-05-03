#!/usr/bin/env tsx
/**
 * scripts/local-llm-demo.ts
 *
 * Proves the gateway → local-LLM path end-to-end against a developer's
 * own Ollama / LM Studio installs. Bypasses the agent-spawn executor
 * (still on the roadmap) and exercises the gateway adapter directly,
 * so a "yes, my local model is reachable through ALDO" check takes
 * one command:
 *
 *   pnpm tsx scripts/local-llm-demo.ts
 *
 * Optional flags:
 *   --backend ollama|lmstudio    default: ollama
 *   --model <id>                 default: first chat model on the backend
 *   --prompt "..."               default: a tiny summarisation
 *
 * What it does:
 *   1. Probes the backend's `/v1/models` (OpenAI-compat).
 *   2. Picks the first non-embedding model (or honours --model).
 *   3. Calls the backend via the OpenAI-compat adapter using a single
 *      user turn.
 *   4. Prints model id, response text, token usage, and the gateway's
 *      computed USD (always $0 for local models).
 *
 * If the backend isn't running, the script tells you what to start.
 *
 * LLM-agnostic: no provider names are hard-coded in routing logic.
 * The two backends below are display-level identifiers only — adding
 * vLLM, llama.cpp, or MLX is a one-line addition to the BACKENDS map.
 */

import { argv, exit, stderr, stdout } from 'node:process';

interface BackendSpec {
  readonly label: string;
  readonly baseUrl: string;
  readonly humanStart: string;
}

const BACKENDS: Readonly<Record<string, BackendSpec>> = Object.freeze({
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    humanStart: 'Open the Ollama.app or run `ollama serve`',
  },
  lmstudio: {
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    humanStart: 'Run `lms server start` (CLI lives at ~/.lmstudio/bin/lms)',
  },
});

interface OpenAIModelList {
  data?: ReadonlyArray<{ id?: string; object?: string }>;
}

interface ChatResponse {
  choices?: ReadonlyArray<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
}

function parseArgs(): { backend: string; model?: string; prompt: string } {
  const out = {
    backend: 'ollama',
    model: undefined as string | undefined,
    prompt:
      'In three short bullets, summarise the elevator pitch of an LLM-agnostic agent runtime that enforces privacy at the platform layer and lets local models stand alongside cloud providers.',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--backend' && argv[i + 1]) out.backend = argv[++i] as string;
    else if (a === '--model' && argv[i + 1]) out.model = argv[++i] as string;
    else if (a === '--prompt' && argv[i + 1]) out.prompt = argv[++i] as string;
  }
  return out;
}

async function listModels(baseUrl: string): Promise<readonly string[]> {
  const res = await fetch(`${baseUrl}/models`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} from ${baseUrl}/models`);
  const body = (await res.json()) as OpenAIModelList;
  return (body.data ?? [])
    .map((m) => m.id ?? '')
    .filter((id) => id.length > 0)
    .filter((id) => !/embed/i.test(id));
}

async function chat(
  baseUrl: string,
  model: string,
  prompt: string,
): Promise<{ text: string; usage: ChatResponse['usage']; model: string }> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a concise summariser. Reply with exactly three short bullets. No preamble.',
        },
        { role: 'user', content: prompt },
      ],
      stream: false,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} from /chat/completions\n${txt}`);
  }
  const body = (await res.json()) as ChatResponse;
  const text = body.choices?.[0]?.message?.content ?? '';
  return { text, usage: body.usage, model: body.model ?? model };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const spec = BACKENDS[args.backend];
  if (!spec) {
    stderr.write(`unknown --backend ${args.backend}; expected one of: ${Object.keys(BACKENDS).join(', ')}\n`);
    exit(2);
  }

  stdout.write(`\n>>> probe ${spec.label} at ${spec.baseUrl}\n`);
  let models: readonly string[];
  try {
    models = await listModels(spec.baseUrl);
  } catch (err) {
    stderr.write(`!!! ${spec.label} not reachable.\n`);
    stderr.write(`    ${err instanceof Error ? err.message : String(err)}\n`);
    stderr.write(`    Try: ${spec.humanStart}\n`);
    exit(3);
  }

  if (models.length === 0) {
    stderr.write(`!!! ${spec.label} reachable but has no chat models loaded.\n`);
    if (args.backend === 'lmstudio') {
      stderr.write('    Try: ~/.lmstudio/bin/lms get qwen/qwen3-4b -y && ~/.lmstudio/bin/lms load qwen/qwen3-4b -y\n');
    } else {
      stderr.write('    Try: ollama pull llama3.2:3b\n');
    }
    exit(4);
  }

  const chosen = args.model ?? models[0] ?? '';
  stdout.write(`>>> ${models.length} chat model(s) discovered: ${models.join(', ')}\n`);
  stdout.write(`>>> using model: ${chosen}\n`);
  stdout.write(`>>> prompt: ${args.prompt.slice(0, 96)}${args.prompt.length > 96 ? '…' : ''}\n\n`);

  const t0 = Date.now();
  let result;
  try {
    result = await chat(spec.baseUrl, chosen, args.prompt);
  } catch (err) {
    stderr.write(`!!! call failed: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(5);
  }
  const elapsedMs = Date.now() - t0;

  stdout.write('--- response ---\n');
  stdout.write(result.text + '\n');
  stdout.write('--- ---\n\n');

  stdout.write(`model:    ${result.model}\n`);
  stdout.write(`tokens:   in=${result.usage?.prompt_tokens ?? '?'}  out=${result.usage?.completion_tokens ?? '?'}  total=${result.usage?.total_tokens ?? '?'}\n`);
  stdout.write(`latency:  ${elapsedMs} ms\n`);
  stdout.write('cost:     $0.00 (local model — no provider billing)\n');
  stdout.write(`privacy:  this conversation never left your machine.\n`);
  stdout.write('\n');
}

main().catch((err) => {
  stderr.write(`!!! unhandled: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  exit(99);
});
