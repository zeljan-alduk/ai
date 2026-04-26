'use client';

/**
 * Sheet — side-drawer surface, Radix Dialog under the hood.
 *
 * Surface mirrors shadcn/ui: `<Sheet>`, `<SheetTrigger>`,
 * `<SheetContent>` (with a `side` prop), `<SheetHeader>`,
 * `<SheetTitle>`, `<SheetDescription>`, `<SheetClose>`. The `side`
 * prop chooses which edge to anchor to. Token-driven so dark mode
 * just works.
 */

import { cn } from '@/lib/cn';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  forwardRef,
} from 'react';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-fg/40 backdrop-blur-sm', className)}
    {...props}
  />
));
SheetOverlay.displayName = 'SheetOverlay';

export type SheetSide = 'left' | 'right' | 'top' | 'bottom';

const SIDE_CLASSES: Record<SheetSide, string> = {
  right: 'inset-y-0 right-0 h-full w-[420px] border-l',
  left: 'inset-y-0 left-0 h-full w-[420px] border-r',
  top: 'inset-x-0 top-0 w-full max-h-[60vh] border-b',
  bottom: 'inset-x-0 bottom-0 w-full max-h-[60vh] border-t',
};

export interface SheetContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: SheetSide;
}

export const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, side = 'right', ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 overflow-y-auto border-border bg-bg-elevated p-6 text-fg shadow-xl focus:outline-none',
        SIDE_CLASSES[side],
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className="absolute right-4 top-4 rounded-sm text-fg-muted opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/40"
        aria-label="Close"
      >
        <X className="h-4 w-4" aria-hidden />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = 'SheetContent';

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-3 flex flex-col gap-1', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export const SheetTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold text-fg', className)}
    {...props}
  />
));
SheetTitle.displayName = 'SheetTitle';

export const SheetDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-fg-muted', className)}
    {...props}
  />
));
SheetDescription.displayName = 'SheetDescription';
