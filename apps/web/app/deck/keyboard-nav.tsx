'use client';

/**
 * Keyboard navigator for the pitch deck. Tiny client island; the
 * deck content itself is a server component.
 *
 * Bindings:
 *   ArrowDown / PageDown / Space / j  -> next slide
 *   ArrowUp   / PageUp   / k          -> previous slide
 *   Home                              -> first
 *   End                               -> last
 *   f                                 -> toggle fullscreen
 *   ?                                 -> toggle the help overlay
 */

import { useEffect, useState } from 'react';

const PREV_KEYS = new Set(['ArrowUp', 'PageUp', 'k']);
const NEXT_KEYS = new Set(['ArrowDown', 'PageDown', ' ', 'j']);

function scrollToSlide(idx: number) {
  const target = document.getElementById(`slide-${idx}`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function currentSlideIndex(): number {
  const slides = document.querySelectorAll<HTMLElement>('[data-slide]');
  if (slides.length === 0) return 0;
  const mid = window.innerHeight / 2;
  for (let i = 0; i < slides.length; i++) {
    const r = slides[i]?.getBoundingClientRect();
    if (!r) continue;
    if (r.top <= mid && r.bottom >= mid) return i;
  }
  return 0;
}

export function KeyboardNav({ slideCount }: { slideCount: number }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in an input.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (PREV_KEYS.has(e.key)) {
        e.preventDefault();
        scrollToSlide(Math.max(0, currentSlideIndex() - 1));
      } else if (NEXT_KEYS.has(e.key)) {
        e.preventDefault();
        scrollToSlide(Math.min(slideCount - 1, currentSlideIndex() + 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        scrollToSlide(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        scrollToSlide(slideCount - 1);
      } else if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          void document.documentElement.requestFullscreen?.();
        }
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        setHelpOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);

    const onScroll = () => setActive(currentSlideIndex());
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
    };
  }, [slideCount]);

  return (
    <>
      {/* Fixed slide counter + dots in the bottom-right. */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex items-center gap-3">
        <div className="pointer-events-auto rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 font-mono text-[11px] text-slate-200 backdrop-blur">
          {active + 1} / {slideCount}
        </div>
        <button
          type="button"
          aria-label="Show keyboard shortcuts"
          onClick={() => setHelpOpen(true)}
          className="pointer-events-auto rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 font-mono text-[11px] text-slate-300 backdrop-blur transition-colors hover:bg-slate-800"
        >
          ?
        </button>
      </div>

      {/* Help overlay. */}
      {helpOpen ? (
        <div
          aria-modal
          role="dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="rounded-xl border border-slate-700 bg-slate-900 p-6 text-slate-200 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-white">Keyboard</h2>
            <dl className="mt-4 grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 font-mono text-[12px]">
              <dt className="text-slate-400">↓ / Space / j</dt>
              <dd>Next slide</dd>
              <dt className="text-slate-400">↑ / k</dt>
              <dd>Previous slide</dd>
              <dt className="text-slate-400">Home / End</dt>
              <dd>First / last slide</dd>
              <dt className="text-slate-400">f</dt>
              <dd>Toggle fullscreen</dd>
              <dt className="text-slate-400">?</dt>
              <dd>Toggle this help</dd>
              <dt className="text-slate-400">Esc</dt>
              <dd>Close help</dd>
            </dl>
            <button
              type="button"
              className="mt-5 rounded bg-slate-800 px-3 py-1.5 text-[12px] hover:bg-slate-700"
              onClick={() => setHelpOpen(false)}
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
