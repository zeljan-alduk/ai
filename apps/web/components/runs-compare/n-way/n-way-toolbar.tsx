'use client';

/**
 * Toolbar for the N-way `/runs/compare` view: filter toggles + the
 * permalink button. Lifted out as its own client island so the rest
 * of the page can stay server-rendered.
 *
 * "Show only diffs" + "Show only metrics" are URL-driven (`?diffs=1`,
 * `?metrics=1`) so the view round-trips through saved-views and back-
 * button navigation without a re-fetch.
 */

import { Check, Copy, Filter, Sigma } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

export function NWayToolbar({
  showOnlyDiffs,
  showOnlyMetrics,
}: {
  showOnlyDiffs: boolean;
  showOnlyMetrics: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [copied, setCopied] = useState(false);

  const setFlag = useCallback(
    (name: 'diffs' | 'metrics', on: boolean) => {
      const next = new URLSearchParams(params?.toString() ?? '');
      if (on) next.set(name, '1');
      else next.delete(name);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const onCopy = useCallback(() => {
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}${pathname}?${params?.toString() ?? ''}`
        : '';
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      });
    }
  }, [params, pathname]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setFlag('diffs', !showOnlyDiffs)}
        aria-pressed={showOnlyDiffs}
        data-testid="nway-toggle-diffs"
        className={
          showOnlyDiffs
            ? 'inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
            : 'inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-bg-subtle'
        }
      >
        <Filter className="h-3.5 w-3.5" />
        Show only diffs
      </button>
      <button
        type="button"
        onClick={() => setFlag('metrics', !showOnlyMetrics)}
        aria-pressed={showOnlyMetrics}
        data-testid="nway-toggle-metrics"
        className={
          showOnlyMetrics
            ? 'inline-flex items-center gap-1.5 rounded-md border border-sky-400 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-900 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-200'
            : 'inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-bg-subtle'
        }
      >
        <Sigma className="h-3.5 w-3.5" />
        Show only metrics
      </button>
      <button
        type="button"
        onClick={onCopy}
        data-testid="nway-permalink"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-bg-subtle"
        title="Copy a shareable URL with the current run set"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {copied ? 'Copied' : 'Permalink'}
      </button>
    </div>
  );
}
