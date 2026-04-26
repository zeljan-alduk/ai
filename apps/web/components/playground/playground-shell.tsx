'use client';

/**
 * Top-level client island for /playground.
 *
 * State is the column map (`PlaygroundColumns`); transitions are the
 * pure `applyFrame` reducer. SSE consumed via the auth-proxy fetch
 * with `text/event-stream` so the proxy injects the bearer token.
 *
 * LLM-agnostic: every model id / provider string is opaque; the UI
 * never branches on a specific name.
 */

import { AUTH_PROXY_PREFIX } from '@/lib/api';
import {
  type PlaygroundFrame,
  PlaygroundFrame as PlaygroundFrameSchema,
  type PrivacyTier,
} from '@aldo-ai/api-contract';
import { useCallback, useState } from 'react';
import { PlaygroundColumns as PlaygroundColumnsView } from './playground-columns.js';
import { PlaygroundComposer } from './playground-composer.js';
import { PlaygroundOutputDiff } from './playground-output-diff.js';
import {
  type ColumnState,
  type PlaygroundColumns,
  allTerminal,
  applyFrame,
  emptyColumns,
  totalUsd,
} from './playground-state.js';
import { SaveAsEvalCaseButton } from './save-as-eval-case-button.js';

export type PlaygroundStatus = 'idle' | 'streaming' | 'done' | 'error';

export function PlaygroundShell() {
  const [columns, setColumns] = useState<PlaygroundColumns>(emptyColumns);
  const [status, setStatus] = useState<PlaygroundStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [userPrompt, setUserPrompt] = useState<string>('');
  const [capabilityClass, setCapabilityClass] = useState<string>('reasoning-medium');
  const [privacy, setPrivacy] = useState<PrivacyTier>('public');

  const onRun = useCallback(async () => {
    if (status === 'streaming') return;
    setError(null);
    setColumns(emptyColumns());
    setStatus('streaming');
    try {
      const res = await fetch(`${AUTH_PROXY_PREFIX}/v1/playground/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        credentials: 'include',
        body: JSON.stringify({
          system: systemPrompt.trim().length > 0 ? systemPrompt : undefined,
          messages: [{ role: 'user', content: userPrompt }],
          capabilityClass,
          privacy,
          stream: true,
        }),
      });
      if (!res.ok || res.body === null) {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          const env = JSON.parse(text) as { error?: { message?: string; code?: string } };
          if (env.error?.message) msg = env.error.message;
          if (env.error?.code === 'privacy_tier_unroutable') {
            msg = `Privacy fail-closed: ${env.error.message ?? 'no eligible model'}`;
          }
        } catch {
          // fall through with the HTTP status
        }
        setError(msg);
        setStatus('error');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let local: PlaygroundColumns = emptyColumns();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          idx = buf.indexOf('\n\n');
          const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
          if (dataLine === undefined) continue;
          const json = dataLine.slice('data:'.length).trim();
          if (json.length === 0) continue;
          try {
            const parsed = PlaygroundFrameSchema.parse(JSON.parse(json));
            local = applyFrame(local, parsed satisfies PlaygroundFrame);
            setColumns(local);
          } catch {
            // Bad frame — skip; the column-level error frame would
            // surface server-side issues anyway.
          }
        }
      }
      setStatus(allTerminal(local) ? 'done' : 'idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'streaming failed');
      setStatus('error');
    }
  }, [systemPrompt, userPrompt, capabilityClass, privacy, status]);

  const allCols = Array.from(columns.values());

  return (
    <div className="flex flex-col gap-4">
      <PlaygroundComposer
        systemPrompt={systemPrompt}
        userPrompt={userPrompt}
        capabilityClass={capabilityClass}
        privacy={privacy}
        status={status}
        error={error}
        onSystemChange={setSystemPrompt}
        onUserChange={setUserPrompt}
        onCapabilityChange={setCapabilityClass}
        onPrivacyChange={setPrivacy}
        onRun={onRun}
        runningTotal={totalUsd(columns)}
      />
      <PlaygroundColumnsView columns={allCols} />
      {allCols.length >= 2 ? <PlaygroundOutputDiff columns={allCols} /> : null}
      {allCols.length > 0 ? (
        <SaveAsEvalCaseButton
          systemPrompt={systemPrompt}
          userPrompt={userPrompt}
          firstColumn={allCols[0] ?? null}
        />
      ) : null}
    </div>
  );
}

export type { ColumnState };
