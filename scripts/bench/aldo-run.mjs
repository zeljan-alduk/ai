/**
 * Layer 2 — aldo run wrapping LM Studio. Measures the wall-clock
 * overhead the CLI adds: bootstrap (live discovery, registry build,
 * spec resolution) + the engine's run loop wrapping the gateway call.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = '/Users/aldo/Documents/ai/Untitled';
const TSX = `${REPO}/node_modules/.pnpm/node_modules/.bin/tsx`;
const CLI = `${REPO}/apps/cli/src/index.ts`;
const MODEL = 'qwen/qwen3.6-35b-a3b';

// Throwaway agent (privacy=sensitive, local-reasoning, no tools).
const ws = mkdtempSync(join(tmpdir(), 'aldo-bench-run-'));
{
  const dir = `${ws}/agents`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    `${dir}/bench.yaml`,
    `apiVersion: aldo-ai/agent.v1
kind: Agent
identity: { name: bench, version: 0.1.0, description: smoke, owner: bench, tags: [] }
role: { team: bench, pattern: worker }
model_policy:
  capability_requirements: [streaming]
  privacy_tier: sensitive
  primary: { capability_class: local-reasoning }
  fallbacks: []
  budget: { usd_per_run: 0.01, usd_grace: 0 }
  decoding: { mode: free, temperature: 0 }
prompt: { system_file: sys.md }
tools: { mcp: [], native: [], permissions: { network: none, filesystem: none } }
memory: { read: [], write: [], retention: {} }
spawn: { allowed: [] }
escalation: []
subscriptions: []
eval_gate: { required_suites: [], must_pass_before_promote: false }
`,
  );
  writeFileSync(`${dir}/sys.md`, 'Be terse. No reasoning, no preamble.');
}

function once() {
  return new Promise((resolve) => {
    const start = performance.now();
    let stdoutBuf = '';
    const child = spawn(
      TSX,
      [
        CLI,
        'run',
        'bench',
        '--model',
        MODEL,
        '--inputs',
        '{"task":"Reply with exactly: BENCH_TOKEN. No reasoning, no preamble."}',
        '--json',
      ],
      {
        cwd: ws,
        env: {
          ...process.env,
          ALDO_LOCAL_DISCOVERY: 'lmstudio',
          LM_STUDIO_BASE_URL: 'http://localhost:1234',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.on('data', (b) => {
      stdoutBuf += b.toString();
    });
    child.on('exit', (code) => {
      const total = performance.now() - start;
      try {
        // Stdout is the pretty-printed JSON object; parse the whole thing.
        const j = JSON.parse(stdoutBuf.trim());
        resolve({
          totalMs: total,
          aldoElapsedMs: j.elapsedMs,
          overheadMs: total - j.elapsedMs,
          ok: j.ok,
          outputLen: (j.output ?? '').length,
          exitCode: code,
        });
      } catch (err) {
        resolve({ totalMs: total, parseError: String(err), exitCode: code, raw: stdoutBuf.slice(0, 500) });
      }
    });
  });
}

const N = Number(process.env.BENCH_RUNS ?? 3);
console.log(`# bench: aldo run · model=${MODEL} · n=${N}`);
const results = [];
for (let i = 1; i <= N; i++) {
  const r = await once();
  if (r.parseError) {
    console.log(`  run ${i}: PARSE_ERROR ${r.parseError} · raw=${(r.raw ?? '').slice(0, 200)}`);
    continue;
  }
  console.log(`  run ${i}: total=${r.totalMs.toFixed(0)}ms aldoElapsed=${r.aldoElapsedMs}ms overhead=${r.overheadMs.toFixed(0)}ms ok=${r.ok} outLen=${r.outputLen}`);
  results.push(r);
}
const avg = (k) => {
  const xs = results.map((r) => r[k]).filter((v) => typeof v === 'number');
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
console.log(`# avg: total=${avg('totalMs')?.toFixed(0)}ms aldoElapsed=${avg('aldoElapsedMs')?.toFixed(0)}ms overhead=${avg('overheadMs')?.toFixed(0)}ms`);
