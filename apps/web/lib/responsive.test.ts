import { describe, expect, it } from 'vitest';
import { BREAKPOINTS, breakpointFor, gridColumns, isBelow, navSurfaceFor } from './responsive';

/**
 * Wave-15E — unit tests for the responsive layout primitives.
 *
 * These run in node (no jsdom) because the helpers are pure. The
 * boundary cases mirror Tailwind's `min-width` media-query semantics:
 * exactly-at-the-breakpoint counts as inside.
 */
describe('breakpointFor', () => {
  it('returns undefined for widths below xs', () => {
    expect(breakpointFor(0)).toBeUndefined();
    expect(breakpointFor(360)).toBeUndefined();
    expect(breakpointFor(479)).toBeUndefined();
  });

  it('snaps to xs at 480', () => {
    expect(breakpointFor(480)).toBe('xs');
    expect(breakpointFor(500)).toBe('xs');
    expect(breakpointFor(639)).toBe('xs');
  });

  it('moves to sm/md/lg/xl/2xl at the documented thresholds', () => {
    expect(breakpointFor(640)).toBe('sm');
    expect(breakpointFor(768)).toBe('md');
    expect(breakpointFor(1024)).toBe('lg');
    expect(breakpointFor(1280)).toBe('xl');
    expect(breakpointFor(1536)).toBe('2xl');
  });

  it('treats NaN and Infinity defensively (returns undefined)', () => {
    expect(breakpointFor(Number.NaN)).toBeUndefined();
    expect(breakpointFor(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(breakpointFor(Number.NEGATIVE_INFINITY)).toBeUndefined();
  });
});

describe('isBelow', () => {
  it('is exclusive of the breakpoint itself', () => {
    expect(isBelow(1023, 'lg')).toBe(true);
    expect(isBelow(1024, 'lg')).toBe(false);
    expect(isBelow(BREAKPOINTS.md, 'md')).toBe(false);
  });

  it('the iPhone SE (360) sits below every named breakpoint', () => {
    for (const key of Object.keys(BREAKPOINTS) as Array<keyof typeof BREAKPOINTS>) {
      expect(isBelow(360, key)).toBe(true);
    }
  });
});

describe('navSurfaceFor', () => {
  it('returns drawer below lg and docked at lg+', () => {
    expect(navSurfaceFor(360)).toBe('drawer');
    expect(navSurfaceFor(768)).toBe('drawer');
    expect(navSurfaceFor(1023)).toBe('drawer');
    expect(navSurfaceFor(1024)).toBe('docked');
    expect(navSurfaceFor(1440)).toBe('docked');
  });
});

describe('gridColumns', () => {
  it('is single-column on mobile regardless of desktop count', () => {
    expect(gridColumns(360, 12)).toBe(1);
    expect(gridColumns(767, 6)).toBe(1);
  });

  it('caps at 2 on tablet (md but below lg)', () => {
    expect(gridColumns(768, 12)).toBe(2);
    expect(gridColumns(900, 4)).toBe(2);
    // If the desktop count is already 1, tablet stays at 1.
    expect(gridColumns(800, 1)).toBe(1);
  });

  it('honours the requested column count above lg, clamped to 1..12', () => {
    expect(gridColumns(1440, 4)).toBe(4);
    expect(gridColumns(1024, 12)).toBe(12);
    expect(gridColumns(1024, 0)).toBe(1);
    expect(gridColumns(1024, 99)).toBe(12);
  });
});
