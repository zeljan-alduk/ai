'use client';

/**
 * Right pane: imperative controls for the current run.
 * Continue / Step / Swap model / Cancel.
 */

export function ControlsPane({
  paused,
  terminal,
  currentCapabilityClass,
  onContinue,
  onStep,
  onSwap,
  onCancel,
}: {
  paused: boolean;
  terminal: boolean;
  currentCapabilityClass?: string;
  onContinue: () => void;
  onStep: () => void;
  onSwap: () => void;
  onCancel: () => void;
}) {
  const continueDisabled = terminal || !paused;
  const stepDisabled = terminal || !paused;
  const swapDisabled = terminal;
  const cancelDisabled = terminal;

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Controls</div>
      <button
        type="button"
        onClick={onContinue}
        disabled={continueDisabled}
        className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Continue
      </button>
      <button
        type="button"
        onClick={onStep}
        disabled={stepDisabled}
        className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
      >
        Step
      </button>
      <div className="rounded border border-slate-200 bg-slate-50 p-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">Capability class</div>
        <div
          className="mt-0.5 truncate text-xs font-medium text-slate-800"
          title={currentCapabilityClass}
        >
          {currentCapabilityClass ?? 'unknown'}
        </div>
        <button
          type="button"
          onClick={onSwap}
          disabled={swapDisabled}
          className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Swap model from here
        </button>
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={cancelDisabled}
        className="mt-auto w-full rounded border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
      >
        Cancel run
      </button>
      <p className="text-[11px] leading-relaxed text-slate-500">
        Continue/Step require a paused run. Swap forks from the most recent checkpoint and navigates
        to the new run.
      </p>
    </aside>
  );
}
