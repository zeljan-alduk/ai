'use client';

/**
 * Platform demo loop — replaces the old DemoVideoPlaceholder iframe.
 *
 * Five-scene auto-advancing loop that walks a visitor through the
 * platform mechanics without a recorded video:
 *
 *   1. Spec    — author a YAML agent (privacy_tier highlighted)
 *   2. Route   — gateway picks a model under the privacy constraint
 *   3. Run     — run-tree streams events end-to-end
 *   4. Eval    — eval gate blocks/passes promotion
 *   5. Swap    — replay a node against a different model, side-by-side
 *
 * Every visual is code (Tailwind + small SVGs) — no video file, no
 * third-party host, no boot tax. Loops on a 7s-per-scene cadence;
 * the user can pause, scrub, or jump to a scene with the controls.
 *
 * LLM-agnostic: the demo names "ollama / llama-3.1-70b" and
 * "openai / gpt-4o" as opaque example strings to make the routing
 * mechanics legible. Nothing in the runtime branches on these names.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SCENE_COUNT = 5;
const SCENE_MS = 7000;

const SCENES = [
  {
    id: 'spec',
    label: 'Author',
    title: 'Agents are data',
    subtitle: 'YAML spec — versioned, eval-gated before promotion.',
  },
  {
    id: 'route',
    label: 'Route',
    title: 'Gateway picks the model',
    subtitle: 'Capability + privacy tier — provider names live in config, not code.',
  },
  {
    id: 'run',
    label: 'Run',
    title: 'Every step is a checkpoint',
    subtitle: 'Stream events to the run tree as they happen — fully replayable.',
  },
  {
    id: 'eval',
    label: 'Gate',
    title: 'Eval gates promotion',
    subtitle: 'A regression on the suite blocks the version. CI for agents.',
  },
  {
    id: 'swap',
    label: 'Replay',
    title: 'Swap a model, see the diff',
    subtitle: 'Re-run any node against another model. Side-by-side, same prompt.',
  },
] as const;

export function PlatformDemoLoop() {
  const [scene, setScene] = useState(0);
  const [paused, setPaused] = useState(false);
  const lastTickRef = useRef<number>(Date.now());

  useEffect(() => {
    if (paused) return;
    lastTickRef.current = Date.now();
    const t = window.setInterval(() => {
      setScene((s) => (s + 1) % SCENE_COUNT);
    }, SCENE_MS);
    return () => window.clearInterval(t);
  }, [paused]);

  const goTo = useCallback((idx: number) => {
    setScene(idx);
    lastTickRef.current = Date.now();
  }, []);

  const current = SCENES[scene] ?? SCENES[0];

  return (
    <div className="mt-10 overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-sm">
      {/* Title strip */}
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-fg-muted">
            Scene {scene + 1} / {SCENE_COUNT} — {current?.label}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-fg">{current?.title}</div>
          <div className="text-xs text-fg-muted">{current?.subtitle}</div>
        </div>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg hover:bg-bg-subtle"
          aria-label={paused ? 'Play demo loop' : 'Pause demo loop'}
        >
          {paused ? '▶ Play' : '❚❚ Pause'}
        </button>
      </div>

      {/* Stage */}
      <div className="relative h-[22rem] bg-bg">
        <SceneFrame visible={scene === 0}>
          <SpecScene />
        </SceneFrame>
        <SceneFrame visible={scene === 1}>
          <RouteScene />
        </SceneFrame>
        <SceneFrame visible={scene === 2}>
          <RunScene />
        </SceneFrame>
        <SceneFrame visible={scene === 3}>
          <EvalScene />
        </SceneFrame>
        <SceneFrame visible={scene === 4}>
          <SwapScene />
        </SceneFrame>
      </div>

      {/* Scrubber */}
      <div className="flex items-center gap-2 border-t border-border px-5 py-2.5">
        {SCENES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => goTo(i)}
            className={`group flex flex-1 flex-col gap-1 ${
              i === scene ? 'text-fg' : 'text-fg-muted hover:text-fg'
            }`}
            aria-current={i === scene ? 'step' : undefined}
            aria-label={`Jump to scene ${i + 1}: ${s.label}`}
          >
            <span className="text-[10px] uppercase tracking-wider">{s.label}</span>
            <span
              className={`h-1 w-full rounded-full ${
                i === scene
                  ? 'bg-fg'
                  : i < scene
                    ? 'bg-fg-muted'
                    : 'bg-border group-hover:bg-border-strong'
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function SceneFrame({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`absolute inset-0 transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      aria-hidden={!visible}
    >
      {visible ? children : null}
    </div>
  );
}

