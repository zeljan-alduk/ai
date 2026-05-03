/**
 * /examples — public reference gallery of real, useful projects
 * built end-to-end on the ALDO AI platform.
 *
 * The bar for inclusion is high: each entry must be a real, running
 * product with a public URL, built (or substantially built) by the
 * platform's own agency — not a contrived demo. The narrative on each
 * card calls out the brief, the agents that handled the work, and the
 * shipped artefact a visitor can click through to.
 *
 * First entry: picenhancer.aldo.tech — a local-only image upscaler
 * built in a single session against the in-house reference agency,
 * end-to-end on Apple Silicon Metal. Same VPS as ai.aldo.tech.
 *
 * Curated by hand for the same reason /changelog and /roadmap are: a
 * generated gallery would drift into "every demo we ever made" within
 * a quarter. Each example here is one we want a prospect to read.
 */

import Link from 'next/link';

export const metadata = {
  title: 'Examples — ALDO AI',
  description:
    'Real, useful products built on ALDO AI in hours, not weeks. Featured: picenhancer — a local-only image upscaler running entirely on Apple Silicon Metal.',
};

interface BuildLine {
  readonly when: string;
  readonly what: string;
}

interface UsageSnippet {
  readonly id: string;
  readonly label: string;
  readonly note?: string;
  readonly code: string;
}

interface Example {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  readonly liveUrl: string;
  readonly liveLabel: string;
  readonly hostedOn: string;
  readonly elapsed: string;
  readonly cost: string;
  readonly stack: readonly string[];
  readonly summary: readonly string[];
  /** Step-by-step "how the platform built it" timeline. */
  readonly build: readonly BuildLine[];
  /** Which in-house agents touched the work. */
  readonly agents: readonly string[];
  /** Optional integration recipes — API, MCP, code snippets. */
  readonly usage?: readonly UsageSnippet[];
}

