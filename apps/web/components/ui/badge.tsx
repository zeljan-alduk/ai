/**
 * Badge — small status / metadata pill.
 *
 * Variants: default (accent), secondary (muted), success, warning,
 * destructive, outline. Always inline-flex so an icon child aligns
 * with the label.
 */

import { cn } from '@/lib/cn';
import { type VariantProps, cva } from 'class-variance-authority';
import { type HTMLAttributes, forwardRef } from 'react';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider',
  {
    variants: {
      variant: {
        default: 'border-accent/30 bg-accent/10 text-accent',
        secondary: 'border-border bg-bg-subtle text-fg-muted',
        success: 'border-success/30 bg-success/10 text-success',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        destructive: 'border-danger/30 bg-danger/10 text-danger',
        outline: 'border-border bg-transparent text-fg-muted',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { badgeVariants };
