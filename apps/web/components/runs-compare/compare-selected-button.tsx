'use client';

/**
 * "Compare" button for the /runs top bar. Renders only when EXACTLY
 * two run ids are passed in via `selectedIds`; navigates to
 * `/runs/compare?a=<first>&b=<second>` when clicked.
 *
 * Engineer 13A owns the selection state on the runs list (multi-row
 * selection + bulk-action bar). This component is the cooperative
 * entry point — 13A wires `selectedIds` from their state into the
 * button when it surfaces. Disabled when 0, 1, or 3+ rows are
 * selected so the operator gets the visual hint.
 *
 * LLM-agnostic: accepts opaque run-id strings; no provider branching.
 */

import Link from 'next/link';

export function CompareSelectedButton({
  selectedIds,
  className,
}: {
  selectedIds: ReadonlyArray<string>;
  className?: string;
}) {
  const enabled = selectedIds.length === 2;
  const baseClasses =
    className ??
    'rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 transition-colors';

  if (!enabled) {
    return (
      <button
        type="button"
        disabled
        className={`${baseClasses} cursor-not-allowed opacity-50`}
        title={
          selectedIds.length === 0
            ? 'Select two runs to compare'
            : selectedIds.length === 1
              ? 'Select one more run'
              : 'Compare supports exactly two runs'
        }
      >
        Compare ({selectedIds.length}/2)
      </button>
    );
  }

  const [a, b] = selectedIds;
  return (
    <Link
      href={`/runs/compare?a=${encodeURIComponent(a ?? '')}&b=${encodeURIComponent(b ?? '')}`}
      className={`${baseClasses} hover:bg-slate-50`}
    >
      Compare
    </Link>
  );
}
