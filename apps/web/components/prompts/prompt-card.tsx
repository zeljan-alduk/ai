/**
 * Card for one prompt in the /prompts gallery.
 *
 * Server-component-friendly — no React state. The capability badge
 * is rendered as an opaque string (LLM-agnostic; the gateway
 * resolves the actual model at /test time).
 */

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/format';
import Link from 'next/link';

export interface PromptCardData {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly latestVersion: number;
  readonly modelCapability: string;
  readonly updatedAt: string;
}

export function PromptCard({ prompt }: { prompt: PromptCardData }) {
  return (
    <Card
      className="group flex flex-col overflow-hidden transition-shadow hover:shadow-md"
      data-testid="prompt-card"
    >
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/prompts/${encodeURIComponent(prompt.id)}`}
            className="block min-w-0 flex-1 truncate text-sm font-semibold text-fg group-hover:underline"
          >
            {prompt.name}
          </Link>
          <span className="shrink-0 rounded-full bg-bg-subtle px-2 py-0.5 text-[10px] font-medium tabular-nums text-fg-muted">
            v{prompt.latestVersion}
          </span>
        </div>
        {prompt.description ? (
          <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{prompt.description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-end gap-2 p-4 pt-0">
        <div className="flex flex-wrap gap-1">
          <Badge
            variant="secondary"
            className="font-mono text-[10px] uppercase tracking-wide"
            title="LLM-agnostic capability class — the gateway resolves the actual model"
          >
            {prompt.modelCapability}
          </Badge>
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t border-border p-3 text-[11px] text-fg-muted">
        <span className="tabular-nums">
          {prompt.latestVersion === 1 ? '1 version' : `${prompt.latestVersion} versions`}
        </span>
        <span title={prompt.updatedAt}>updated {formatRelativeTime(prompt.updatedAt)}</span>
      </CardFooter>
    </Card>
  );
}
