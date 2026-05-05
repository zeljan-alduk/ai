/**
 * Layer 1 — direct HTTP to LM Studio (control / floor).
 * Measures TTFT (time to first delta), total wall time, output
 * tokens/sec from the streaming response + the final usage record.
 */
const URL = 'http://localhost:1234/v1/chat/completions';
const MODEL = 'qwen/qwen3.6-35b-a3b';
const PROMPT = process.env.BENCH_PROMPT ?? 'Reply with exactly: BENCH_TOKEN. No reasoning, no preamble.';

async function once(promptOverride) {
  const start = performance.now();
  let firstDeltaAt = null;
  let outChars = 0;
  let usage = null;
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: promptOverride ?? PROMPT }],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: Number(process.env.BENCH_MAX_TOKENS ?? 256),
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let eol;
    while ((eol = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, eol).trim();
      buf = buf.slice(eol + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const choice = j.choices?.[0];
        const delta = choice?.delta;
        if (delta && (delta.content || delta.reasoning_content) && firstDeltaAt === null) {
          firstDeltaAt = performance.now() - start;
        }
        if (delta?.content) outChars += delta.content.length;
        if (delta?.reasoning_content) outChars += delta.reasoning_content.length;
        if (j.usage) usage = j.usage;
      } catch {}
    }
  }
  const total = performance.now() - start;
  return {
    ttftMs: firstDeltaAt,
    totalMs: total,
    outputChars: outChars,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
    tokPerSecOut: usage ? (usage.completion_tokens / total) * 1000 : null,
  };
}

const N = Number(process.env.BENCH_RUNS ?? 3);
console.log(`# bench: direct LM Studio · model=${MODEL} · n=${N}`);
const results = [];
for (let i = 1; i <= N; i++) {
  const r = await once();
  console.log(`  run ${i}: ttft=${r.ttftMs?.toFixed(0)}ms total=${r.totalMs.toFixed(0)}ms tok_in=${r.promptTokens} tok_out=${r.completionTokens} reasoning=${r.reasoningTokens} tok/s=${r.tokPerSecOut?.toFixed(1)}`);
  results.push(r);
}
const avg = (k) => {
  const xs = results.map((r) => r[k]).filter((v) => typeof v === 'number');
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
console.log(`# avg: ttft=${avg('ttftMs')?.toFixed(0)}ms total=${avg('totalMs')?.toFixed(0)}ms tok/s=${avg('tokPerSecOut')?.toFixed(1)}`);
