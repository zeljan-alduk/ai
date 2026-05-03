'use client';

/**
 * "Remove this run from the comparison" × button rendered in each
 * column header. Removing rebuilds the URL with the remaining ids and
 * navigates with `router.replace` so the back-button stays useful.
 */

import { X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

export function NWayRemoveButton({
  ids,
  removeId,
}: {
  ids: readonly string[];
  removeId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const onClick = useCallback(() => {
    const remaining = ids.filter((id) => id !== removeId);
    const next = new URLSearchParams(params?.toString() ?? '');
    if (remaining.length > 0) {
      next.set('ids', remaining.join(','));
      next.delete('a');
      next.delete('b');
    } else {
      next.delete('ids');
      next.delete('a');
      next.delete('b');
    }
    router.replace(`${pathname}?${next.toString()}`);
  }, [ids, removeId, params, pathname, router]);

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`nway-remove-${removeId}`}
      className="ml-1 rounded p-0.5 text-fg-faint hover:bg-bg-subtle hover:text-fg"
      title="Remove this run from the comparison"
      aria-label={`Remove run ${removeId} from the comparison`}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
