/**
 * Skeleton — pulsing placeholder for loading states.
 *
 * Compose by giving width/height utilities:
 *   <Skeleton className="h-4 w-32" />
 *   <Skeleton className="h-9 w-full" />
 *
 * Token-driven so dark mode flips automatically.
 */

import { cn } from '@/lib/cn';
import type { HTMLAttributes } from 'react';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-bg-subtle', className)}
      aria-hidden
      {...props}
    />
  );
}
