/**
 * Wave-13 — bell badge state tests.
 *
 * The bell component itself is mostly side-effects (SSE, popover, fetch);
 * the pure piece worth pinning is the unread-count → badge mapping.
 *
 * Tests:
 *   - 0 → no badge
 *   - 1..9 → exact number
 *   - 10+ → "9+"
 */

import { describe, expect, it } from 'vitest';
import { unreadCountBadge } from './notification-bell.js';

describe('unreadCountBadge', () => {
  it('returns null when there are no unread notifications', () => {
    expect(unreadCountBadge(0)).toBeNull();
    expect(unreadCountBadge(-3)).toBeNull();
  });

  it('renders an exact number for small values', () => {
    expect(unreadCountBadge(1)).toBe('1');
    expect(unreadCountBadge(9)).toBe('9');
  });

  it('caps display at "9+" for double-digit unread counts', () => {
    expect(unreadCountBadge(10)).toBe('9+');
    expect(unreadCountBadge(42)).toBe('9+');
    expect(unreadCountBadge(9999)).toBe('9+');
  });
});
