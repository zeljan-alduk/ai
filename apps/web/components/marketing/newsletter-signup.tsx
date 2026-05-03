'use client';

/**
 * "Stay close to the build." — newsletter signup + 3 changelog snippets.
 *
 * Wave-iter-3. Compact section between FAQ and DualCta. Posts to:
 *
 *   POST /v1/newsletter/subscribe
 *
 * with `{ email, source: 'marketing-home' }`. The route is on the
 * bearer-auth allow-list (see apps/api/src/auth/middleware.ts).
 *
 * UX:
 *   - real <form> with <label sr-only> for AT
 *   - submit disabled while in flight
 *   - success state renders inline (no toast); the form keeps the
 *     submitted email visible so the user can verify
 *   - server validation errors (422) surface as inline help text
 *   - rate-limit (429) surfaces the same way
 *
 * The 3 changelog snippets are hardcoded — read from the cadence
 * narrative in BuiltInTheOpen so the same wave headlines stay
 * consistent. A live changelog lives at /changelog.
 */

import Link from 'next/link';
import { useState } from 'react';

interface ChangelogSnippet {
  readonly when: string;
  readonly title: string;
  readonly summary: string;
  readonly tag: 'wave' | 'fix' | 'docs';
}

// Pulled from the BuiltInTheOpen cadence + the most recent commit
// subjects on `claude/ai-agent-orchestrator-hAmzy`. Refresh by hand
// when the next wave lands; the page deliberately doesn't run git
// at build time (see BuiltInTheOpen for the rationale).
const RECENT: ReadonlyArray<ChangelogSnippet> = [
  {
    when: '2 days ago',
    title: 'Wave-4 — frontend competitive surface',
    summary:
      'Prompts (Vellum + Hub parity), threads, share links, command palette ⌘K, N-way compare, tags, spend dashboard.',
    tag: 'wave',
  },
  {
    when: '4 days ago',
    title: 'Wave-3 — competitive-gap closing',
    summary:
      'Git integration, eval scorer playground, gallery fork, MCP Streamable HTTP, Helm chart, retention enforcement.',
    tag: 'wave',
  },
  {
    when: '6 days ago',
    title: 'Wave-MVP — ship-readiness',
    summary:
      'Licence canonicalised, Stripe wired, in-house /status, projects retrofit, termination runtime, MCP introspection, SDK release workflows.',
    tag: 'wave',
  },
];

const TAG_PILL: Record<ChangelogSnippet['tag'], string> = {
  wave: 'border-accent/30 bg-accent/10 text-accent',
  fix: 'border-warning/30 bg-warning/10 text-warning',
  docs: 'border-border bg-bg-subtle text-fg-muted',
};

type FormState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; email: string }
  | { kind: 'error'; message: string };

const API_BASE =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_BASE_URL
    ? process.env.NEXT_PUBLIC_API_BASE_URL.replace(/\/+$/, '')
    : '';

