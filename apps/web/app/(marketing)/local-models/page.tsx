import { LocalModelsShell } from '@/components/local-models/local-models-shell';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Scan local models — ALDO AI',
  description:
    'Discover every local LLM running on your machine and rate it on quality + speed. Runs entirely in your browser. No signup. Nothing leaves localhost.',
  openGraph: {
    title: 'Scan local models — ALDO AI',
    description:
      'Discover every local LLM and rate it on quality × speed. Runs entirely in your browser.',
  },
};

/**
 * `/local-models` — public marketing surface. Discovers local LLMs
 * and rates them on a curated quality × speed eval suite, all
 * client-side. The cloud API server isn't in the path: every byte
 * is between the visitor's browser and `127.0.0.1`.
 */
export default function LocalModelsPage() {
  return (
    <div className="relative overflow-hidden">
      <div aria-hidden className="aldo-hero-blob" />
      <div className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-elevated px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-muted shadow-sm">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span className="text-fg-muted">Public demo · runs in your browser · no signup</span>
          </p>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-fg sm:text-[2.6rem] sm:leading-[1.05]">
            Scan local models.
            <br className="hidden sm:block" />
            <span className="text-accent"> Rate them in seconds.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-fg-muted">
            The browser probes <span className="font-mono text-fg">127.0.0.1</span> for any
            OpenAI-compatible LLM (Ollama, LM Studio, vLLM, llama.cpp), then runs an eight-case eval
            suite — pass/fail per case, TTFT, tokens, reasoning split, tok/s — and streams results
            live as each case finishes.
          </p>
          <ul className="mx-auto mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-fg-muted">
            <Pill>100% client-side</Pill>
            <Pill>No API key</Pill>
            <Pill>Nothing leaves localhost</Pill>
            <Pill>8 eval cases · &lt;2 min</Pill>
          </ul>
        </header>

        <div className="mt-10">
          <LocalModelsShell />
        </div>

        <footer className="mt-12 border-t border-border pt-6 text-center text-xs text-fg-muted">
          <p>
            Want the same loop from your terminal?{' '}
            <code className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-fg">
              aldo bench --suite local-model-rating --model &lt;id&gt;
            </code>
          </p>
          <p className="mt-2">
            <a className="underline hover:text-fg" href="/docs/guides/local-models">
              Read the full local-models guide →
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className="h-1 w-1 rounded-full bg-accent" />
      <span>{children}</span>
    </li>
  );
}
