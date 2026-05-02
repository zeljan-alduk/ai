/**
 * In-house status page — `/status`.
 *
 * Public, no auth, no vendor dependency. The page itself is a server
 * component that loads the (committed) 30-day incident history from
 * `apps/web/data/status-incidents.json`. The live component-status
 * grid is a client island (`StatusBoard`) that polls every 30s.
 *
 * Why server + client split:
 *
 *   - SSR ships the page shell, the heading, and the incident timeline
 *     immediately so search engines and link previews see real content.
 *   - The polling badges are intrinsically client-only and benefit
 *     from React state for the "Checking…" placeholders.
 *
 * What we monitor (three components):
 *
 *   1. API   — `/health` on the canonical origin. Returns `{ ok, version }`
 *              at the moment; status is derived from HTTP 200 + ok=true.
 *   2. Web   — homepage 200 check.
 *   3. DB    — inferred from API. The current `/health` route does not
 *              run a DB ping (see `apps/api/src/routes/health.ts`); when
 *              that lands, the DB row will read its dedicated field. The
 *              row's subtitle calls this out so visitors aren't misled.
 *
 * LLM-agnostic: nothing on this page names a model provider.
 */

import { IncidentTimeline } from '@/components/status/incident-timeline';
import { StatusBoard } from '@/components/status/status-board';
import incidentsRaw from '@/data/status-incidents.json';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'System status — ALDO AI',
  description:
    'Live operational status of ALDO AI: API, web, and database. Incident history for the last 30 days.',
};

// Re-render every 60s so an incident commit hits visitors quickly
// without needing a full deploy. The polling client refreshes the
// component-status grid every 30s on top of this.
export const revalidate = 60;

export interface IncidentUpdate {
  readonly at: string;
  readonly message: string;
}

export interface Incident {
  readonly id: string;
  readonly startedAt: string;
  readonly resolvedAt?: string;
  readonly title: string;
  readonly severity: 'minor' | 'major' | 'critical';
  readonly updates: ReadonlyArray<IncidentUpdate>;
}

/** Parse + filter the committed incident file to the last 30 days. */
function loadRecentIncidents(): ReadonlyArray<Incident> {
  const all = incidentsRaw as ReadonlyArray<Incident>;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return all
    .filter((i) => {
      const t = Date.parse(i.startedAt);
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export default function StatusPage() {
  const incidents = loadRecentIncidents();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-8 sm:mb-10">
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">ALDO AI</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          System status
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-fg-muted">
          Live health of the ALDO AI control plane. Polled from your browser every 30 seconds — no
          third-party status vendor sits between you and the truth. Incident history is committed to
          the repo.
        </p>
      </header>

      <section aria-labelledby="components-heading" className="mb-12">
        <h2
          id="components-heading"
          className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted"
        >
          Components
        </h2>
        <StatusBoard />
      </section>

      <section aria-labelledby="incidents-heading">
        <h2
          id="incidents-heading"
          className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted"
        >
          Incidents — last 30 days
        </h2>
        <IncidentTimeline incidents={incidents} />
      </section>
    </div>
  );
}
