'use client';

/**
 * Popover — Radix-backed floating panel.
 *
 * Surface mirrors shadcn/ui: `<Popover>`, `<PopoverTrigger>`,
 * `<PopoverContent>`. Used for filter pickers, model-detail
 * pop-outs, etc. Token-driven so dark mode flips automatically.
 */

import { cn } from '@/lib/cn';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 rounded-md border border-border bg-bg-elevated p-4 text-fg shadow-lg outline-none',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;
