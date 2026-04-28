/**
 * Trust strip — honest replacement for the "trusted by [logos]" wall
 * that competitors run. We don't fake customer logos. Instead we show:
 *
 *   1. Verticals we are designed for (privacy story makes us a fit).
 *   2. The OSS stack we sit on top of (developer trust through
 *      transparency).
 *
 * No fabricated compliance badges. No NDA-cover logos. If we add a
 * real customer logo later, it goes in a separate "Customers" strip.
 */

const VERTICALS = ['Healthcare', 'Finance', 'Government', 'Defence', 'EU teams under GDPR'];

const STACK = ['Postgres', 'Hono', 'Next.js', 'MCP', 'Ollama', 'vLLM', 'llama.cpp'];

export function TrustStrip() {
  return (
    <section className="border-y border-border bg-bg-elevated">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Built for teams in
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {VERTICALS.map((v) => (
                <li
                  key={v}
                  className="rounded-full border border-border bg-bg-elevated px-3 py-1 text-[12px] font-medium text-fg"
                >
                  {v}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Built on top of
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {STACK.map((s) => (
                <li
                  key={s}
                  className="rounded-full border border-border bg-bg-subtle px-3 py-1 font-mono text-[11.5px] text-fg"
                >
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
