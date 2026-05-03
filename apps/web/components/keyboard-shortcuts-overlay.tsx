'use client';

/**
 * Keyboard-shortcuts overlay.
 *
 * Triggered by pressing `?` outside an input. Lists every global
 * shortcut the app exposes — ⌘K, the g-prefix chords, /, ?, Esc.
 *
 * Open/close state is owned by the parent
 * `KeyboardShortcutsRouter` so the same `?` keypress can both open
 * this overlay AND be guarded against typing-targets in one place.
 */

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { GO_SHORTCUTS, STATIC_SHORTCUT_DOCS } from '@/lib/keyboard-shortcuts';

export interface KeyboardShortcutsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsOverlay({ open, onOpenChange }: KeyboardShortcutsOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          Hit <Kbd>?</Kbd> any time to bring this back. Most shortcuts are suppressed while a text
          input is focused.
        </DialogDescription>
        <div className="mt-2 grid gap-4">
          <Section title="Global">
            {STATIC_SHORTCUT_DOCS.map((doc) => (
              <Row key={doc.chord} chord={doc.chord} label={doc.description} />
            ))}
          </Section>
          <Section title="Go to…">
            {GO_SHORTCUTS.map((s) => (
              <Row key={s.chord} chord={s.chord} label={s.label} />
            ))}
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {title}
      </h3>
      <ul className="divide-y divide-border rounded-md border border-border">{children}</ul>
    </div>
  );
}

function Row({ chord, label }: { chord: string; label: string }) {
  return (
    <li className="flex items-center justify-between px-3 py-2 text-sm">
      <span className="text-fg">{label}</span>
      <Kbd>{chord}</Kbd>
    </li>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
      {children}
    </kbd>
  );
}
