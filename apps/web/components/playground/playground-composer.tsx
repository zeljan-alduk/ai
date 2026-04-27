'use client';

/**
 * Top input area for /playground.
 *
 * Two `@uiw/react-textarea-code-editor` panes (system + user) plus a
 * capability-class multi-select stand-in (free-form input — the
 * gateway treats classes as opaque) and a privacy-tier dropdown. The
 * Run button kicks off `onRun()`; when streaming, button is disabled
 * and the status pill shows "streaming…".
 *
 * LLM-agnostic: capability class + privacy are the only routing
 * inputs the UI offers.
 */

import { Card, CardContent } from '@/components/ui/card';
import { formatUsd } from '@/lib/format';
import type { PrivacyTier } from '@aldo-ai/api-contract';
import dynamic from 'next/dynamic';
import type { PlaygroundStatus } from './playground-shell.js';

// `@uiw/react-textarea-code-editor` ships with browser-only deps; load
// it dynamically so the SSR pass doesn't blow up.
const CodeEditor = dynamic(() => import('@uiw/react-textarea-code-editor').then((m) => m.default), {
  ssr: false,
});

const CAPABILITY_CLASSES: ReadonlyArray<string> = [
  'reasoning-medium',
  'reasoning-large',
  'local-reasoning',
  'tool-use-fast',
  'embeddings',
];

const PRIVACY_TIERS: ReadonlyArray<PrivacyTier> = ['public', 'internal', 'sensitive'];

export function PlaygroundComposer({
  systemPrompt,
  userPrompt,
  capabilityClass,
  privacy,
  status,
  error,
  onSystemChange,
  onUserChange,
  onCapabilityChange,
  onPrivacyChange,
  onRun,
  runningTotal,
}: {
  systemPrompt: string;
  userPrompt: string;
  capabilityClass: string;
  privacy: PrivacyTier;
  status: PlaygroundStatus;
  error: string | null;
  onSystemChange: (v: string) => void;
  onUserChange: (v: string) => void;
  onCapabilityChange: (v: string) => void;
  onPrivacyChange: (v: PrivacyTier) => void;
  onRun: () => void;
  runningTotal: number;
}) {
  const streaming = status === 'streaming';
  const canRun = !streaming && userPrompt.trim().length > 0;

  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
        <div>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: CodeEditor renders a focusable contenteditable, not an input element. */}
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-500">
            System prompt (optional)
          </label>
          <CodeEditor
            value={systemPrompt}
            language="markdown"
            placeholder="You are a helpful assistant…"
            onChange={(e) => onSystemChange(e.target.value)}
            data-color-mode="light"
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              minHeight: 120,
              borderRadius: 4,
              border: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
            }}
          />
        </div>
        <div>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: CodeEditor renders a focusable contenteditable, not an input element. */}
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-500">
            User message
          </label>
          <CodeEditor
            value={userPrompt}
            language="markdown"
            placeholder="Ask the model something…"
            onChange={(e) => onUserChange(e.target.value)}
            data-color-mode="light"
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              minHeight: 120,
              borderRadius: 4,
              border: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
            }}
          />
        </div>
        <div className="lg:col-span-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Capability class</span>
            <select
              value={capabilityClass}
              onChange={(e) => onCapabilityChange(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              aria-label="Capability class"
            >
              {CAPABILITY_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Privacy</span>
            <select
              value={privacy}
              onChange={(e) => onPrivacyChange(e.target.value as PrivacyTier)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              aria-label="Privacy tier"
            >
              {PRIVACY_TIERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto flex items-center gap-3 text-xs">
            <span className="font-mono text-slate-500">total: {formatUsd(runningTotal)}</span>
            <button
              type="button"
              onClick={onRun}
              disabled={!canRun}
              className={
                canRun
                  ? 'rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800'
                  : 'rounded bg-slate-300 px-3 py-1 text-sm font-medium text-white'
              }
            >
              {streaming ? 'streaming…' : 'Run'}
            </button>
          </span>
          {error ? (
            <div className="lg:col-span-2 w-full rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
