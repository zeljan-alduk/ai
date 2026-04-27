'use client';

/**
 * Tabs primitive — Radix-backed.
 *
 * Surface mirrors shadcn/ui: `<Tabs>`, `<TabsList>`, `<TabsTrigger>`,
 * `<TabsContent>`. Active trigger gets a 2px underline in the accent
 * colour; inactive triggers fade hover -> fg. All token-driven so
 * dark mode just works.
 */

import { cn } from '@/lib/cn';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...rest }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('flex items-center gap-1 border-b border-border', className)}
    {...rest}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...rest }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative -mb-px rounded-t-md px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg',
      'data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:text-fg',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      className,
    )}
    {...rest}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...rest }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-4 focus-visible:outline-none', className)}
    {...rest}
  />
));
TabsContent.displayName = 'TabsContent';
