'use client';

/**
 * Live component-status grid for `/status`.
 *
 * Polls two HTTP endpoints from the browser every 30 seconds and
 * derives three component rows from the results:
 *
 *   - API: GET /health on the canonical origin → 200 + { ok: true }
 *   - Web: GET / on the marketing origin → HTTP 200
 *   - DB:  read from the SAME /health response's `db` field
 *          (`'ok' | 'down'`). Wave-MVP follow-up — the endpoint now
 *          runs a real `SELECT 1` and reports the result; the page
 *          surfaces it directly instead of inferring from API liveness.
 *          When the API probe itself fails (network error / non-2xx),
 *          DB falls back to "Down" because we can't separate the two.
 *
 * Network errors, non-2xx responses, and probe timeouts all degrade
 * the row to "Down". The row stays "Checking" until the first probe
 * resolves; "Last checked" updates after every poll regardless of
 * outcome so visitors can see the page is actually live.
 *
 * Why client-side polling, not Server-Sent Events / websockets:
 * the marketing surface is fully static; an SSE bridge would force
 * us to add a long-lived API endpoint just for this page. Client
 * fetch keeps the dependency surface zero.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 8_000;

/**
 * Probe targets. Defaults align with the production deployment;
 * `NEXT_PUBLIC_STATUS_*` overrides let local-dev or staging point
 * the page at a different origin without a code change.
 */
const API_HEALTH_URL = process.env.NEXT_PUBLIC_STATUS_API_URL ?? 'https://ai.aldo.tech/health';
const WEB_URL = process.env.NEXT_PUBLIC_STATUS_WEB_URL ?? 'https://ai.aldo.tech/';

type Status = 'operational' | 'degraded' | 'down' | 'checking';

interface ComponentRow {
  readonly key: 'api' | 'web' | 'db';
  readonly name: string;
  readonly subtitle: string;
}

const COMPONENTS: ReadonlyArray<ComponentRow> = [
  { key: 'api', name: 'API', subtitle: 'ai.aldo.tech/health' },
  { key: 'web', name: 'Web app', subtitle: 'ai.aldo.tech homepage' },
  {
    key: 'db',
    name: 'Database',
    subtitle: 'Postgres SELECT 1 via /health',
  },
];

interface RowState {
  readonly status: Status;
  /** Epoch ms of the most recent probe completion. `null` until first poll. */
  readonly lastCheckedAt: number | null;
}

const INITIAL_STATE: Record<ComponentRow['key'], RowState> = {
  api: { status: 'checking', lastCheckedAt: null },
  web: { status: 'checking', lastCheckedAt: null },
  db: { status: 'checking', lastCheckedAt: null },
};

/** GET with a hard AbortController timeout. Returns the Response or throws. */
async function fetchWithTimeout(url: string, signal: AbortSignal): Promise<Response> {
  return await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    redirect: 'follow',
    signal,
    // The web check runs against a same-origin marketing page; the
    // API check is cross-origin but the JSON shape is public so the
    // server allows CORS GETs. Keep credentials off either way.
    credentials: 'omit',
  });
}

/**
 * Probe the API health endpoint and return BOTH the API and DB
 * statuses derived from the same response. Wave-MVP follow-up: the
 * endpoint now ships a `db` field (`'ok' | 'down'`) sourced from a
 * real `SELECT 1`; we surface it directly. When the response itself
 * is missing the field (e.g. an older API build is still in
 * production), fall back to the legacy "DB liveness == API liveness"
 * behaviour so the page never goes blank during a deploy lap.
 */
async function probeApiAndDb(
  signal: AbortSignal,
): Promise<{ readonly api: Status; readonly db: Status }> {
  try {
    const res = await fetchWithTimeout(API_HEALTH_URL, signal);
    if (!res.ok) return { api: 'down', db: 'down' };
    const body = (await res.json()) as { ok?: unknown; db?: unknown; status?: unknown };
    const api: Status = body.ok === true ? 'operational' : 'degraded';
    let db: Status;
    if (body.db === 'ok') db = 'operational';
    else if (body.db === 'down') db = 'down';
    // Field absent → older API build; mirror api status until the new
    // shape lands in production. Once /health always carries `db`, the
    // fallback branch becomes unreachable and can be removed.
    else db = api;
    return { api, db };
  } catch {
    return { api: 'down', db: 'down' };
  }
}

