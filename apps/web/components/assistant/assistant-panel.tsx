'use client';

/**
 * Assistant chat panel — floating bottom-right.
 *
 * MISSING_PIECES §10 — the assistant route now drives an
 * `IterativeAgentRun` with the synthetic `__assistant__` spec, so
 * tool calls flow through as `{ type: 'tool', ... }` SSE frames in
 * addition to the existing `delta` text. The panel renders an inline
 * tile per call → result pair so the user sees the agent's reasoning
 * trail rather than just text.
 *
 * Mounted by app/layout.tsx alongside the command palette. Visible
 * only when NEXT_PUBLIC_ASSISTANT_ENABLED=true so the chrome stays
 * dormant on deployments where the backend ASSISTANT_ENABLED is off.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { API_BASE } from '@/lib/api';

interface ChatMessage {
  readonly kind: 'message';
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /** True while the assistant message is still streaming. */
  readonly streaming?: boolean;
  /** Set once the `done` event lands. */
  readonly meta?: {
    readonly model?: string;
    readonly tokensIn?: number;
    readonly tokensOut?: number;
    readonly latencyMs?: number;
  };
}

interface ToolMessage {
  readonly kind: 'tool';
  readonly callId: string;
  readonly name: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly isError: boolean;
}

type Entry = ChatMessage | ToolMessage;

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the message list when new content arrives.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries]);

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);
    setDraft('');
    const userEntry: ChatMessage = { kind: 'message', role: 'user', content: text };
    const placeholder: ChatMessage = {
      kind: 'message',
      role: 'assistant',
      content: '',
      streaming: true,
    };
    setEntries((cur) => [...cur, userEntry, placeholder]);
    setBusy(true);

    // For the request body, only send the chat messages — tool entries
    // are platform-internal and the assistant agent rebuilds them
    // from history. The assistant's prior text replies count.
    const chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const e of entries) {
      if (e.kind === 'message' && (e.role === 'user' || e.role === 'assistant')) {
        chatHistory.push({ role: e.role, content: e.content });
      }
    }
    chatHistory.push({ role: 'user', content: text });

    try {
      const res = await fetch(`${API_BASE}/v1/assistant/stream`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: chatHistory }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${txt || 'request failed'}`);
      }
      if (!res.body) throw new Error('no response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let acc = '';
      let meta: ChatMessage['meta'] | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          try {
            const ev = JSON.parse(dataLine.slice(5).trim()) as
              | { type: 'delta'; text: string }
              | {
                  type: 'tool';
                  name: string;
                  callId: string;
                  args: unknown;
                  result: unknown;
                  isError?: boolean;
                }
              | {
                  type: 'done';
                  model?: string;
                  tokensIn?: number;
                  tokensOut?: number;
                  latencyMs?: number;
                }
              | { type: 'error'; message: string };
            if (ev.type === 'delta') {
              acc += ev.text;
              setEntries((cur) => updateStreamingAssistant(cur, acc));
            } else if (ev.type === 'tool') {
              // MISSING_PIECES §10 — tool tile. Insert BEFORE the
              // currently-streaming assistant placeholder so the
              // chronological ordering reads "user → tool call(s) →
              // assistant text".
              const tile: ToolMessage = {
                kind: 'tool',
                callId: ev.callId,
                name: ev.name,
                args: ev.args,
                result: ev.result,
                isError: ev.isError === true,
              };
              setEntries((cur) => insertToolBeforePlaceholder(cur, tile));
            } else if (ev.type === 'done') {
              meta = {
                ...(ev.model !== undefined ? { model: ev.model } : {}),
                ...(ev.tokensIn !== undefined ? { tokensIn: ev.tokensIn } : {}),
                ...(ev.tokensOut !== undefined ? { tokensOut: ev.tokensOut } : {}),
                ...(ev.latencyMs !== undefined ? { latencyMs: ev.latencyMs } : {}),
              };
            } else if (ev.type === 'error') {
              throw new Error(ev.message);
            }
          } catch (e) {
            // Malformed line — skip; the next done/error will surface failure.
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
      // Finalise: drop streaming flag, attach meta if present.
      setEntries((cur) => finaliseStreamingAssistant(cur, acc, meta));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Drop the streaming placeholder on error.
      setEntries((cur) => dropStreamingPlaceholder(cur));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <>
      {/* Launcher button — bottom-right, always visible when feature flag on. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg ring-1 ring-accent/40 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          aria-label="Open ALDO assistant"
        >
          <ChatIcon />
        </button>
      )}

      {/* Panel — floating card, fixed bottom-right. */}
      {open && (
        <aside
          role="complementary"
          aria-label="ALDO assistant"
          className="fixed bottom-5 right-5 z-40 flex h-[560px] max-h-[80vh] w-[400px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 text-accent">
                <ChatIcon size={16} />
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-fg">ALDO assistant</div>
                <div className="text-[10px] uppercase tracking-wider text-fg-faint">
                  iterative · tools enabled
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close assistant"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {entries.length === 0 && (
              <div className="rounded-lg border border-dashed border-border bg-bg-subtle/40 px-3 py-3 text-[13px] leading-relaxed text-fg-muted">
                <p className="font-medium text-fg">Hi — I&rsquo;m the ALDO assistant.</p>
                <p className="mt-1">
                  Ask about agents, runs, prompts, the gateway, MCP servers, privacy tiers.
                  When read-only filesystem tools are enabled I can also peek at files in
                  your workspace to answer specific questions.
                </p>
              </div>
            )}
            {entries.map((e, i) => (
              <EntryRow key={`${e.kind}-${i}`} entry={e} />
            ))}
            {error && (
              <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[12px] text-danger">
                ⚠ {error}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border bg-bg-subtle/40 px-3 py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask anything…"
                rows={1}
                disabled={busy}
                className="min-h-[36px] max-h-32 flex-1 resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || draft.trim().length === 0}
                className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? '…' : 'Send'}
              </button>
            </div>
            <div className="mt-1.5 text-[10px] text-fg-faint">
              Enter to send · Shift+Enter for newline
            </div>
          </div>
        </aside>
      )}
    </>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  if (entry.kind === 'tool') return <ToolTile entry={entry} />;
  const isUser = entry.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-lg px-3 py-2 text-[13px] leading-relaxed',
          isUser
            ? 'bg-accent/15 text-fg ring-1 ring-accent/20'
            : 'bg-bg text-fg ring-1 ring-border',
        )}
      >
        {entry.content || (entry.streaming && '…')}
        {entry.meta && (
          <div className="mt-1.5 font-mono text-[10px] text-fg-faint">
            {entry.meta.model ?? '?'} · {entry.meta.latencyMs ?? '?'} ms ·{' '}
            {entry.meta.tokensIn ?? '?'}/{entry.meta.tokensOut ?? '?'} tok
          </div>
        )}
      </div>
    </div>
  );
}

function ToolTile({ entry }: { entry: ToolMessage }) {
  return (
    <details
      data-testid={`tool-tile-${entry.callId}`}
      className={cn(
        'group rounded-md border px-3 py-2 text-[12px] font-mono',
        entry.isError
          ? 'border-danger/40 bg-danger/5 text-fg'
          : 'border-border bg-bg-subtle/40 text-fg-muted',
      )}
    >
      <summary className="flex cursor-pointer items-center gap-2 list-none">
        <span
          className={cn(
            'inline-flex h-4 items-center rounded px-1.5 text-[10px] uppercase tracking-wider',
            entry.isError
              ? 'bg-danger/15 text-danger'
              : 'bg-accent/15 text-accent',
          )}
        >
          {entry.isError ? 'error' : 'tool'}
        </span>
        <span className="font-semibold text-fg">{entry.name}</span>
        <span className="ml-auto text-[10px] text-fg-faint">{entry.callId.slice(0, 8)}</span>
      </summary>
      <div className="mt-2 space-y-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-faint">args</div>
          <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-bg px-2 py-1 text-[11px] text-fg ring-1 ring-border">
            {stringify(entry.args)}
          </pre>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-faint">result</div>
          <pre className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-bg px-2 py-1 text-[11px] text-fg ring-1 ring-border">
            {stringify(entry.result)}
          </pre>
        </div>
      </div>
    </details>
  );
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// ─── pure entry mutators (exported for unit tests) ────────────────

export function updateStreamingAssistant(cur: readonly Entry[], acc: string): Entry[] {
  const last = cur[cur.length - 1];
  if (
    !last ||
    last.kind !== 'message' ||
    last.role !== 'assistant' ||
    !last.streaming
  )
    return [...cur];
  return [...cur.slice(0, -1), { ...last, content: acc }];
}

export function insertToolBeforePlaceholder(
  cur: readonly Entry[],
  tile: ToolMessage,
): Entry[] {
  const last = cur[cur.length - 1];
  if (
    !last ||
    last.kind !== 'message' ||
    last.role !== 'assistant' ||
    !last.streaming
  ) {
    return [...cur, tile];
  }
  return [...cur.slice(0, -1), tile, last];
}

export function finaliseStreamingAssistant(
  cur: readonly Entry[],
  acc: string,
  meta: ChatMessage['meta'] | undefined,
): Entry[] {
  const last = cur[cur.length - 1];
  if (
    !last ||
    last.kind !== 'message' ||
    last.role !== 'assistant' ||
    !last.streaming
  )
    return [...cur];
  return [
    ...cur.slice(0, -1),
    {
      ...last,
      content: acc || last.content,
      streaming: false,
      ...(meta ? { meta } : {}),
    },
  ];
}

export function dropStreamingPlaceholder(cur: readonly Entry[]): Entry[] {
  const last = cur[cur.length - 1];
  if (
    !last ||
    last.kind !== 'message' ||
    last.role !== 'assistant' ||
    !last.streaming
  )
    return [...cur];
  return cur.slice(0, -1);
}

export type { ChatMessage, ToolMessage, Entry };

function ChatIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
