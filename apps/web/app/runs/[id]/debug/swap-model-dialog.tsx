'use client';

/**
 * Modal for picking either a capability class or a specific
 * provider+model to swap into. Provider/model strings are opaque — we
 * never hardcode any of them.
 */

import type { ModelSummary } from '@aldo-ai/api-contract';
import { useMemo, useState } from 'react';

type Mode = 'capability' | 'model';

export function SwapModelDialog({
  models,
  currentCapabilityClass,
  onCancel,
  onConfirm,
}: {
  models: ReadonlyArray<ModelSummary>;
  currentCapabilityClass?: string;
  onCancel: () => void;
  onConfirm: (sel: { capabilityClass?: string; provider?: string; model?: string }) => void;
}) {
  const capabilityClasses = useMemo(() => {
    const set = new Set<string>();
    for (const m of models) set.add(m.capabilityClass);
    return Array.from(set).sort();
  }, [models]);

  const [mode, setMode] = useState<Mode>('capability');
  const [capability, setCapability] = useState<string>(
    currentCapabilityClass ?? capabilityClasses[0] ?? '',
  );
  const [modelId, setModelId] = useState<string>(models[0]?.id ?? '');

  const submit = () => {
    if (mode === 'capability') {
      if (!capability) return;
      onConfirm({ capabilityClass: capability });
    } else {
      const m = models.find((x) => x.id === modelId);
      if (!m) return;
      onConfirm({ provider: m.provider, model: m.id });
    }
  };

  return (
    <Backdrop onClose={onCancel}>
      <div className="w-[28rem] max-w-full rounded-md border border-slate-200 bg-white shadow-lg">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
          Swap model from current checkpoint
        </div>
        <div className="flex flex-col gap-4 px-4 py-4 text-sm">
          <div className="flex gap-2">
            <ModeBtn active={mode === 'capability'} onClick={() => setMode('capability')}>
              By capability
            </ModeBtn>
            <ModeBtn active={mode === 'model'} onClick={() => setMode('model')}>
              By model
            </ModeBtn>
          </div>
          {mode === 'capability' ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">
                Capability class
              </span>
              <select
                value={capability}
                onChange={(e) => setCapability(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {capabilityClasses.length === 0 ? (
                  <option value="">(no capability classes available)</option>
                ) : (
                  capabilityClasses.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))
                )}
              </select>
              <span className="text-[11px] text-slate-500">
                Gateway will pick a model with this capability that satisfies the run's privacy
                tier.
              </span>
            </label>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">
                Provider / model
              </span>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {models.length === 0 ? (
                  <option value="">(no models available)</option>
                ) : (
                  models.map((m) => (
                    <option key={`${m.provider}/${m.id}`} value={m.id} disabled={!m.available}>
                      {m.provider} / {m.id} ({m.capabilityClass})
                      {m.available ? '' : ' — unavailable'}
                    </option>
                  ))
                )}
              </select>
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Swap and resume
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-1 text-xs ${
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: native <dialog> open semantics differ; this is a controlled overlay */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation on inner shell only — keyboard escape is handled by the backdrop above */}
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
