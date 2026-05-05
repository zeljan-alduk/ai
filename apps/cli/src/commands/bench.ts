/**
 * `aldo bench` — characterise the platform's overhead vs raw provider HTTP.
 *
 * Runs one or more "layers" against the configured local-discovery
 * target and reports TTFT (time to first delta), total wall-clock,
 * tokens/sec out, and prompt/completion token counts.
 *
 *   Layer 1 — direct HTTP to the runtime's /v1/chat/completions
 *             endpoint. Floor / control. Picks one model from the
 *             discovery probe (or `--model <id>` to pin).
 *   Layer 2 — single-shot inference through the gateway via
 *             `runtime.runAgent` against a synthetic single-turn
 *             agent. Measures the platform's per-call overhead vs
 *             Layer 1.
 *   Layer 3 — one-cycle iterative loop. Same model + brief; goes
 *             through `IterativeAgentRun` so the cycle/checkpoint/
 *             history-compress plumbing fires once.
 *
 * The agency cascade (Layer 4) lives inside the dry-run harness in
 * apps/api/tests/agency-dry-run/run-live-network.mjs — too much
 * platform state (MCP tool host, run store, supervisor) to wedge
 * into a single command. Operators run that explicitly.
 *
 * Output:
 *   - Per-run lines (one per iteration of each layer).
 *   - Per-layer averages.
 *   - JSON output via `--json` for machine consumption.
 *
 * LLM-agnostic: never references a specific provider name. Layer 1
 * walks whatever the local-discovery probe surfaces; Layers 2-3 go
 * through the gateway router.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentRef,
  AgentSpec,
  CompletionRequest,
  Delta,
  ModelGateway,
  RunEvent,
} from '@aldo-ai/types';
import { bootstrapAsync } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import type { CliIO } from '../io.js';
import { writeErr, writeJson, writeLine } from '../io.js';
import { runBenchSuite } from './bench-suite.js';

export interface BenchOptions {
  /** Comma-separated layer ids; default `direct,run,code`. */
  readonly layers?: string;
  /** Iterations per layer. Default 3. */
  readonly runs?: number;
  /** Model id to pin (passed to `--model`). When omitted, layer 1 picks the first discovered model. */
  readonly model?: string;
  /** Override the prompt. Default is a 1-token-budget-friendly probe. */
  readonly prompt?: string;
  /** Cap output tokens for layer 1's direct HTTP. Default 256. */
  readonly maxTokens?: number;
  /** Emit machine-readable JSON instead of human table. */
  readonly json?: boolean;
  /**
   * Run a quality × speed eval suite instead of the timing layers.
   * When set, every other timing-layer flag is ignored and the bench
   * dispatches to `runBenchSuite`. `--model` becomes required (a
   * rating is per-model by definition).
   */
  readonly suite?: string;
}

const DEFAULT_PROMPT = 'Reply with exactly: BENCH_TOKEN. No reasoning, no preamble.';
const DEFAULT_LAYERS = ['direct', 'run', 'code'] as const;

interface PerRun {
  readonly run: number;
  readonly totalMs: number;
  readonly ttftMs?: number | null;
  readonly modelMs?: number | null;
  readonly bootstrapMs?: number | null;
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
  readonly tokPerSec?: number | null;
  readonly ok?: boolean;
  readonly error?: string;
}

interface LayerResult {
  readonly layer: string;
  readonly model: string;
  readonly runs: readonly PerRun[];
}