async function probeWeb(signal: AbortSignal): Promise<Status> {
  try {
    const res = await fetchWithTimeout(WEB_URL, signal);
    return res.ok ? 'operational' : 'down';
  } catch {
    return 'down';
  }
}

export function StatusBoard() {
  const [state, setState] = useState<Record<ComponentRow['key'], RowState>>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    const controllers: AbortController[] = [];

    async function poll(): Promise<void> {
      const apiCtrl = new AbortController();
      const webCtrl = new AbortController();
      controllers.push(apiCtrl, webCtrl);

      const apiTimer = setTimeout(() => apiCtrl.abort(), PROBE_TIMEOUT_MS);
      const webTimer = setTimeout(() => webCtrl.abort(), PROBE_TIMEOUT_MS);

      const [apiResult, webStatus] = await Promise.all([
        probeApiAndDb(apiCtrl.signal),
        probeWeb(webCtrl.signal),
      ]);
      clearTimeout(apiTimer);
      clearTimeout(webTimer);

      if (cancelled) return;
      const now = Date.now();
      setState({
        api: { status: apiResult.api, lastCheckedAt: now },
        web: { status: webStatus, lastCheckedAt: now },
        // Wave-MVP follow-up — DB row reads the dedicated `db` field
        // from /health (real `SELECT 1`), no longer inferred from the
        // API liveness.
        db: { status: apiResult.db, lastCheckedAt: now },
      });
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      for (const c of controllers) c.abort();
    };
  }, []);

  return (
    <ul
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg-elevated"
      data-testid="status-board"
    >
      {COMPONENTS.map((c) => {
        const row = state[c.key];
        return (
          <li
            key={c.key}
            className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
            data-testid={`status-row-${c.key}`}
          >
            <div>
              <p className="text-sm font-semibold text-fg">{c.name}</p>
              <p className="text-xs text-fg-muted">{c.subtitle}</p>
            </div>
            <div className="flex items-center gap-3">
              <LastCheckedLabel epochMs={row.lastCheckedAt} />
              <StatusPill status={row.status} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

interface StatusPillProps {
  readonly status: Status;
}

function StatusPill({ status }: StatusPillProps) {
  const { label, dot, surface, text } = pillTokens(status);
  // Native `<output>` element: implicitly carries `role=status` and an
  // assertive-but-polite live region — exactly what we want for a
  // value that updates as polling resolves. Lets us drop the explicit
  // role/aria-live attributes (and silences biome's
  // a11y/useSemanticElements warning).
  return (
    <output
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${surface} ${text}`}
      data-testid="status-pill"
      data-status={status}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </output>
  );
}

function pillTokens(status: Status): {
  label: string;
  dot: string;
  surface: string;
  text: string;
} {
  switch (status) {
    case 'operational':
      return {
        label: 'Operational',
        dot: 'bg-success',
        surface: 'bg-success/10',
        text: 'text-success',
      };
    case 'degraded':
      return {
        label: 'Degraded',
        dot: 'bg-warning',
        surface: 'bg-warning/10',
        text: 'text-warning',
      };
    case 'down':
      return {
        label: 'Down',
        dot: 'bg-danger',
        surface: 'bg-danger/10',
        text: 'text-danger',
      };
    default:
      return {
        label: 'Checking…',
        dot: 'bg-fg-muted',
        surface: 'bg-bg-subtle',
        text: 'text-fg-muted',
      };
  }
}

interface LastCheckedLabelProps {
  readonly epochMs: number | null;
}

/**
 * Renders a relative "checked Ns ago" label. Time-of-day formatting
 * happens after the component hydrates so SSR and CSR agree on first
 * paint (the server sends "—" and the client fills in once it
 * polls).
 */
function LastCheckedLabel({ epochMs }: LastCheckedLabelProps) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (epochMs == null || now == null) {
    return (
      <span className="text-xs text-fg-faint" data-testid="status-last-checked">
        Checking…
      </span>
    );
  }
  const seconds = Math.max(0, Math.floor((now - epochMs) / 1000));
  const label = seconds < 5 ? 'just now' : `${seconds}s ago`;
  return (
    <span className="text-xs text-fg-faint" data-testid="status-last-checked">
      Checked {label}
    </span>
  );
}
