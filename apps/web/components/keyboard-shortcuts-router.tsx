'use client';

/**
 * Global keyboard-shortcut router.
 *
 * Mounted once in the root layout. Owns:
 *
 *   - The g-prefix chord state machine (g a, g r, g e, g p, g d, g s,
 *     g h). Pressing `g` enters a 1.5s window during which the next
 *     letter completes the chord; anything else cancels it.
 *   - Single-key globals: `?` opens the keyboard-shortcuts overlay,
 *     `/` focuses the first search input on the current page.
 *   - The `aldo:cmdk:open` window event, which the optional ⌘K hint
 *     button in the sidebar dispatches so it doesn't have to share
 *     state with the palette client island.
 *
 * Cmd-K / Ctrl-K itself is owned by `<CommandPalette/>` because that
 * component holds the open/close state for the palette dialog.
 */

import { KeyboardShortcutsOverlay } from '@/components/keyboard-shortcuts-overlay';
import { INITIAL_CHORD_STATE, isTypingTarget, nextChord } from '@/lib/keyboard-shortcuts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const CHORD_TIMEOUT_MS = 1500;

export function KeyboardShortcutsRouter() {
  const router = useRouter();
  const [overlayOpen, setOverlayOpen] = useState(false);
  // useRef so the keydown handler closes over a stable reference and
  // we don't re-bind the DOM listener on every render.
  const chordRef = useRef(INITIAL_CHORD_STATE);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearChordTimer() {
      if (chordTimerRef.current) {
        clearTimeout(chordTimerRef.current);
        chordTimerRef.current = null;
      }
    }

    function resetChord() {
      chordRef.current = INITIAL_CHORD_STATE;
      clearChordTimer();
    }

    function onKeyDown(e: KeyboardEvent) {
      // Modifier-bearing keys belong to other handlers (Cmd-K, browser
      // shortcuts, focus-cycling). Don't intercept them.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const typing = isTypingTarget(e.target);

      // `?` and `/` are single-key globals that don't go through the
      // chord state machine; `?` requires Shift on most keyboards.
      if (!typing) {
        if (e.key === '?') {
          e.preventDefault();
          resetChord();
          setOverlayOpen(true);
          return;
        }
        if (e.key === '/') {
          // Focus the first search-shaped input on the page.
          const target = findSearchInput();
          if (target) {
            e.preventDefault();
            target.focus();
            // Clear any pre-existing selection so the user types into
            // an empty box, matching GitHub / Linear behaviour.
            if ('select' in target && typeof target.select === 'function') {
              try {
                target.select();
              } catch {
                /* selection refused — non-fatal */
              }
            }
          }
          resetChord();
          return;
        }
        if (e.key === 'Escape') {
          // Cancel any half-typed chord on Esc.
          if (chordRef.current.pending) {
            resetChord();
          }
          // Don't preventDefault — Radix dialogs depend on Esc.
          return;
        }
      }

      const { state, outcome } = nextChord(chordRef.current, e.key, { isTyping: typing });
      chordRef.current = state;

      if (!outcome.consumed) return;

      if (outcome.action === 'enter-chord') {
        clearChordTimer();
        chordTimerRef.current = setTimeout(resetChord, CHORD_TIMEOUT_MS);
        // Don't preventDefault — `g` typed alone is harmless and we
        // don't want to swallow it from any background search field.
        return;
      }

      if (outcome.action === 'navigate') {
        e.preventDefault();
        clearChordTimer();
        router.push(outcome.href);
        return;
      }

      // 'reset' — chord aborted by an unrelated key. Nothing to do.
      clearChordTimer();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearChordTimer();
    };
  }, [router]);

  return <KeyboardShortcutsOverlay open={overlayOpen} onOpenChange={setOverlayOpen} />;
}

/**
 * Find the first plausible search input on the page. We look (in
 * order) for an explicit `[data-search-input]` opt-in, an input with
 * type=search, then a placeholder containing "search". Returns null if
 * nothing fits; the `/` keypress then no-ops gracefully.
 */
function findSearchInput(): (HTMLInputElement | HTMLTextAreaElement) | null {
  const candidates: NodeListOf<Element> = document.querySelectorAll(
    '[data-search-input], input[type="search"], input[placeholder*="earch" i]',
  );
  for (const el of Array.from(candidates)) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (!el.disabled && el.offsetParent !== null) return el;
    }
  }
  return null;
}
