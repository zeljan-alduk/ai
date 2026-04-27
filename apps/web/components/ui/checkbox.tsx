/**
 * Checkbox primitive — token-driven <input type="checkbox">.
 *
 * Wave-13 added this primitive for the bulk-action affordance on
 * /runs. We use a native HTML checkbox (rather than a Radix
 * `Checkbox` Root) because:
 *
 *   1. The accessibility surface (keyboard, focus, indeterminate
 *      via the DOM property) is already correct on <input>.
 *   2. Server-rendered list pages don't need a controlled-component
 *      wrapper just to check a box; the parent owns the selection
 *      state and we simply read `checked`.
 *
 * The `indeterminate` prop is wired through a ref-callback because the
 * HTML spec only exposes it as a DOM property, not an attribute. The
 * "select all" header checkbox uses it to render the partial-selection
 * tristate.
 */

import { cn } from '@/lib/cn';
import { type InputHTMLAttributes, forwardRef, useCallback, useEffect, useRef } from 'react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** When true, render the tri-state "some selected" hatching. */
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate, ...rest }, forwardedRef) => {
    const innerRef = useRef<HTMLInputElement | null>(null);

    const setRefs = useCallback(
      (el: HTMLInputElement | null) => {
        innerRef.current = el;
        if (typeof forwardedRef === 'function') forwardedRef(el);
        else if (forwardedRef) forwardedRef.current = el;
      },
      [forwardedRef],
    );

    useEffect(() => {
      if (innerRef.current) {
        innerRef.current.indeterminate = Boolean(indeterminate);
      }
    }, [indeterminate]);

    return (
      <input
        ref={setRefs}
        type="checkbox"
        className={cn(
          'h-4 w-4 rounded border-border bg-bg-elevated text-fg accent-fg',
          'focus:outline-none focus:ring-2 focus:ring-ring/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...rest}
      />
    );
  },
);
Checkbox.displayName = 'Checkbox';
