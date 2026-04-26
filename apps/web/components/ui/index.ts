/**
 * Design-system primitives barrel.
 *
 * Wave-12 ships the full shadcn/ui-style surface: button, card, badge,
 * dialog, dropdown-menu, popover, sheet, tabs, tooltip, toast,
 * skeleton, data-table, empty-state, chart-container, and the cmdk
 * command-palette wrapper. All are token-driven and dark-mode-aware.
 *
 * Call sites should `import { Button } from '@/components/ui'` rather
 * than reaching into the file directly — that lets us reorganise the
 * directory without churning every consumer.
 *
 * No provider names anywhere — LLM-agnostic at the styling layer.
 */

export * from './badge';
export * from './button';
export * from './card';
export * from './chart-container';
export * from './checkbox';
export * from './command-palette';
export * from './data-table';
export * from './dialog';
export * from './dropdown-menu';
export * from './empty-state';
export * from './input';
export * from './popover';
export * from './sheet';
export * from './skeleton';
export * from './tabs';
export * from './toast';
export * from './tooltip';
