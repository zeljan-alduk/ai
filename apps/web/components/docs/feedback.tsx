'use client';

/**
 * "Was this page helpful?" thumbs row.
 *
 * Stores the vote in localStorage keyed on the doc path so a reload
 * keeps the user's last answer. There is no server submit on
 * purpose — wiring a vote-recording endpoint would push the
 * unauthenticated docs surface into the auth-aware API. A future
 * wave can add an aggregated "votes per page" endpoint; this
 * placeholder ships the affordance today.
 *
 * LLM-agnostic: feedback is opaque ("yes" / "no") and not tied to a
 * model.
 */

import { Button } from '@/components/ui/button';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface DocsFeedbackProps {
  readonly path: string;
}

const STORAGE_PREFIX = 'aldo:docs-feedback:';

export function DocsFeedback({ path }: DocsFeedbackProps) {
  const [vote, setVote] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${path}`);
      if (raw === 'up' || raw === 'down') setVote(raw);
    } catch {
      // localStorage unavailable (e.g. SSR/private mode); skip.
    }
  }, [path]);

  function record(next: 'up' | 'down') {
    setVote(next);
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${path}`, next);
    } catch {
      // Same as above — failure is silent.
    }
  }

  return (
    <div className="flex items-center gap-3 text-sm text-fg-muted">
      <span>Was this helpful?</span>
      <Button
        variant={vote === 'up' ? 'default' : 'secondary'}
        size="sm"
        onClick={() => record('up')}
        aria-pressed={vote === 'up'}
      >
        <ThumbsUp aria-hidden="true" className="mr-1 h-3 w-3" />
        Yes
      </Button>
      <Button
        variant={vote === 'down' ? 'default' : 'secondary'}
        size="sm"
        onClick={() => record('down')}
        aria-pressed={vote === 'down'}
      >
        <ThumbsDown aria-hidden="true" className="mr-1 h-3 w-3" />
        No
      </Button>
      {vote !== null ? (
        <span className="text-xs text-fg-muted">Thanks for the feedback.</span>
      ) : null}
    </div>
  );
}
