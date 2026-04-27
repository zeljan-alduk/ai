'use client';

/**
 * Command-palette primitives — cmdk-backed surface.
 *
 * The actual app-level command palette (with global Cmd-K hotkey,
 * tenant-scoped result sources, and routing) lives at
 * `components/command-palette.tsx`. This file is the *primitive*: a
 * thin token-driven wrapper around `cmdk` (the de-facto Cmd-K
 * library, MIT). Surface mirrors shadcn/ui:
 *
 *   <CommandDialog open={…} onOpenChange={…}>
 *     <CommandInput placeholder="Search…" />
 *     <CommandList>
 *       <CommandEmpty>No results.</CommandEmpty>
 *       <CommandGroup heading="Agents">
 *         <CommandItem>…</CommandItem>
 *       </CommandGroup>
 *     </CommandList>
 *   </CommandDialog>
 */

import { cn } from '@/lib/cn';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  forwardRef,
} from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

export const Command = forwardRef<
  ElementRef<typeof CommandPrimitive>,
  ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      'flex h-full w-full flex-col overflow-hidden rounded-md bg-bg-elevated text-fg',
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

export interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function CommandDialog({ open, onOpenChange, children }: CommandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wave-15E — on small screens the palette becomes a full-screen
          surface (top-anchored) so result rows and the input have
          breathing room and 44px touch targets. From `sm:` up we
          revert to the original centred modal. */}
      <DialogContent className="left-0 top-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none p-0 shadow-2xl sm:left-1/2 sm:top-1/2 sm:h-auto sm:w-[90vw] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg">
        {/* Title + description are visually hidden but exist for SR. */}
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search agents, runs, models, and settings.
        </DialogDescription>
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-muted">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b border-border px-3" cmdk-input-wrapper="">
    <Search className="mr-2 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-md bg-transparent py-3 text-sm text-fg outline-none placeholder:text-fg-faint disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

export const CommandList = forwardRef<
  ElementRef<typeof CommandPrimitive.List>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn(
      // Wave-15E — fill the full-screen palette on mobile, but cap at
      // 360px on `sm:` and above so the centred modal still feels like
      // a focus target rather than a take-over surface.
      'max-h-[calc(100vh-3.5rem)] overflow-y-auto overflow-x-hidden sm:max-h-[360px]',
      className,
    )}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

export const CommandEmpty = forwardRef<
  ElementRef<typeof CommandPrimitive.Empty>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cn('py-8 text-center text-sm text-fg-muted', className)}
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

export const CommandGroup = forwardRef<
  ElementRef<typeof CommandPrimitive.Group>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn('overflow-hidden p-1 text-fg', className)}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

export const CommandSeparator = forwardRef<
  ElementRef<typeof CommandPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 h-px bg-border', className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

export const CommandItem = forwardRef<
  ElementRef<typeof CommandPrimitive.Item>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      // Wave-15E — `min-h-touch` (44px) hits the WCAG target-size
      // floor on phones; `sm:min-h-[36px]` keeps the desktop density.
      "relative flex min-h-touch cursor-default select-none items-center gap-2 rounded-sm px-2 py-2 text-sm text-fg outline-none aria-selected:bg-bg-subtle aria-selected:text-fg data-[disabled='true']:pointer-events-none data-[disabled='true']:opacity-50 sm:min-h-[36px]",
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

export function CommandShortcut({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('ml-auto text-xs tracking-widest text-fg-faint', className)} {...props} />
  );
}