// ──────────────────────────────── Scene 1: Spec ────────────────────────────────

const YAML_LINES = [
  'name: financial-summarizer',
  'version: 0.4.2',
  'privacy_tier: sensitive',
  'model_policy:',
  '  capability_requirements: [reasoning, 200k-context]',
  '  primary: { capability_class: reasoning-large }',
  'eval_gate:',
  '  suite: finance_v1',
  '  min_score: 0.85',
  '  must_pass_before_promote: true',
];

function SpecScene() {
  const lines = useTypedReveal(YAML_LINES, 250);
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-xl rounded-lg border border-slate-300 bg-slate-950 font-mono text-[13px] leading-relaxed text-slate-100 shadow-md">
        <div className="flex items-center gap-1.5 border-b border-slate-800 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="ml-2 text-[11px] text-slate-400">agents/financial-summarizer.yaml</span>
        </div>
        <pre className="whitespace-pre p-4 text-[12.5px]">
          {lines.map((line, i) => (
            <div key={`${i}:${line}`} className={highlightYamlLine(line) ? 'text-amber-300' : ''}>
              {line || ' '}
            </div>
          ))}
          <span className="inline-block h-3 w-1.5 animate-pulse bg-slate-300 align-baseline" />
        </pre>
      </div>
    </div>
  );
}

function highlightYamlLine(line: string): boolean {
  return line.startsWith('privacy_tier') || line.includes('eval_gate');
}

// ──────────────────────────────── Scene 2: Route ───────────────────────────────

type RouteProvider = {
  readonly provider: string;
  readonly model: string;
  readonly tier: 'cloud' | 'local';
  readonly allowed: boolean;
  readonly picked?: boolean;
};

const ROUTE_PROVIDERS: ReadonlyArray<RouteProvider> = [
  { provider: 'openai', model: 'gpt-4o', tier: 'cloud', allowed: false },
  { provider: 'anthropic', model: 'claude-sonnet-4', tier: 'cloud', allowed: false },
  { provider: 'ollama', model: 'llama-3.1-70b', tier: 'local', allowed: true, picked: true },
  { provider: 'vllm', model: 'qwen-72b', tier: 'local', allowed: true },
];

