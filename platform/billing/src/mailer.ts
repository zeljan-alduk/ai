/**
 * Tiny `Mailer` interface.
 *
 * Wave 11 introduces the design-partner program — a public form that
 * notifies the founder when someone applies. The notification path
 * is fire-and-forget: a failed send must never break the apply API.
 *
 * We intentionally ship a minimal stub here rather than picking SES /
 * Resend / Postmark up front. The real provider lands in a later
 * wave when we know what the inbox actually is. Until then,
 * `noopMailer` writes a single structured stderr line per send and
 * returns success — enough for the founder to grep dev logs.
 *
 * LLM-agnostic: nothing here references a model provider.
 *
 * Why is this in @aldo-ai/billing? — Engineer Q owns the placeholder-
 * mode billing surface in the same wave; both surfaces share the
 * "boots in placeholder mode when env vars are unset" pattern. When
 * a real mailer lands the implementation can move to a new
 * `@aldo-ai/mailer` package without touching callers (they import
 * the type-only `Mailer` interface).
 */

export interface MailerSendOptions {
  /** Single recipient (RFC 5321 address). MVP doesn't fan-out. */
  readonly to: string;
  /** Short, human-readable subject. */
  readonly subject: string;
  /** Plain-text body. We don't ship HTML in the stub. */
  readonly text: string;
  /** Optional From: override; otherwise the implementation picks. */
  readonly from?: string;
}

export interface Mailer {
  /**
   * Best-effort send. Implementations MUST NOT throw on transient
   * failure — return `{ ok: false, reason }` instead so callers can
   * decide whether to retry. The control-plane API logs and moves on.
   */
  send(opts: MailerSendOptions): Promise<MailerSendResult>;
}

export type MailerSendResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The default implementation. Logs a structured one-line note to
 * stderr and returns success. We don't hold the message body — the
 * applicant's data is already on disk in `design_partner_applications`,
 * and shipping a plaintext stack to stderr is overkill in MVP.
 */
export class NoopMailer implements Mailer {
  async send(opts: MailerSendOptions): Promise<MailerSendResult> {
    const id = `noop-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    // One-line structured form so `grep '[mailer]'` in prod logs is
    // a single command. Body is omitted by design (see class docstring).
    process.stderr.write(
      `[mailer] noop send to=${JSON.stringify(opts.to)} subject=${JSON.stringify(opts.subject)} id=${id}\n`,
    );
    return { ok: true, id };
  }
}

/**
 * Convenience factory. Future revisions branch on
 * `env.MAILER_PROVIDER` (`"ses"`, `"resend"`, `"postmark"`, ...) to
 * return a real implementation. When unset, callers always get the
 * `NoopMailer`.
 */
export interface MailerEnv {
  readonly MAILER_PROVIDER?: string | undefined;
  readonly [k: string]: string | undefined;
}

export function loadMailerFromEnv(env: MailerEnv = process.env): Mailer {
  const provider = (env.MAILER_PROVIDER ?? '').trim();
  if (provider === '' || provider === 'noop') {
    return new NoopMailer();
  }
  // Real provider integrations land in a later wave. Until then,
  // emit a one-line warning so the operator knows their env var
  // didn't take effect, and fall back to the no-op rather than
  // crashing the API on boot.
  process.stderr.write(
    `[mailer] MAILER_PROVIDER=${JSON.stringify(provider)} is not implemented yet; falling back to noop. (See platform/billing/src/mailer.ts.)\n`,
  );
  return new NoopMailer();
}

/** Pre-built singleton for callers that don't want their own factory. */
export const noopMailer: Mailer = new NoopMailer();
