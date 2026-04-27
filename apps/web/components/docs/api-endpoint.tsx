/**
 * Renderer for one auto-generated API endpoint page.
 *
 * The generator (`scripts/generate-api-docs.ts`) writes one JSON file
 * per endpoint into `content/docs/api/_generated/<slug>.json`; this
 * component reads the JSON, mounts the request/response sections, and
 * renders curl / Python / TypeScript snippets in a Tabs primitive.
 *
 * All code blocks come pre-highlighted by shiki at build time so the
 * runtime cost is just a `dangerouslySetInnerHTML` per snippet — no
 * client-side highlighter is shipped.
 *
 * LLM-agnostic: the rendered shapes are platform shapes (runs,
 * agents, evals, …); model fields are opaque strings, never
 * provider-named.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CodeTabs } from '@/components/docs/code-tabs';
import { DocsFeedback } from '@/components/docs/feedback';
import { renderCodeServer } from '@/lib/docs/highlight-server';
import type { GeneratedApiPage } from '@/lib/docs/registry';

interface EndpointSpec {
  readonly slug: string;
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  readonly path: string;
  readonly title: string;
  readonly summary: string;
  readonly authScope: string | null;
  readonly contractFile: string;
  readonly request: SchemaShape | null;
  readonly response: SchemaShape | null;
  readonly examples: ReadonlyArray<EndpointExample>;
  readonly errors: ReadonlyArray<EndpointError>;
}

interface SchemaShape {
  readonly typeName: string;
  readonly fields: ReadonlyArray<SchemaField>;
}

interface SchemaField {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
  readonly description: string | null;
}

interface EndpointExample {
  readonly language: 'curl' | 'python' | 'typescript';
  readonly code: string;
}

interface EndpointError {
  readonly status: number;
  readonly code: string;
  readonly description: string;
}

const LANG_LABEL: Record<EndpointExample['language'], string> = {
  curl: 'curl',
  python: 'Python',
  typescript: 'TypeScript',
};

const LANG_TO_SHIKI: Record<EndpointExample['language'], string> = {
  curl: 'bash',
  python: 'python',
  typescript: 'typescript',
};

export interface ApiEndpointPageProps {
  readonly page: GeneratedApiPage;
}

export async function ApiEndpointPage({ page }: ApiEndpointPageProps) {
  const spec = readSpec(page);
  if (!spec) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold text-fg">Endpoint missing</h1>
        <p className="text-fg-muted">
          The generator did not emit a JSON spec for this endpoint. Run{' '}
          <code>pnpm --filter @aldo-ai/web generate-api-docs</code> to regenerate.
        </p>
      </div>
    );
  }

  const tabs = await Promise.all(
    spec.examples.map(async (ex) => ({
      id: ex.language,
      label: LANG_LABEL[ex.language],
      html: await renderCodeServer(ex.code, LANG_TO_SHIKI[ex.language]),
    })),
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-10">
      <article className="docs-prose min-w-0 flex-1">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">API</p>
          <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold tracking-tight text-fg">
            <MethodBadge method={spec.method} />
            <code className="font-mono text-2xl">{spec.path}</code>
          </h1>
          {spec.summary ? <p className="mt-2 text-base text-fg-muted">{spec.summary}</p> : null}
          {spec.authScope ? (
            <p className="mt-2 text-sm">
              <span className="text-fg-muted">Auth scope: </span>
              <code className="rounded bg-bg-subtle px-1 py-0.5 text-xs">{spec.authScope}</code>
            </p>
          ) : null}
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-fg">Request</h2>
          {spec.request ? (
            <SchemaTable shape={spec.request} />
          ) : (
            <p className="text-sm text-fg-muted">No request body — query/path parameters only.</p>
          )}
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-lg font-semibold text-fg">Response</h2>
          {spec.response ? (
            <SchemaTable shape={spec.response} />
          ) : (
            <p className="text-sm text-fg-muted">No response body documented.</p>
          )}
        </section>

        {tabs.length > 0 ? (
          <section className="mt-6">
            <h2 className="text-lg font-semibold text-fg">Example</h2>
            <CodeTabs tabs={tabs} />
          </section>
        ) : null}

        {spec.errors.length > 0 ? (
          <section className="mt-6 space-y-3">
            <h2 className="text-lg font-semibold text-fg">Errors</h2>
            <table className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-fg-muted">
                  <th className="w-20 py-2">Status</th>
                  <th className="w-40 py-2">Code</th>
                  <th className="py-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {spec.errors.map((e) => (
                  <tr key={`${e.status}-${e.code}`} className="border-b border-border">
                    <td className="py-2 font-mono text-xs">{e.status}</td>
                    <td className="py-2 font-mono text-xs">{e.code}</td>
                    <td className="py-2 text-fg">{e.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          {/* "View contract source" link removed — repository is private. */}
          <span className="text-xs text-fg-muted">Contract: {spec.contractFile}</span>
          <DocsFeedback path={`/docs/${page.slug}`} />
        </footer>
      </article>
    </div>
  );
}

function readSpec(page: GeneratedApiPage): EndpointSpec | null {
  if (!page.source) return null;
  const abs = path.resolve(process.cwd(), 'content/docs', page.source);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8')) as EndpointSpec;
  } catch {
    return null;
  }
}

function SchemaTable({ shape }: { shape: SchemaShape }) {
  if (shape.fields.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        Empty body. Schema: <code>{shape.typeName}</code>.
      </p>
    );
  }
  return (
    <div>
      <p className="mb-2 text-xs text-fg-muted">
        Schema: <code className="font-mono">{shape.typeName}</code>
      </p>
      <table className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-fg-muted">
            <th className="w-1/4 py-2">Field</th>
            <th className="w-1/4 py-2">Type</th>
            <th className="py-2">Description</th>
          </tr>
        </thead>
        <tbody>
          {shape.fields.map((f) => (
            <tr key={f.name} className="border-b border-border align-top">
              <td className="py-2 font-mono text-xs">
                {f.name}
                {f.optional ? <span className="text-fg-muted">?</span> : null}
              </td>
              <td className="py-2 font-mono text-xs text-fg-muted">{f.type}</td>
              <td className="py-2 text-fg">{f.description ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MethodBadge({ method }: { method: EndpointSpec['method'] }) {
  // Color tokens map onto the design-system status set:
  // GET -> accent (informational read), POST/PUT -> success (creates),
  // PATCH -> warning (mutates), DELETE -> danger (destroys).
  const colour: Record<EndpointSpec['method'], string> = {
    GET: 'bg-accent/10 text-accent',
    POST: 'bg-success/10 text-success',
    PATCH: 'bg-warning/10 text-warning',
    PUT: 'bg-warning/10 text-warning',
    DELETE: 'bg-danger/10 text-danger',
  };
  return (
    <span className={`rounded px-2 py-0.5 font-mono text-xs ${colour[method]}`}>{method}</span>
  );
}