const EXAMPLES: readonly Example[] = [
  {
    slug: 'picenhancer',
    name: 'picenhancer',
    tagline:
      'A local-only image upscaler. Drop, paste, or click an image — get back a ×4, ×8, or ×16 enhanced version in seconds, no signup, $0 cost, your image never leaves the box.',
    liveUrl: '/live/picenhancer',
    liveLabel: 'ai.aldo.tech/live/picenhancer',
    hostedOn: 'Hosted under ai.aldo.tech — no separate domain, no DNS round-trip',
    elapsed: 'Brief → live, working product in a single afternoon',
    cost: '$0 per enhancement (no cloud egress)',
    stack: [
      'Real-ESRGAN x4 generative super-resolution (PyTorch CPU)',
      'GFPGAN v1.4 face restoration with 5-point landmark alignment',
      'YuNet face detector (OpenCV ONNX zoo, 1 MB)',
      'Hono server + SSE progress with heartbeat thread',
      'Next.js proxy at ai.aldo.tech/live/picenhancer · MCP server at @aldo-ai/mcp-picenhancer',
    ],
    summary: [
      'One screen. Drop, paste, or click an image. Action picker: Enhance / Enhance + bg / Upscale ×4 / Upscale ×8. Strength slider for GFPGAN weight (0–100 %). Live progress bar with heartbeat ticks during the long blocking inference call so the SSE stream survives the upstream HTTP/2 idle timeout.',
      'Diffusion-style processing animation in the AFTER pane while inference runs — the source image with progressive deblur and an SVG turbulence noise overlay that scrambles every 150 ms and clears as progress climbs.',
      'Privacy as a product feature: every model runs on the same VPS, no cloud egress, no third-party API, no telemetry, $0 per request. The image never leaves the box.',
      'Same reference agency every ALDO customer gets. The strategist that picks the upscaling strategy is a normal ALDO prompt; the agents that scaffolded the page + Dockerfile + Python pipeline + MCP wrapper are normal ALDO composite agents.',
    ],
    build: [
      {
        when: 'Minute 0',
        what: 'Founder typed the brief into the prompts UI: "online site, simple UI, upload image, AI improves quality." Product-strategist agent expanded it into a one-page spec.',
      },
      {
        when: 'Minute 8',
        what: 'tech-lead composite agent ran. It fanned out to architect (chose Real-ESRGAN over diffusion for latency), ml-engineer (picked the x4plus model), ux-researcher (drafted the drop-zone-first layout), and security-auditor (locked the privacy tier).',
      },
      {
        when: 'Minute 22',
        what: 'Hono server scaffolded by the agency, wrapping realesrgan-ncnn-vulkan as a child process. /enhance returns Server-Sent Events so the bar can move on real progress, not a fake spinner.',
      },
      {
        when: 'Minute 38',
        what: 'Single-page front-end shipped: drop / paste / click upload, segmented ×4/×8/×16 picker, live progress bar, side-by-side before/after, download link.',
      },
      {
        when: 'Minute 52',
        what: 'Smoke-tested 220×220 → 880×880 in 1.5s. Then 480×360 → 3840×2880 (×8, two chained passes) in 30s. All on local hardware, $0.',
      },
      {
        when: 'Same day',
        what: 'Mounted under ai.aldo.tech/live/picenhancer — no DNS, no new TLS cert, no separate domain. The Next.js route proxies /enhance to the pixmend backend; the same docker-compose stack co-locates the Hono server with the web app on the VPS.',
      },
    ],
    agents: [
      'product-strategist',
      'tech-lead',
      'architect',
      'ml-engineer',
      'ux-researcher',
      'security-auditor',
    ],
    usage: [
      {
        id: 'curl',
        label: 'HTTP API · curl',
        note: 'POST a multipart form. Returns text/event-stream NDJSON; the final `data: {"type":"done", ...}` carries the imageUrl.',
        code: `curl -N -X POST https://ai.aldo.tech/live/picenhancer/api/enhance \\
  -F file=@portrait.jpg \\
  -F scale=1 \\
  -F bg=1 \\
  -F weight=0.7
# Then GET https://ai.aldo.tech/live/picenhancer/api/out/<filename> for the PNG.`,
      },
      {
        id: 'fetch',
        label: 'JS · fetch + SSE',
        note: 'Streams the SSE; resolves with the final result once the pipeline emits `done`.',
        code: `async function enhance(file) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('scale', '1');     // 1 / 4 / 8 / 16
  fd.append('bg', '1');        // 0 = leave background alone
  fd.append('weight', '0.7');  // GFPGAN strength
  const res = await fetch('https://ai.aldo.tech/live/picenhancer/api/enhance', {
    method: 'POST', body: fd,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\\n\\n')) >= 0) {
      const line = buf.slice(0, i).split('\\n').find(l => l.startsWith('data:'));
      buf = buf.slice(i + 2);
      if (!line) continue;
      const ev = JSON.parse(line.slice(5).trim());
      if (ev.type === 'done') return ev;          // { imageUrl, faces, scale, ... }
      if (ev.type === 'progress') /* update UI */;
    }
  }
}`,
      },
      {
        id: 'python',
        label: 'Python · requests + sseclient',
        note: 'Same wire shape; works identically from any HTTP client.',
        code: `import json, requests
from sseclient import SSEClient

with open('portrait.jpg', 'rb') as f:
    res = requests.post(
        'https://ai.aldo.tech/live/picenhancer/api/enhance',
        files={'file': ('portrait.jpg', f, 'image/jpeg')},
        data={'scale': '1', 'bg': '1', 'weight': '0.7'},
        stream=True,
    )
done = None
for ev in SSEClient(res).events():
    payload = json.loads(ev.data)
    if payload['type'] == 'done':
        done = payload
print(done['imageUrl'], done['faces'], done['enhanceMs'])`,
      },
      {
        id: 'mcp-claude',
        label: 'MCP · Claude Desktop / Cursor / ChatGPT GPTs',
        note: 'Drop into your MCP client config. The server runs as a stdio child process and exposes one tool: `picenhancer.enhance`.',
        code: `// claude_desktop_config.json (or any MCP client that speaks stdio)
{
  "mcpServers": {
    "picenhancer": {
      "command": "npx",
      "args": ["-y", "@aldo-ai/mcp-picenhancer"]
      // Optional override:
      // "env": { "PICENHANCER_BASE_URL": "https://ai.aldo.tech/live/picenhancer/api" }
    }
  }
}`,
      },
      {
        id: 'mcp-tool',
        label: 'MCP · tool call shape',
        note: 'Once the MCP server is registered, any chat / agent can call:',
        code: `// tools/call request body
{
  "name": "picenhancer.enhance",
  "arguments": {
    "image": "data:image/jpeg;base64,/9j/4AAQ...",   // or an https:// URL
    "mode": "enhance",                                // enhance | enhance-bg | upscale-x4 | upscale-x8
    "strength": 0.7                                   // GFPGAN weight 0.0–1.0
  }
}
// Response (structuredContent):
//   {
//     imageUrl, scale, bg, weight, faces,
//     origDims, enhancedDims, origBytes, enhancedBytes, enhanceMs
//   }`,
      },
      {
        id: 'aldo-agent',
        label: 'ALDO agent spec',
        note: 'Wire the MCP tool into any composite agent in your tenant — same pattern as the bundled aldo-fs MCP server.',
        code: `# agency/your-agent.yaml
name: my-image-agent
tools:
  permissions:
    mcp:
      - picenhancer.enhance:
          allow: ["*"]
prompt: |
  When the user gives you a portrait photo, call picenhancer.enhance
  with mode="enhance" and strength=0.7. Return the resulting imageUrl
  and the face count to the user.`,
      },
    ],
  },
];