export async function runBench(opts: BenchOptions, io: CliIO): Promise<number> {
  // Suite mode short-circuits the timing-layers path. Quality × speed
  // is a different output shape (table per case, not per iteration), so
  // the dispatch is a hard branch rather than a layer plug-in.
  if (opts.suite !== undefined && opts.suite.length > 0) {
    if (opts.model === undefined || opts.model.length === 0) {
      writeErr(io, 'error: --suite requires --model <id> (a rating is per-model)');
      return 1;
    }
    return runBenchSuite(
      {
        suite: opts.suite,
        model: opts.model,
        ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
        json: opts.json === true,
      },
      io,
    );
  }

  const wantedLayers = (opts.layers ?? DEFAULT_LAYERS.join(','))
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const n = opts.runs ?? 3;
  const prompt = opts.prompt ?? DEFAULT_PROMPT;

  // Resolve a model id either from --model or the first local-discovered row.
  const cfg = loadConfig();
  const modelId = opts.model ?? (await firstDiscoveredModelId());
  if (modelId === null) {
    writeErr(io, 'error: no model id available. Set --model <id> or ALDO_LOCAL_DISCOVERY=<source>.');
    return 1;
  }

  const baseUrl = await firstLocalBaseUrl();
  const results: LayerResult[] = [];

  for (const layer of wantedLayers) {
    if (!['direct', 'run', 'code'].includes(layer)) {
      writeErr(io, `warn: unknown layer '${layer}' — skipping`);
      continue;
    }
    if (opts.json !== true) writeLine(io, `# bench layer: ${layer} · model=${modelId} · n=${n}`);
    const runs: PerRun[] = [];
    for (let i = 1; i <= n; i++) {
      let r: PerRun;
      try {
        if (layer === 'direct') {
          if (baseUrl === null) {
            r = { run: i, totalMs: 0, error: 'no local baseUrl resolved' };
          } else {
            r = await runDirectLayer(i, baseUrl, modelId, prompt, opts.maxTokens ?? 256);
          }
        } else if (layer === 'run') {
          r = await runRunLayer(i, cfg, modelId, prompt);
        } else {
          r = await runCodeLayer(i, cfg, modelId, prompt);
        }
      } catch (err) {
        r = { run: i, totalMs: 0, error: err instanceof Error ? err.message : String(err) };
      }
      if (opts.json !== true) writeLine(io, formatRun(layer, r));
      runs.push(r);
    }
    if (opts.json !== true) {
      const avg = averages(runs);
      writeLine(io, formatAvg(layer, avg));
    }
    results.push({ layer, model: modelId, runs });
  }

  if (opts.json === true) {
    writeJson(io, { model: modelId, layers: results });
  }
  return 0;
}

// ── layer 1: direct HTTP ─────────────────────────────────────────────

async function runDirectLayer(
  i: number,
  baseUrl: string,
  modelId: string,
  prompt: string,
  maxTokens: number,
): Promise<PerRun> {
  const start = performance.now();
  let firstDeltaAt: number | null = null;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: maxTokens,
      temperature: 0,
    }),
  });
  if (!res.ok) {
    return { run: i, totalMs: performance.now() - start, error: `HTTP ${res.status}` };
  }
  if (res.body === null) {
    return { run: i, totalMs: performance.now() - start, error: 'no response body' };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let eol: number;
    while ((eol = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, eol).trim();
      buf = buf.slice(eol + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const delta = j.choices?.[0]?.delta;
        if (delta && (delta.content || delta.reasoning_content) && firstDeltaAt === null) {
          firstDeltaAt = performance.now() - start;
        }
        if (j.usage) usage = j.usage;
      } catch {
        // ignore malformed sse rows
      }
    }
  }
  const totalMs = performance.now() - start;
  return {
    run: i,
    totalMs,
    ttftMs: firstDeltaAt,
    tokensIn: usage?.prompt_tokens ?? null,
    tokensOut: usage?.completion_tokens ?? null,
    tokPerSec:
      usage?.completion_tokens !== undefined
        ? (usage.completion_tokens / totalMs) * 1000
        : null,
    ok: true,
  };
}

// ── layer 2: aldo run (single-turn agent through the gateway) ────────

async function runRunLayer(
  i: number,
  cfg: ReturnType<typeof loadConfig>,
  modelId: string,
  prompt: string,
): Promise<PerRun> {
  const start = performance.now();
  const bundle = await bootstrapAsync({
    config: cfg,
    pinModelId: modelId,
  });
  const bootstrapMs = performance.now() - start;

  // Synthetic spec — privacy=sensitive, local-reasoning, no tools.
  const spec = synthSingleShotSpec();
  bundle.agentRegistry.registerSpec(spec);

  const runStart = performance.now();
  const ref: AgentRef = { name: spec.identity.name };
  const run = await bundle.runtime.runAgent(ref, { task: prompt });

  let firstEventAt: number | null = null;
  let usage: { tokensIn?: number; tokensOut?: number } | null = null;
  for await (const ev of run.events()) {
    if (firstEventAt === null) firstEventAt = performance.now() - runStart;
    if (ev.type === 'message') {
      const p = ev.payload as { usage?: { tokensIn?: number; tokensOut?: number } };
      if (p.usage) usage = p.usage;
    }
  }
  const totalMs = performance.now() - start;
  const modelMs = performance.now() - runStart;
  return {
    run: i,
    totalMs,
    bootstrapMs,
    modelMs,
    ttftMs: firstEventAt,
    tokensIn: usage?.tokensIn ?? null,
    tokensOut: usage?.tokensOut ?? null,
    tokPerSec:
      usage?.tokensOut !== undefined ? (usage.tokensOut / modelMs) * 1000 : null,
    ok: true,
  };
}

