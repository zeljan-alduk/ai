import { LocalModelsShell } from '@/components/local-models/local-models-shell';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Scan local models — ALDO AI',
  description:
    'Discover every local LLM running on your machine and rate it on quality + speed. No signup required.',
};

/**
 * `/local-models` — public marketing surface. Discover local LLM
 * servers, then rate any of them on a curated quality × speed eval
 * suite. The whole flow is unauth'd by design — it's the demo CTA
 * from the homepage hero.
 *
 * Lives under `(marketing)/` so it inherits the marketing top nav +
 * footer and skips the authenticated app sidebar. The root layout's
 * `MARKETING_PATHS` list also names `/local-models` so the chromeless
 * branch fires before any session lookup.
 *
 * The interactive surface (discovery list, scan-mode selector, suite
 * picker, streaming results table) is a client island — SSE frames
 * from `/v1/bench/suite` flow straight into the table.
 *
 * LLM-agnostic: every piece of model metadata flows through opaquely;
 * the UI never branches on a specific provider name.
 */
export default function LocalModelsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Public demo · no signup
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Scan local models. Rate them in seconds.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-fg-muted">
          The platform probes <span className="font-mono text-fg">127.0.0.1</span> for any
          OpenAI-compatible LLM server (Ollama, LM Studio, vLLM, llama.cpp, plus a
          curated dev-port list and an exhaustive sweep mode), then runs a curated
          eight-case eval suite against the model you pick — pass/fail per case, TTFT,
          tokens, reasoning split, tok/s. Every result streams in live.
        </p>
      </header>

      <div className="mt-10">
        <LocalModelsShell />
      </div>

      <p className="mt-8 text-center text-xs text-fg-muted">
        Want the same loop from your terminal?{' '}
        <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[11px] text-fg">
          aldo bench --suite local-model-rating --model &lt;id&gt;
        </code>
        . The CLI ships with the platform —{' '}
        <a className="underline hover:text-fg" href="/docs/guides/local-models">
          local-models guide
        </a>
        .
      </p>
    </div>
  );
}