export function NewsletterSignup() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<FormState>({ kind: 'idle' });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === 'pending') return;
    const trimmed = email.trim();
    if (trimmed.length === 0) {
      setState({ kind: 'error', message: 'Please enter an email address.' });
      return;
    }
    setState({ kind: 'pending' });
    try {
      // The API base resolves to the same-origin auth-proxy in production
      // (handled by Next.js rewrites). For the read of NEXT_PUBLIC_API_BASE_URL
      // see app config; default to a same-origin POST.
      const res = await fetch(`${API_BASE}/v1/newsletter/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, source: 'marketing-home' }),
      });
      if (res.ok) {
        setState({ kind: 'ok', email: trimmed });
        return;
      }
      // The API returns HTTP 400 (`code: 'validation_error'`) for
      // bad-shape input — see apps/api/src/middleware/error.ts. The
      // brief suggested 422 but matching the project convention here
      // keeps the error envelope consistent with every other public
      // form on the site (e.g. /design-partner).
      if (res.status === 400) {
        setState({
          kind: 'error',
          message: "That email doesn't look right. Try the form again?",
        });
        return;
      }
      if (res.status === 429) {
        setState({
          kind: 'error',
          message: 'Too many submissions from your network — try again in an hour.',
        });
        return;
      }
      setState({
        kind: 'error',
        message: `Something went sideways (${res.status}). Email info@aldo.tech and we'll add you by hand.`,
      });
    } catch {
      setState({
        kind: 'error',
        message: "We couldn't reach the API. Email info@aldo.tech and we'll add you by hand.",
      });
    }
  }

  return (
    <section id="newsletter" className="border-t border-border bg-bg-elevated">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
          {/* Left — pitch + form. */}
          <div className="lg:col-span-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              Newsletter
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2rem]">
              Stay close to the build.
            </h2>
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-fg-muted">
              Weekly digest of platform changes — what shipped, what regressed, what's on deck. No
              marketing. Unsubscribe in one click.
            </p>

            {state.kind === 'ok' ? (
              <div className="mt-6 rounded-lg border border-success/40 bg-success/5 p-4">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-success/15 text-success"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    >
                      <title>subscribed</title>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-fg">You're on the list.</p>
                    <p className="mt-1 text-[13px] text-fg-muted">
                      Confirmation will land at <strong className="text-fg">{state.email}</strong>{' '}
                      with the next digest. We send Sunday evenings UTC.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <form
                onSubmit={onSubmit}
                noValidate
                className="mt-6 flex flex-col gap-3"
                aria-label="Subscribe to the ALDO AI weekly digest"
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label htmlFor="newsletter-email" className="sr-only">
                    Email address
                  </label>
                  <input
                    id="newsletter-email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@team.com"
                    value={email}
                    onChange={(e) => setEmail(e.currentTarget.value)}
                    aria-invalid={state.kind === 'error'}
                    aria-describedby={state.kind === 'error' ? 'newsletter-help' : undefined}
                    className="flex-1 rounded-md border border-border bg-bg px-3 py-2.5 text-[14px] text-fg placeholder:text-fg-faint focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  <button
                    type="submit"
                    disabled={state.kind === 'pending'}
                    className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2.5 text-[14px] font-medium text-accent-fg transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    {state.kind === 'pending' ? 'Subscribing…' : 'Subscribe'}
                  </button>
                </div>
                {state.kind === 'error' ? (
                  <p
                    id="newsletter-help"
                    role="alert"
                    className="rounded border border-warning/40 bg-warning/5 px-3 py-2 text-[12.5px] text-warning"
                  >
                    {state.message}
                  </p>
                ) : (
                  <p className="text-[11.5px] text-fg-faint">
                    No spam. No tracking pixels. Read the{' '}
                    <Link href="/security" className="underline hover:text-fg">
                      privacy policy
                    </Link>
                    .
                  </p>
                )}
              </form>
            )}
          </div>

          {/* Right — recent changelog snippets. */}
          <div className="lg:col-span-6">
            <div className="rounded-xl border border-border bg-bg p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-[13.5px] font-semibold text-fg">Recent shipping</h3>
                <Link
                  href="/changelog"
                  className="font-mono text-[10.5px] text-accent hover:text-accent-hover"
                >
                  full changelog →
                </Link>
              </div>
              <ol className="mt-4 space-y-3">
                {RECENT.map((c) => (
                  <li
                    key={c.title}
                    className="rounded-lg border border-border bg-bg-elevated p-3 transition-colors hover:border-border-strong"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider ${TAG_PILL[c.tag]}`}
                      >
                        {c.tag}
                      </span>
                      <span className="font-mono text-[10.5px] text-fg-faint">{c.when}</span>
                    </div>
                    <h4 className="mt-1.5 text-[13.5px] font-semibold leading-snug text-fg">
                      {c.title}
                    </h4>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">{c.summary}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
