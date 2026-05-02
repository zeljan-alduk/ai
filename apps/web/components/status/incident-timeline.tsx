/**
 * Incident timeline for the `/status` page.
 *
 * Pure server component — reads incidents that the page already
 * loaded from `apps/web/data/status-incidents.json` and renders
 * newest-first. When the list is empty (the common, hoped-for case)
 * it renders an explicit "no incidents in the last 30 days" empty
 * state so the section never looks broken.
 *
 * Severity surfaces:
 *
 *   - minor    → success token (informational; service kept running)
 *   - major    → warning token
 *   - critical → danger token
 *
 * All colours go through semantic tokens so dark mode works without
 * a second pass.
 */

import type { Incident } from '@/app/(marketing)/status/page';

export interface IncidentTimelineProps {
  readonly incidents: ReadonlyArray<Incident>;
}

export function IncidentTimeline({ incidents }: IncidentTimelineProps) {
  if (incidents.length === 0) {
    return (
      <div
        className="rounded-xl border border-border bg-bg-elevated px-4 py-6 text-center text-sm text-fg-muted"
        data-testid="incident-timeline-empty"
      >
        No incidents in the last 30 days.
      </div>
    );
  }

  return (
    <ol
      className="space-y-3"
      data-testid="incident-timeline"
      aria-label="Incident history, newest first"
    >
      {incidents.map((i) => (
        <li key={i.id} className="rounded-xl border border-border bg-bg-elevated p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-fg">{i.title}</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                <time dateTime={i.startedAt}>{formatDate(i.startedAt)}</time>
                {i.resolvedAt ? (
                  <>
                    {' → '}
                    <time dateTime={i.resolvedAt}>{formatDate(i.resolvedAt)}</time>
                  </>
                ) : (
                  ' · ongoing'
                )}
              </p>
            </div>
            <SeverityPill severity={i.severity} resolved={Boolean(i.resolvedAt)} />
          </div>

          {i.updates.length > 0 ? (
            <ul className="mt-3 space-y-2 border-l border-border pl-3 text-xs">
              {i.updates.map((u, idx) => (
                <li key={`${i.id}-${idx}`} className="text-fg-muted">
                  <time dateTime={u.at} className="font-mono text-fg-faint">
                    {formatDate(u.at)}
                  </time>{' '}
                  — <span className="text-fg">{u.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

interface SeverityPillProps {
  readonly severity: Incident['severity'];
  readonly resolved: boolean;
}

function SeverityPill({ severity, resolved }: SeverityPillProps) {
  const { label, surface, text } = severityTokens(severity);
  const suffix = resolved ? ' · resolved' : '';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${surface} ${text}`}
    >
      {label}
      {suffix}
    </span>
  );
}

function severityTokens(severity: Incident['severity']): {
  label: string;
  surface: string;
  text: string;
} {
  switch (severity) {
    case 'critical':
      return { label: 'Critical', surface: 'bg-danger/10', text: 'text-danger' };
    case 'major':
      return { label: 'Major', surface: 'bg-warning/10', text: 'text-warning' };
    case 'minor':
      return { label: 'Minor', surface: 'bg-success/10', text: 'text-success' };
  }
}

/** Stable UTC-tz formatting so SSR and CSR agree on first paint. */
function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
}
