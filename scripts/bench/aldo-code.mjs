/**
 * Layer 3 — aldo code (one-cycle iterative loop). Measures the
 * iterative-loop wrapper cost on top of `aldo run`. Same prompt;
 * --max-cycles 1 --tools "" so only one model call fires.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = '/Users/aldo/Documents/ai/Untitled';
const TSX = `${REPO}/node_modules/.pnpm/node_modules/.bin/tsx`;
const CLI = `${REPO}/apps/cli/src/index.ts`;
const MODEL = 'qwen/qwen3.6-35b-a3b';
const ws = mkdtempSync(join(tmpdir(), 'aldo-bench-code-'));

function once() {
  return new Promise((resolve) => {
    const start = performance.now();
    const events = [];
    let buf = '';
    const child = spawn(
      TSX,
      [
        CLI,
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
        MODEL,
        'Reply with exactly: BENCH_TOKEN. No reasoning, no preamble.',
      ],
      {
        env: {
          ...process.env,
          ALDO_LOCAL_DISCOVERY: 'lmstudio',
          LM_STUDIO_BASE_URL: 'http://localhost:1234',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let firstEventAt = null;
    let cycleStartAt = null;
    let modelResponseAt = null;
    let runCompletedAt = null;
    let usage = null;

    child.stdout.on('data', (b) => {
      buf += b.toString();
      let eol;
      while ((eol = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, eol).trim();
        buf = buf.slice(eol + 1);
        if (!line.startsWith('{')) continue;
        try {
          const j = JSON.parse(line);
          const now = performance.now() - start;
          if (firstEventAt === null) firstEventAt = now;
          const t = j.event?.type;
          if (t === 'cycle.start') cycleStartAt = now;
          if (t === 'model.response') {
            modelResponseAt = now;
            usage = j.event.payload?.usage;
          }
          if (t === 'run.completed') runCompletedAt = now;
          events.push({ at: now, type: t, kind: j.kind });
        } catch {}
      }
    });
    child.on('exit', (code) => {
      const total = performance.now() - start;
      resolve({
        totalMs: total,
        firstEventAt,
        cycleStartAt,
        modelResponseAt,
        runCompletedAt,
        modelCallMs: modelResponseAt !== null && cycleStartAt !== null ? modelResponseAt - cycleStartAt : null,
        bootstrapMs: cycleStartAt,
        tokensIn: usage?.tokensIn ?? null,
        tokensOut: usage?.tokensOut ?? null,
        tokPerSecOut: usage && modelResponseAt && cycleStartAt
          ? (usage.tokensOut / (modelResponseAt - cycleStartAt)) * 1000
          : null,
        exitCode: code,
        eventCount: events.length,
      });
    });
  });
}

const N = Number(process.env.BENCH_RUNS ?? 3);
console.log(`# bench: aldo code (1 cycle, no tools) · model=${MODEL} · n=${N}`);
const results = [];
for (let i = 1; i <= N; i++) {
  const r = await once();
  console.log(
    `  run ${i}: total=${r.totalMs.toFixed(0)}ms bootstrap=${r.bootstrapMs?.toFixed(0)}ms modelCall=${r.modelCallMs?.toFixed(0)}ms tok_in=${r.tokensIn} tok_out=${r.tokensOut} tok/s=${r.tokPerSecOut?.toFixed(1)} events=${r.eventCount}`,
  );
  results.push(r);
}
const avg = (k) => {
  const xs = results.map((r) => r[k]).filter((v) => typeof v === 'number');
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
console.log(
  `# avg: total=${avg('totalMs')?.toFixed(0)}ms bootstrap=${avg('bootstrapMs')?.toFixed(0)}ms modelCall=${avg('modelCallMs')?.toFixed(0)}ms tok/s=${avg('tokPerSecOut')?.toFixed(1)}`,
);
