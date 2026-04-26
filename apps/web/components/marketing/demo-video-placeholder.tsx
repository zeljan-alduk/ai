'use client';

/**
 * Wave-14C — Demo video placeholder above the fold.
 *
 * A thumbnail with a play button that opens a YouTube embed in a
 * modal Dialog. Hardcoded URL with a `TODO(launch)` so the launch
 * checklist swaps in the real video. We deliberately don't claim a
 * demo exists yet — the thumbnail copy says "60-second walkthrough
 * (preview)".
 */

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useState } from 'react';

// TODO(launch): swap to the real recorded walkthrough URL once filmed.
// Leave the parameters (`?rel=0&modestbranding=1`) — they hide
// related-video chrome and the YouTube wordmark.
const PLACEHOLDER_VIDEO = 'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1';

export function DemoVideoPlaceholder() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-10 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="group relative flex w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-slate-100 via-blue-50 to-slate-100 px-4 py-16 text-center transition hover:from-slate-50"
          >
            <div className="flex flex-col items-center gap-3">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-md transition-transform group-hover:scale-105">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path d="M5 3.5v13l11-6.5z" />
                </svg>
              </span>
              <span className="text-sm font-medium text-slate-700">
                Watch the 60-second walkthrough <span className="text-slate-400">(preview)</span>
              </span>
              <span className="text-xs text-slate-500">
                Real run-tree, real model swap, real privacy enforcement.
              </span>
            </div>
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl bg-black p-0">
          <DialogTitle className="sr-only">ALDO AI walkthrough</DialogTitle>
          <div className="aspect-video w-full">
            {/* The iframe only mounts when the dialog is open, so we
                don't pay a YouTube boot tax on every landing-page hit. */}
            {open ? (
              <iframe
                src={PLACEHOLDER_VIDEO}
                title="ALDO AI walkthrough"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
