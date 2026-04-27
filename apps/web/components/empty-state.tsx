/**
 * Legacy empty-state shim.
 *
 * The canonical implementation lives at `components/ui/empty-state.tsx`
 * and ships with the wave-12 design system. This file re-exports the
 * same component so the older import path (`@/components/empty-state`)
 * keeps resolving — every existing call-site in /agents, /runs,
 * /eval, /models, /secrets, etc. continues to render without churn.
 *
 * New code should import from `@/components/ui/empty-state` directly.
 */

export { EmptyState } from './ui/empty-state';
export type { EmptyStateProps } from './ui/empty-state';