// ── layer 3: aldo code 1-cycle ───────────────────────────────────────

async function runCodeLayer(
  i: number,
  cfg: ReturnType<typeof loadConfig>,
  modelId: string,
  prompt: string,
): Promise<PerRun> {
  // Spawn `aldo code` in a subprocess so the iterative-loop wiring
  // (CliCodeToolHost, synthetic __cli_code__ spec, ink-bypass headless
  // mode) fires exactly as it would for a human user.
  const ws = mkdtempSync(join(tmpdir(), 'aldo-bench-code-'));
  mkdirSync(join(ws, 'agents'), { recursive: true });

  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const here = fileURLToPath(import.meta.url);
  const cliEntry = join(here, '..', '..', '..', 'src', 'index.ts');

  return new Promise<PerRun>((resolve) => {
    const start = performance.now();
    let bootstrapMs: number | null = null;
    let modelStartMs: number | null = null;
    let modelEndMs: number | null = null;
    let usage: { tokensIn?: number; tokensOut?: number } | null = null;
    let buf = '';
    const child = spawn(
      process.execPath,
      [
        '--require',
        'tsx',
        cliEntry,
        'code',
        '--workspace',
        ws,
        '--capability-class',
        'local-reasoning',
        '--max-cycles',
        '1',
        '--tools',
        '',
        '--model',
        modelId,
        prompt,
      ],
      {
        env: { ...process.env, NODE_OPTIONS: '--import tsx' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.on('data', (b: Buffer) => {
      buf += b.toString();
      let eol: number;
      while ((eol = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, eol).trim();
        buf = buf.slice(eol + 1);
        if (!line.startsWith('{')) continue;
        try {
          const j = JSON.parse(line) as {
            kind?: string;
            event?: { type?: string; payload?: { usage?: { tokensIn?: number; tokensOut?: number } } };
          };
          const now = performance.now() - start;
          const evType = j.event?.type;
          if (evType === 'cycle.start') {
            modelStartMs = now;
            if (bootstrapMs === null) bootstrapMs = now;
          }
          if (evType === 'model.response') {
            modelEndMs = now;
            usage = j.event?.payload?.usage ?? null;
          }
        } catch {
          // ignore non-json stdout lines
        }
      }
    });
    child.on('exit', () => {
      const totalMs = performance.now() - start;
      const modelMs =
        modelStartMs !== null && modelEndMs !== null ? modelEndMs - modelStartMs : null;
      resolve({
        run: i,
        totalMs,
        bootstrapMs,
        modelMs,
        tokensIn: usage?.tokensIn ?? null,
        tokensOut: usage?.tokensOut ?? null,
        tokPerSec:
          usage?.tokensOut !== undefined && modelMs !== null && modelMs > 0
            ? (usage.tokensOut / modelMs) * 1000
            : null,
        ok: usage !== null,
      });
    });
  });
}

// ── helpers ──────────────────────────────────────────────────────────

export async function firstDiscoveredModelId(): Promise<string | null> {
  const raw = process.env.ALDO_LOCAL_DISCOVERY;
  if (raw === undefined || raw.trim() === '') return null;
  try {
    const { discover, parseDiscoverySources } = await import('@aldo-ai/local-discovery');
    const sources = parseDiscoverySources(raw);
    if (sources.length === 0) return null;
    const baseUrls: Record<string, string> = {};
    if (process.env.OLLAMA_BASE_URL) baseUrls.ollama = process.env.OLLAMA_BASE_URL;
    if (process.env.LM_STUDIO_BASE_URL) baseUrls.lmstudio = process.env.LM_STUDIO_BASE_URL;
    if (process.env.VLLM_BASE_URL) baseUrls.vllm = process.env.VLLM_BASE_URL;
    if (process.env.LLAMACPP_BASE_URL) baseUrls.llamacpp = process.env.LLAMACPP_BASE_URL;
    const probed = await discover({
      sources,
      baseUrls: baseUrls as Partial<Readonly<Record<typeof sources[number], string>>>,
    });
    return probed[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function firstLocalBaseUrl(): Promise<string | null> {
  // Prefer LM Studio → Ollama (it carries a /v1 prefix in our probe);
  // fall back to whatever the user set in env.
  if (process.env.LM_STUDIO_BASE_URL) return process.env.LM_STUDIO_BASE_URL;
  if (process.env.OLLAMA_BASE_URL) return `${process.env.OLLAMA_BASE_URL}`.replace(/\/+$/, '');
  if (process.env.VLLM_BASE_URL) return process.env.VLLM_BASE_URL;
  if (process.env.LLAMACPP_BASE_URL) return process.env.LLAMACPP_BASE_URL;
  return null;
}

function synthSingleShotSpec(): AgentSpec {
  // Hand-built minimal spec — no YAML. Identical capability surface to
  // the qwen-smoke fixture documented in the local-models guide.
  return {
    apiVersion: 'aldo-ai/agent.v1',
    kind: 'Agent',
    identity: {
      name: '__bench_oneshot__',
      version: '0.1.0',
      description: 'aldo bench synthetic single-shot',
      owner: 'bench',
      tags: [],
    },
    role: { team: 'bench', pattern: 'worker' },
    modelPolicy: {
      capabilityRequirements: ['streaming'],
      privacyTier: 'sensitive',
      primary: { capabilityClass: 'local-reasoning' },
      fallbacks: [],
      budget: { usdMax: 0.01, usdGrace: 0 },
      decoding: { mode: 'free', temperature: 0 },
    },
    prompt: { systemFile: 'inline:bench', templates: {}, variables: {} },
    tools: { mcp: [], native: [], permissions: { network: 'none', filesystem: 'none' } },
    memory: { read: [], write: [], retention: {} },
    spawn: { allowed: [] },
    escalation: [],
    subscriptions: [],
    evalGate: { requiredSuites: [], mustPassBeforePromote: false },
  } as unknown as AgentSpec;
}

interface RunAvg {
  readonly totalMs: number | null;
  readonly ttftMs: number | null;
  readonly modelMs: number | null;
  readonly bootstrapMs: number | null;
  readonly tokPerSec: number | null;
  readonly tokensOut: number | null;
}

function averages(runs: readonly PerRun[]): RunAvg {
  const ok = runs.filter((r) => r.error === undefined);
  const avg = (k: keyof PerRun): number | null => {
    const xs = ok.map((r) => r[k]).filter((v): v is number => typeof v === 'number');
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  return {
    totalMs: avg('totalMs'),
    ttftMs: avg('ttftMs'),
    modelMs: avg('modelMs'),
    bootstrapMs: avg('bootstrapMs'),
    tokPerSec: avg('tokPerSec'),
    tokensOut: avg('tokensOut'),
  };
}

function formatRun(layer: string, r: PerRun): string {
  if (r.error !== undefined) {
    return `  run ${r.run}: ERROR — ${r.error}`;
  }
  const parts = [`run ${r.run}`, `total=${r.totalMs.toFixed(0)}ms`];
  if (r.ttftMs !== undefined && r.ttftMs !== null) {
    parts.push(`ttft=${r.ttftMs.toFixed(0)}ms`);
  }
  if (r.bootstrapMs !== undefined && r.bootstrapMs !== null) {
    parts.push(`bootstrap=${r.bootstrapMs.toFixed(0)}ms`);
  }
  if (r.modelMs !== undefined && r.modelMs !== null) {
    parts.push(`model=${r.modelMs.toFixed(0)}ms`);
  }
  if (r.tokensOut !== undefined && r.tokensOut !== null) {
    parts.push(`tok_out=${r.tokensOut}`);
  }
  if (r.tokPerSec !== undefined && r.tokPerSec !== null) {
    parts.push(`tok/s=${r.tokPerSec.toFixed(1)}`);
  }
  return `  ${parts.join(' ')}`;
}

function formatAvg(layer: string, a: RunAvg): string {
  const parts = [`# ${layer} avg`];
  if (a.totalMs !== null) parts.push(`total=${a.totalMs.toFixed(0)}ms`);
  if (a.ttftMs !== null) parts.push(`ttft=${a.ttftMs.toFixed(0)}ms`);
  if (a.bootstrapMs !== null) parts.push(`bootstrap=${a.bootstrapMs.toFixed(0)}ms`);
  if (a.modelMs !== null) parts.push(`model=${a.modelMs.toFixed(0)}ms`);
  if (a.tokPerSec !== null) parts.push(`tok/s=${a.tokPerSec.toFixed(1)}`);
  return parts.join(' ');
}
