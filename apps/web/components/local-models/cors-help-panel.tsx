'use client';

/**
 * Shown when every probe failed AND the failures all looked like
 * `TypeError: Failed to fetch` — most likely cause: the local LLM
 * is running but didn't return an `Access-Control-Allow-Origin`
 * header. Browsers can't distinguish "CORS denied" from "port closed"
 * so we explain both possibilities and give per-runtime fixes.
 */

import { useState } from 'react';

interface Props {
  readonly onRetry: () => void;
}

const RECIPES: ReadonlyArray<{
  runtime: string;
  port: string;
  command: string;
  hint: string;
}> = [
  {
    runtime: 'Ollama',
    port: '11434',
    command: 'OLLAMA_ORIGINS="*" ollama serve',
    hint: 'Restart Ollama with the env var. Set it permanently via launchctl on macOS or systemd unit on Linux.',
  },
  {
    runtime: 'LM Studio',
    port: '1234',
    command: 'Toggle "Enable CORS" in Local Server panel',
    hint: 'Server → Settings → "Enable CORS". No restart needed.',
  },
  {
    runtime: 'vLLM',
    port: '8000',
    command: 'vllm serve … --allowed-origins \'["*"]\'',
    hint: 'Add to your serve command. Use the host instead of `*` for production.',
  },
  {
    runtime: 'llama.cpp',
    port: '8080',
    command: './llama-server … --api-cors "*"',
    hint: 'Pass --api-cors at startup.',
  },
];

export function CorsHelpPanel({ onRetry }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="overflow-hidden rounded-xl border border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20">
      <div className="border-b border-amber-500/20 bg-amber-500/10 px-5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
          One-time setup
        </p>
        <h3 className="mt-1 text-sm font-semibold text-fg">
          Your local LLM is running, but it's not allowing the browser to talk to it.
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
          The page runs entirely client-side: the browser fetches{' '}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[11px] text-fg">
            127.0.0.1
          </code>{' '}
          directly. That's blocked by default on most local LLM servers — flip CORS on once and it
          works thereafter. Pick your runtime:
        </p>
      </div>

      <ul className="divide-y divide-border bg-bg">
        {RECIPES.map((r) => (
          <li
            key={r.runtime}
            className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:gap-4"
          >
            <div className="min-w-[140px]">
              <p className="text-sm font-semibold text-fg">{r.runtime}</p>
              <p className="font-mono text-[10px] text-fg-muted">port {r.port}</p>
            </div>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(r.command);
                  setCopied(r.runtime);
                  setTimeout(() => setCopied((cur) => (cur === r.runtime ? null : cur)), 1500);
                }}
                className="group flex w-full items-center justify-between gap-3 rounded-md border border-border bg-bg-subtle px-3 py-2 text-left font-mono text-[12px] text-fg hover:border-accent/50"
                title="Click to copy"
              >
                <span className="truncate">{r.command}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-fg-muted group-hover:text-accent">
                  {copied === r.runtime ? 'Copied!' : 'Copy'}
                </span>
              </button>
              <p className="mt-1 text-[11px] text-fg-muted">{r.hint}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-bg-subtle/40 px-5 py-3">
        <p className="text-[11px] text-fg-muted">Already configured? Hit rescan.</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg shadow-sm hover:shadow-md"
          >
            Rescan now
          </button>
        </div>
      </div>
    </div>
  );
}
