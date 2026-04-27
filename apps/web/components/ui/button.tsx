/**
 * Button — the primitive everyone in the design system relies on.
 *
 * Variants:
 *   - default      — accent background, primary action
 *   - secondary    — neutral filled, secondary action on white surface
 *   - ghost        — no background, hover only (toolbar / inline)
 *   - destructive  — red accent, irreversible action
 *   - link         — text-only with underline-on-hover
 *
 * Sizes: sm, md, lg, icon.
 *
 * The `asChild` prop forwards classes to the child element via
 * Radix's Slot — useful for `<Button asChild><Link href="...">`
 * which renders one DOM element instead of nesting an <a> in a
 * <button>.
 *
 * LLM-agnostic at the styling layer (no provider concerns).
 */

import { cn } from '@/lib/cn';
import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import { type ButtonHTMLAttributes, forwardRef } from 'react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:bg-accent-hover',
        secondary: 'bg-bg-elevated text-fg border border-border hover:bg-bg-subtle',
        ghost: 'text-fg hover:bg-bg-subtle',
        destructive: 'bg-danger text-white hover:bg-danger/90',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Forward styles onto a child element (e.g. a `next/link` <Link>). */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
