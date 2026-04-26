/**
 * Layout for the unauthenticated routes (`/login`, `/signup`).
 *
 * The route group `(auth)` is segment-scoped so its layout REPLACES
 * the root layout's sidebar chrome — auth pages render as a centred
 * card on a plain slate background. No protected data is fetched
 * here, so this layout is safe to render before the session cookie
 * exists.
 */

import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-10"
      style={{
        paddingTop: 'max(2.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="mb-6 flex items-center gap-2">
        <div className="h-7 w-7 rounded bg-fg" aria-hidden />
        <div>
          <div className="text-base font-semibold leading-tight text-fg">ALDO AI</div>
          <div className="text-[11px] uppercase tracking-wider text-fg-muted">control plane</div>
        </div>
      </div>
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-elevated p-5 shadow-sm sm:p-6">
        {children}
      </div>
      <p className="mt-6 max-w-md text-center text-xs text-fg-muted">
        LLM-agnostic control plane. Sessions are HTTP-only cookies; tokens never reach the browser
        bundle.
      </p>
    </div>
  );
}
