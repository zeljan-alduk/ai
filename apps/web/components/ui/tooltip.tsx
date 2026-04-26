'use client';

/**
 * Tooltip — Radix-backed.
 *
 * Use `<TooltipProvider>` once near the root, then for each tooltip:
 *   <Tooltip>
 *     <TooltipTrigger asChild><Button>…</Button></TooltipTrigger>
 *     <TooltipContent>Body</TooltipContent>
 *   </Tooltip>
 *
 * Token-driven; arrow inherits the elevated bg.
 */

import { cn } from '@/lib/cn';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-50 overflow-hidden rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-fg shadow-md',
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;
