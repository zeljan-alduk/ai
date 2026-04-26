/**
 * Input primitive — token-driven <input>.
 *
 * Focus state uses the global ring colour so light + dark feel
 * consistent. Placeholder uses `text-fg-faint` so it stays legible
 * on both surfaces.
 */

import { cn } from '@/lib/cn';
import { type InputHTMLAttributes, forwardRef } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...rest }, ref) => {
    return (
      <input
        ref={ref}
        type={type ?? 'text'}
        className={cn(
          'h-9 w-full rounded-md border border-border bg-bg-elevated px-3 text-sm text-fg placeholder:text-fg-faint',
          'focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...rest}
      />
    );
  },
);
Input.displayName = 'Input';