function RouteScene() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-xl">
        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 font-medium text-danger">
            privacy_tier: sensitive
          </span>
          <span className="text-fg-faint">→</span>
          <span className="text-fg-muted">router enforces, agent author cannot bypass</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-sm">
          <div className="border-b border-border bg-bg-subtle px-4 py-2 text-[11px] uppercase tracking-wider text-fg-muted">
            Model gateway — capability: reasoning-large
          </div>
          <ul className="divide-y divide-border">
            {ROUTE_PROVIDERS.map((p, i) => (
              <li
                key={`${p.provider}/${p.model}`}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-500 ${
                  p.allowed ? 'opacity-100' : 'opacity-50'
                }`}
                style={{ transitionDelay: `${i * 250}ms` }}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                    p.allowed
                      ? p.picked
                        ? 'bg-success text-white'
                        : 'bg-success/15 text-success'
                      : 'bg-danger/15 text-danger'
                  }`}
                  aria-hidden
                >
                  {p.allowed ? '✓' : '✕'}
                </span>
                <span className="font-mono text-[13px] text-fg">
                  {p.provider} / {p.model}
                </span>
                <span className="text-[11px] uppercase tracking-wider text-fg-faint">{p.tier}</span>
                <span className="ml-auto text-[11px] text-fg-muted">
                  {p.allowed
                    ? p.picked
                      ? 'picked — fail-closed'
                      : 'eligible'
                    : 'blocked: cloud + sensitive'}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-3 text-center text-[11px] text-fg-muted">
          Switching providers is a config change. The router is the invariant.
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────── Scene 3: Run ─────────────────────────────────

const RUN_EVENTS = [
  { kind: 'run.started', detail: 'agent=financial-summarizer • model=ollama/llama-3.1-70b', ms: 0 },
  { kind: 'tool_call', detail: 'fs.read("Q3-results.pdf")', ms: 240 },
  { kind: 'tool_result', detail: '8 pages, 12,400 tokens', ms: 380 },
  { kind: 'message', detail: 'streaming summary…', ms: 1200 },
  { kind: 'checkpoint', detail: 'cp_a14f — replayable', ms: 1280 },
  { kind: 'tool_call', detail: 'sql.query("SELECT … FROM revenue")', ms: 1500 },
  { kind: 'tool_result', detail: '24 rows', ms: 1640 },
  { kind: 'run.completed', detail: '2.4s • 1,820 tok • $0.0011', ms: 2400 },
] as const;

function RunScene() {
  const visible = useStaggeredReveal(RUN_EVENTS.length, 600);
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-xl rounded-lg border border-border bg-bg-elevated shadow-sm">
        <div className="flex items-center justify-between border-b border-border bg-bg-subtle px-4 py-2 text-[11px] uppercase tracking-wider text-fg-muted">
          <span>Run tree — live</span>
          <span className="flex items-center gap-1 normal-case tracking-normal text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            streaming
          </span>
        </div>
        <ol className="divide-y divide-border">
          {RUN_EVENTS.map((e, i) => (
            <li
              key={`${e.kind}-${i}`}
              className={`flex items-baseline gap-3 px-4 py-2 text-sm transition-all duration-300 ${
                i < visible ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
              }`}
            >
              <span className="w-12 font-mono text-[10px] tabular-nums text-fg-faint">
                +{e.ms}ms
              </span>
              <EventBadge kind={e.kind} />
              <span className="font-mono text-[12px] text-fg">{e.detail}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function EventBadge({ kind }: { kind: string }) {
  // Tone classes use the design tokens for surfaces (success/warning/
  // danger/accent are already theme-aware) and a slight transparency
  // for the muted backgrounds so the badge sits on either light or
  // dark page backgrounds.
  const tone =
    kind === 'tool_call'
      ? 'bg-accent/10 text-accent border-accent/30'
      : kind === 'tool_result'
        ? 'bg-bg-subtle text-fg border-border'
        : kind === 'checkpoint'
          ? 'bg-warning/10 text-warning border-warning/30'
          : kind === 'run.completed'
            ? 'bg-success/10 text-success border-success/30'
            : 'bg-accent/10 text-accent border-accent/30';
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tone}`}
    >
      {kind}
    </span>
  );
}

// ──────────────────────────────── Scene 4: Eval ────────────────────────────────

const EVAL_ROWS = [
  { name: 'numerical accuracy', score: 0.93, threshold: 0.85 },
  { name: 'citation fidelity', score: 0.91, threshold: 0.9 },
  { name: 'no-hallucination check', score: 0.96, threshold: 0.85 },
  { name: 'tone & brevity', score: 0.88, threshold: 0.8 },
];

function EvalScene() {
  const visible = useStaggeredReveal(EVAL_ROWS.length, 500);
  const composite = EVAL_ROWS.reduce((s, r) => s + r.score, 0) / EVAL_ROWS.length;
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-xl rounded-lg border border-border bg-bg-elevated shadow-sm">
        <div className="flex items-center justify-between border-b border-border bg-bg-subtle px-4 py-2 text-[11px] uppercase tracking-wider text-fg-muted">
          <span>Eval suite — finance_v1</span>
          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 normal-case tracking-normal text-success">
            promote — gate passed
          </span>
        </div>
        <ul className="divide-y divide-border px-4 py-2">
          {EVAL_ROWS.map((r, i) => (
            <li
              key={r.name}
              className={`py-2 transition-all duration-500 ${
                i < visible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <div className="flex items-baseline justify-between text-[12.5px]">
                <span className="text-fg">{r.name}</span>
                <span className="font-mono tabular-nums text-fg">
                  {r.score.toFixed(2)}{' '}
                  <span className="text-[10px] text-fg-faint">/ {r.threshold.toFixed(2)}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-subtle">
                <div
                  className="h-full rounded-full bg-success transition-all duration-700"
                  style={{ width: i < visible ? `${Math.min(r.score * 100, 100)}%` : '0%' }}
                />
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t border-border bg-bg-subtle px-4 py-2 text-center text-[12px] text-fg">
          composite <span className="font-mono font-semibold text-fg">{composite.toFixed(2)}</span>{' '}
          ≥ 0.85 → version <span className="font-mono">0.4.2</span> promoted
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────── Scene 5: Swap ────────────────────────────────

function SwapScene() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <div className="mb-2 text-center text-[11px] uppercase tracking-wider text-fg-muted">
          /runs/compare — same prompt, two models
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SwapPane
            tag="A — original"
            model="ollama / llama-3.1-70b"
            cost="$0.0011"
            tokens="1,820"
            output="Q3 revenue grew 18% YoY to $214M, driven by a 31% rise in net new ARR. Citation: pg.4."
          />
          <SwapPane
            tag="B — swap"
            model="openai / gpt-4o"
            cost="$0.0094"
            tokens="1,640"
            output="Q3 revenue: $214M (+18% YoY). Net new ARR up 31%, the largest single-quarter gain on record."
            tone="amber"
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
          <Delta label="Cost Δ" value="+$0.0083" tone="amber" />
          <Delta label="Tokens Δ" value="−180" tone="neutral" />
          <Delta label="Same agent" value="yes" tone="neutral" />
        </div>
        <div className="mt-3 text-center text-[11px] text-fg-muted">
          Replay any node against any model — without changing a line of agent code.
        </div>
      </div>
    </div>
  );
}

function SwapPane({
  tag,
  model,
  cost,
  tokens,
  output,
  tone = 'neutral',
}: {
  tag: string;
  model: string;
  cost: string;
  tokens: string;
  output: string;
  tone?: 'neutral' | 'amber';
}) {
  const ring =
    tone === 'amber' ? 'border-warning/40 bg-warning/10' : 'border-border bg-bg-elevated';
  return (
    <div className={`rounded-lg border ${ring} px-3 py-2.5 shadow-sm`}>
      <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-fg-muted">
        <span>{tag}</span>
        <span className="font-mono normal-case tracking-normal text-fg">{cost}</span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-fg-muted">{model}</div>
      <div className="mt-2 text-[12px] leading-snug text-fg">{output}</div>
      <div className="mt-2 text-[10px] text-fg-faint">{tokens} tokens</div>
    </div>
  );
}

function Delta({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'amber' | 'neutral';
}) {
  return (
    <div
      className={`rounded border px-2 py-1.5 ${
        tone === 'amber' ? 'border-warning/40 bg-warning/10' : 'border-border bg-bg-subtle'
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="mt-0.5 font-mono text-[12px] tabular-nums text-fg">{value}</div>
    </div>
  );
}

// ──────────────────────────────── Hooks ────────────────────────────────────────

/** Reveal lines one-by-one for a typed-out feel. */
function useTypedReveal(lines: ReadonlyArray<string>, intervalMs: number): ReadonlyArray<string> {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    const t = window.setInterval(() => {
      setCount((c) => {
        if (c >= lines.length) {
          window.clearInterval(t);
          return c;
        }
        return c + 1;
      });
    }, intervalMs);
    return () => window.clearInterval(t);
  }, [lines, intervalMs]);
  return useMemo(() => lines.slice(0, count), [lines, count]);
}

/** Stagger N items into view, one per `intervalMs`. Returns count visible. */
function useStaggeredReveal(total: number, intervalMs: number): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    const t = window.setInterval(() => {
      setCount((c) => {
        if (c >= total) {
          window.clearInterval(t);
          return c;
        }
        return c + 1;
      });
    }, intervalMs);
    return () => window.clearInterval(t);
  }, [total, intervalMs]);
  return count;
}