export default function ExamplesPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <header className="border-b border-border pb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Examples
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          Real products built on ALDO AI.
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-fg-muted">
          Not demos. Not screenshots of a future state. Each entry below is a live, useful product
          built by ALDO&rsquo;s own in-house agency — usually in hours, not weeks — and is running
          on the public internet right now. Click through and use them.
        </p>
        <p className="mt-3 text-sm text-fg-muted">
          Want to ship something like this?{' '}
          <Link href="/signup" className="text-accent underline-offset-2 hover:underline">
            Sign up
          </Link>{' '}
          and brief the agency. Or read{' '}
          <Link href="/docs" className="text-accent underline-offset-2 hover:underline">
            the docs
          </Link>{' '}
          first.
        </p>
      </header>

      <div className="mt-12 space-y-12">
        {EXAMPLES.map((ex) => (
          <ExampleCard key={ex.slug} ex={ex} />
        ))}
      </div>

      <section className="mt-16 rounded-2xl border border-border bg-bg-elevated p-8">
        <h2 className="text-[20px] font-semibold tracking-tight text-fg">
          What goes on this page.
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          A project lands here when (1) a visitor can click the live link and use the thing,
          (2) most of the build was driven by ALDO agents (briefs, design, code, review), and
          (3) we can show the timeline honestly — including which agents ran, what they decided,
          and how long it actually took. If your team builds something that fits, email{' '}
          <a className="text-accent underline-offset-2 hover:underline" href="mailto:info@aldo.tech">
            info@aldo.tech
          </a>{' '}
          and we&rsquo;ll feature it.
        </p>
      </section>
    </article>
  );
}

function ExampleCard({ ex }: { ex: Example }) {
  return (
    <section
      id={ex.slug}
      className="rounded-2xl border border-border bg-bg-elevated p-8 sm:p-10"
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[26px] font-semibold tracking-tight text-fg">{ex.name}</h2>
        <span className="rounded-full bg-success/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success ring-1 ring-success/30">
          live
        </span>
        <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent ring-1 ring-accent/30">
          built with ALDO
        </span>
      </div>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fg-muted">{ex.tagline}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {ex.liveUrl.startsWith('/') ? (
          <Link
            href={ex.liveUrl}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Open {ex.liveLabel}
            <span aria-hidden>→</span>
          </Link>
        ) : (
          <a
            href={ex.liveUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Open {ex.liveLabel}
            <span aria-hidden>↗</span>
          </a>
        )}
        <span className="text-[12px] text-fg-faint">{ex.hostedOn}</span>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fact label="Time to ship" value={ex.elapsed} />
        <Fact label="Cost per use" value={ex.cost} />
      </dl>

      <h3 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
        What it is
      </h3>
      <ul className="mt-3 space-y-3 text-[14px] leading-relaxed text-fg-muted">
        {ex.summary.map((line, i) => (
          <li key={i} className="flex gap-3">
            <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
        How ALDO built it
      </h3>
      <ol className="mt-3 space-y-4">
        {ex.build.map((b, i) => (
          <li key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[7rem,1fr] sm:gap-5">
            <div className="font-mono text-[12px] uppercase tracking-wider text-fg-faint sm:pt-0.5">
              {b.when}
            </div>
            <div className="text-[14px] leading-relaxed text-fg">{b.what}</div>
          </li>
        ))}
      </ol>

      <h3 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
        Agents involved
      </h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {ex.agents.map((a) => (
          <span
            key={a}
            className="rounded-md border border-border bg-bg px-2.5 py-1 font-mono text-[12px] text-fg"
          >
            {a}
          </span>
        ))}
      </div>

      {ex.usage && ex.usage.length > 0 && (
        <>
          <h3 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
            Use it as an API or MCP tool
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
            Same pipeline that powers the live page is callable from any agent
            chain — HTTP for anything that speaks fetch, MCP for Claude Desktop
            / Cursor / ChatGPT GPTs / ALDO composite agents.
          </p>
          <div className="mt-4 space-y-3">
            {ex.usage.map((u) => (
              <details
                key={u.id}
                className="group rounded-lg border border-border bg-bg-elevated"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 font-mono text-[12px] font-semibold uppercase tracking-wider text-fg hover:bg-bg-subtle">
                  <span>{u.label}</span>
                  <span aria-hidden className="text-fg-faint group-open:rotate-90 transition-transform">
                    ▸
                  </span>
                </summary>
                <div className="border-t border-border px-4 pb-4 pt-3 text-[13px] leading-relaxed">
                  {u.note && (
                    <p className="mb-3 text-fg-muted">{u.note}</p>
                  )}
                  <pre className="overflow-x-auto rounded-md border border-border bg-bg px-3 py-3 font-mono text-[12px] leading-relaxed text-fg">
                    <code>{u.code}</code>
                  </pre>
                </div>
              </details>
            ))}
          </div>
        </>
      )}

      <p className="mt-8 border-t border-border pt-5 text-[13px] text-fg-muted">
        The same pattern is yours: brief the agency, watch the composite run, ship the artefact.
        Read the{' '}
        <Link href="/docs" className="text-accent underline-offset-2 hover:underline">
          docs
        </Link>{' '}
        or{' '}
        <Link href="/signup" className="text-accent underline-offset-2 hover:underline">
          sign up
        </Link>
        .
      </p>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-faint">
        {label}
      </dt>
      <dd className="mt-1 text-[14px] text-fg">{value}</dd>
    </div>
  );
}
