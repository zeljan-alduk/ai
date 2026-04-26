/**
 * /share/[slug] — wave 14 (Engineer 14D).
 *
 * Public read-only viewer for a shared run / sweep / agent. The page
 * fetches `/v1/public/share/:slug` (no auth) and renders a watermarked
 * read-only projection of the resource:
 *
 *   - run  -> flame-graph + cost summary + final output
 *            (NO secret values, NO usage_records)
 *   - sweep-> matrix + per-model summary
 *   - agent-> spec + composite diagram
 *
 * Password-protected shares render a password prompt; submitting it
 * appends `?password=...` to the URL and re-fetches.
 *
 * The middleware allow-list MUST cover `/share/[slug]` — see
 * lib/middleware-shared.ts. Without that, a logged-out visitor gets
 * bounced to /login.
 */

import { API_BASE } from '@/lib/api';
import { PublicShareView } from './public-share-view';

export const dynamic = 'force-dynamic';

interface PublicShareEnvelope {
  share?: {
    slug: string;
    targetKind: 'run' | 'sweep' | 'agent';
    targetId: string;
    expiresAt: string | null;
    createdAt: string;
  };
  resource?: unknown;
  locked?: true;
  reason?: 'password_required' | 'password_invalid' | 'rate_limited';
}

async function fetchShare(
  slug: string,
  password: string | undefined,
): Promise<{ status: number; body: PublicShareEnvelope | null }> {
  const params = new URLSearchParams();
  if (password !== undefined && password.length > 0) {
    params.set('password', password);
  }
  const qs = params.toString();
  const url = `${API_BASE}/v1/public/share/${encodeURIComponent(slug)}${qs.length > 0 ? `?${qs}` : ''}`;
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    return { status: 500, body: null };
  }
  let body: PublicShareEnvelope | null = null;
  try {
    body = (await res.json()) as PublicShareEnvelope;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

export default async function PublicSharePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ password?: string }>;
}) {
  const { slug } = await params;
  const { password } = await searchParams;

  const { status, body } = await fetchShare(slug, password);

  if (status === 404) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border bg-bg-elevated p-6 text-center">
        <h1 className="text-lg font-semibold text-fg">This share isn't available</h1>
        <p className="mt-2 text-sm text-fg-muted">
          The link is invalid, has expired, or has been revoked.
        </p>
      </div>
    );
  }

  if (status === 401 && body?.locked) {
    return <PasswordPrompt slug={slug} invalid={body.reason === 'password_invalid'} />;
  }

  if (status === 429) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-danger/30 bg-danger/5 p-6 text-center">
        <h1 className="text-lg font-semibold text-danger">Too many attempts</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Try again in an hour. Repeated wrong-password attempts are rate-limited.
        </p>
      </div>
    );
  }

  if (status !== 200 || body?.resource === undefined || body?.share === undefined) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border bg-bg-elevated p-6 text-center">
        <h1 className="text-lg font-semibold text-fg">Couldn't load this share</h1>
        <p className="mt-2 text-sm text-fg-muted">An unexpected error occurred.</p>
      </div>
    );
  }

  return <PublicShareView share={body.share} resource={body.resource as never} />;
}

function PasswordPrompt({ slug, invalid }: { slug: string; invalid: boolean }) {
  return (
    <form
      method="GET"
      action={`/share/${slug}`}
      className="mx-auto max-w-md rounded-lg border border-border bg-bg-elevated p-6"
    >
      <h1 className="text-lg font-semibold text-fg">Password required</h1>
      <p className="mt-2 text-sm text-fg-muted">
        This share is password-protected. Ask whoever sent you the link.
      </p>
      {invalid && (
        <p className="mt-2 rounded border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
          Wrong password — try again.
        </p>
      )}
      <label className="mt-4 flex flex-col gap-1 text-sm">
        Password
        <input
          name="password"
          type="password"
          required
          className="rounded border border-border bg-bg p-2 text-sm text-fg"
        />
      </label>
      <button
        type="submit"
        className="mt-4 w-full rounded bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
      >
        Unlock
      </button>
    </form>
  );
}
