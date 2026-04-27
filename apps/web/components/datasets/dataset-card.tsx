/**
 * Card for one dataset in the /datasets gallery.
 *
 * Server-component-friendly — no React state. Mobile-friendly: uses
 * the wave-12 Card primitive's responsive padding.
 */

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/format';
import Link from 'next/link';

const TAG_LIMIT = 4;

export interface DatasetCardData {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: ReadonlyArray<string>;
  readonly exampleCount: number;
  readonly updatedAt: string;
}

export function DatasetCard({ dataset }: { dataset: DatasetCardData }) {
  const visible = dataset.tags.slice(0, TAG_LIMIT);
  const hidden = Math.max(0, dataset.tags.length - TAG_LIMIT);
  return (
    <Card className="flex flex-col" data-testid="dataset-card">
      <CardHeader className="p-4 pb-2">
        <Link
          href={`/datasets/${encodeURIComponent(dataset.id)}`}
          className="block truncate text-sm font-semibold text-fg hover:underline"
        >
          {dataset.name}
        </Link>
        {dataset.description ? (
          <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{dataset.description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 p-4 pt-0">
        <div className="flex flex-wrap gap-1">
          {visible.map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px]">
              {t}
            </Badge>
          ))}
          {hidden > 0 ? <span className="text-[10px] text-fg-faint">+{hidden} more</span> : null}
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t border-border p-3 text-[11px] text-fg-muted">
        <span className="tabular-nums">
          {dataset.exampleCount} example{dataset.exampleCount === 1 ? '' : 's'}
        </span>
        <span title={dataset.updatedAt}>updated {formatRelativeTime(dataset.updatedAt)}</span>
      </CardFooter>
    </Card>
  );
}
