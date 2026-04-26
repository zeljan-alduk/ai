/**
 * `cn()` — the tiny class-name helper used throughout the design system.
 *
 * Wraps `clsx` (conditional joining) with `tailwind-merge` (smart
 * de-duplication of conflicting Tailwind classes). The combination is
 * the de-facto pattern across the shadcn/ui-style component world: it
 * lets a primitive declare default classes and a caller override them
 * without the order-of-classnames footgun (e.g. passing `bg-red-500`
 * after a default `bg-slate-900` actually wins, instead of being
 * silently overridden by stylesheet order).
 *
 * LLM-agnostic: no provider concerns at the styling layer.
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
