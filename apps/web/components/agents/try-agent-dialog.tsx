'use client';

/**
 * "Try this agent" — placeholder dialog for wave 12.
 *
 * Live run dispatch lands in wave 13 (engine + gateway must be ready).
 * Until then the button opens a Dialog that explains the gap, so we
 * don't lie to operators by faking a run.
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useState } from 'react';

export function TryAgentDialog({ agentName }: { agentName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" type="button">
          Try this agent
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run dispatch coming in wave 13</DialogTitle>
          <DialogDescription>
            One-click runs of <span className="font-mono">{agentName}</span> from the gallery land
            in the next wave. The engine + gateway plumbing has to ship first so the privacy-tier
            router can fail closed for sensitive-tier work.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
