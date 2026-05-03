'use client';

/**
 * "Compare" button for the /runs top bar. Wave-4 (2026-05-03) — bumped
 * from a 2-only constraint to N (≥2, soft-capped at MAX_RUNS=6 to
 * match the comparison panel's readable ceiling). Selecting more than
 * MAX_RUNS rows truncates with a tooltip explaining the cap.
 *
 * LLM-agnostic: accepts opaque run-id strings; no provider branching.
 */

import Link from 'next/link';
import { MAX_RUNS } from './n-way/n-way-rows';

export function CompareSelectedButton({
  selectedIds,
  className,
}: {
  selectedIds: ReadonlyArray<string>;
  className?: string;
}) {
  const baseClasses =
    className ??
    'rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 transition-colors';

  if (selectedIds.length < 2) {
    return (
      <button
        type="button"
        disabled
        className={`${baseClasses} cursor-not-allowed opacity-50`}
        title={
          selectedIds.length === 0
            ? `Select 2–${MAX_RUNS} runs to compare`
            : `Select at least one more run (up to ${MAX_RUNS} total)`
        }
      >
        Compare ({selectedIds.length}/{MAX_RUNS})
      </button>
    );
  }

  const capped = selectedIds.slice(0, MAX_RUNS);
  const wasTruncated = selectedIds.length > MAX_RUNS;
  const ids = capped.map((id) => encodeURIComponent(id)).join(',');
  return (
    <Link
      href={`/runs/compare?ids=${ids}`}
      className={`${baseClasses} hover:bg-slate-50`}
      title={
        wasTruncated
          ? `Comparison panel optimized for ≤${MAX_RUNS} runs — only the first ${MAX_RUNS} will be opened`
          : `Open ${capped.length}-way comparison`
      }
    >
      Compare ({capped.length})
    </Link>
  );
}
