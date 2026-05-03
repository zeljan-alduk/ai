/**
 * Pure-function tests for the keyboard-shortcut router. We don't boot
 * jsdom here — the chord-state machine and the `isTypingTarget` guard
 * are intentionally pure over inputs we can fabricate (a bare object
 * for the typing guard, a string key for the state machine).
 */

import { describe, expect, it } from 'vitest';

import {
  GO_SHORTCUTS,
  INITIAL_CHORD_STATE,
  STATIC_SHORTCUT_DOCS,
  isTypingTarget,
  nextChord,
} from './keyboard-shortcuts.js';

describe('isTypingTarget', () => {
  it('returns false for null', () => {
    expect(isTypingTarget(null)).toBe(false);
  });

  it('returns false for a non-element object (no tagName)', () => {
    // The guard is duck-typed but still requires a tagName so a stray
    // POJO doesn't accidentally count as a typing surface.
    const fake = { isContentEditable: true, getAttribute: () => null } as unknown as EventTarget;
    expect(isTypingTarget(fake)).toBe(false);
  });

  it('returns true for INPUT, TEXTAREA, SELECT', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const target = {
        tagName,
        isContentEditable: false,
        getAttribute: () => null,
      } as unknown as EventTarget;
      expect(isTypingTarget(target)).toBe(true);
    }
  });

  it('is case-insensitive on tagName (lowercase still matches)', () => {
    const target = {
      tagName: 'input',
      isContentEditable: false,
      getAttribute: () => null,
    } as unknown as EventTarget;
    expect(isTypingTarget(target)).toBe(true);
  });

  it('returns true for a contentEditable element', () => {
    const target = {
      tagName: 'DIV',
      isContentEditable: true,
      getAttribute: () => null,
    } as unknown as EventTarget;
    expect(isTypingTarget(target)).toBe(true);
  });

  it('returns true for role="combobox" / "searchbox" / "textbox"', () => {
    for (const role of ['combobox', 'searchbox', 'textbox']) {
      const target = {
        tagName: 'DIV',
        isContentEditable: false,
        getAttribute: (n: string) => (n === 'role' ? role : null),
      } as unknown as EventTarget;
      expect(isTypingTarget(target)).toBe(true);
    }
  });

  it('returns false for an unrelated DIV', () => {
    const target = {
      tagName: 'DIV',
      isContentEditable: false,
      getAttribute: () => null,
    } as unknown as EventTarget;
    expect(isTypingTarget(target)).toBe(false);
  });
});

describe('nextChord — g-prefix state machine', () => {
  it('does NOT enter a chord when the user is typing in an input', () => {
    const { state, outcome } = nextChord(INITIAL_CHORD_STATE, 'g', { isTyping: true });
    expect(state).toEqual(INITIAL_CHORD_STATE);
    expect(outcome).toEqual({ consumed: false });
  });

  it('does NOT navigate from a pending chord when the user starts typing', () => {
    const { state, outcome } = nextChord({ pending: true }, 'a', { isTyping: true });
    expect(state).toEqual(INITIAL_CHORD_STATE);
    expect(outcome).toEqual({ consumed: false });
  });

  it('enters chord on bare `g`', () => {
    const { state, outcome } = nextChord(INITIAL_CHORD_STATE, 'g', { isTyping: false });
    expect(state.pending).toBe(true);
    expect(outcome).toEqual({ consumed: true, action: 'enter-chord' });
  });

  it('completes "g a" → /agents', () => {
    const { state, outcome } = nextChord({ pending: true }, 'a', { isTyping: false });
    expect(state.pending).toBe(false);
    expect(outcome).toEqual({ consumed: true, action: 'navigate', href: '/agents' });
  });

  it('completes every documented chord', () => {
    for (const s of GO_SHORTCUTS) {
      const { outcome } = nextChord({ pending: true }, s.key, { isTyping: false });
      expect(outcome).toEqual({ consumed: true, action: 'navigate', href: s.href });
    }
  });

  it('an unrecognised second key resets the chord without firing', () => {
    const { state, outcome } = nextChord({ pending: true }, 'q', { isTyping: false });
    expect(state.pending).toBe(false);
    expect(outcome).toEqual({ consumed: true, action: 'reset' });
  });

  it('a non-`g` key in the initial state is ignored', () => {
    const { state, outcome } = nextChord(INITIAL_CHORD_STATE, 'x', { isTyping: false });
    expect(state).toEqual(INITIAL_CHORD_STATE);
    expect(outcome).toEqual({ consumed: false });
  });
});

describe('STATIC_SHORTCUT_DOCS', () => {
  it('lists Cmd-K, /, ?, Esc — the four global keys outside the chord set', () => {
    const chords = STATIC_SHORTCUT_DOCS.map((d) => d.chord);
    expect(chords.some((c) => c.includes('K'))).toBe(true);
    expect(chords).toContain('/');
    expect(chords).toContain('?');
    expect(chords).toContain('Esc');
  });
});
