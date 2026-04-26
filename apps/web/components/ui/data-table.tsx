/**
 * DataTable — token-driven table primitives with a sticky header.
 *
 * Composable: `<Table>`, `<TableHeader>`, `<TableBody>`, `<TableRow>`,
 * `<TableHead>` (header cell), `<TableCell>`. The header sticks to
 * `top: 0` of its scroll container. Sorting is the caller's
 * responsibility — Engineer T's sortable variant in wave 13 will add
 * a `<SortableHeader>` on top.
 */

import { cn } from '@/lib/cn';
import {
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
  forwardRef,
} from 'react';

export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table
        ref={ref}
        className={cn('w-full caption-bottom text-sm text-fg', className)}
        {...props}
      />
    </div>
  ),
);
Table.displayName = 'Table';

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'sticky top-0 z-10 bg-bg-subtle text-xs uppercase tracking-wider text-fg-muted [&_tr]:border-b [&_tr]:border-border',
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

export const TableFooter = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t border-border bg-bg-subtle font-medium text-fg', className)}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-border transition-colors hover:bg-bg-subtle/60 data-[state=selected]:bg-bg-subtle',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

export const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'h-10 px-3 text-left align-middle font-medium [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = 'TableHead';

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn('p-3 align-middle [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  ),
);
TableCell.displayName = 'TableCell';
