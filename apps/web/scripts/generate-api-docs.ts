#!/usr/bin/env tsx
/**
 * generate-api-docs.ts — wave-15 docs site, build-time API ref generator.
 *
 * Reads every route handler in `apps/api/src/routes/*.ts` to enumerate
 * the HTTP endpoints, then matches each endpoint against the Zod
 * schemas exported by `@aldo-ai/api-contract` (looked up by naming
 * convention: `<EndpointTitleCase>Request` / `<EndpointTitleCase>Response`,
 * with falls-back for the conventions used across the codebase).
 *
 * For every endpoint that lands a match, the script writes a JSON
 * spec into `apps/web/content/docs/api/_generated/<slug>.json`. The
 * docs runtime renders that JSON at request time (see
 * `components/docs/api-endpoint.tsx`) — pure markdown / JSON, no
 * runtime Zod dependency on the docs surface.
 *
 * Why static introspection instead of a live OpenAPI export:
 *   - The route layer doesn't expose a single "describe this app"
 *     handle; we'd have to run the API to introspect it.
 *   - Static parsing keeps the generator deterministic and
 *     reproducible (CI without a database).
 *   - The output is JSON checked into the docs build artefact path,
 *     so the docs site has zero runtime dependency on @aldo-ai/api.
 *
 * LLM-agnostic: the generated reference describes platform shapes
 * (runs, agents, eval suites, …); model fields are opaque strings.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import * as ApiContract from '@aldo-ai/api-contract';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const ROUTES_DIR = join(REPO_ROOT, 'apps/api/src/routes');
const OUT_DIR = join(__dirname, '../content/docs/api/_generated');

interface ExtractedEndpoint {
  readonly file: string;
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  readonly path: string;
}

interface SchemaShape {
  readonly typeName: string;
  readonly fields: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly optional: boolean;
    readonly description: string | null;
  }>;
}

interface EndpointDoc {
  readonly slug: string;
  readonly method: ExtractedEndpoint['method'];
  readonly path: string;
  readonly title: string;
  readonly summary: string;
  readonly authScope: string | null;
  readonly contractFile: string;
  readonly request: SchemaShape | null;
  readonly response: SchemaShape | null;
  readonly examples: ReadonlyArray<{ language: 'curl' | 'python' | 'typescript'; code: string }>;
  readonly errors: ReadonlyArray<{ status: number; code: string; description: string }>;
}

main();

function main() {
  if (existsSync(OUT_DIR)) {
    rmSync(OUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const endpoints = scanRoutes();
  const schemas = collectSchemas();

  let generated = 0;
  let matched = 0;
  for (const endpoint of endpoints) {
    const doc = buildEndpointDoc(endpoint, schemas);
    if (doc.request !== null || doc.response !== null) matched++;
    const outPath = join(OUT_DIR, `${doc.slug}.json`);
    writeFileSync(outPath, JSON.stringify(doc, null, 2));
    generated++;
  }

  // Summary line for CI logs.
  console.log(
    `[docs] generate-api-docs: ${generated} endpoint specs written; ${matched} have a Zod-schema match (out of ${endpoints.length} endpoints).`,
  );
}

function scanRoutes(): ExtractedEndpoint[] {
  const files = readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'));
  const out: ExtractedEndpoint[] = [];
  for (const file of files) {
    const abs = join(ROUTES_DIR, file);
    const src = readFileSync(abs, 'utf8');
    // Match `app.<verb>('<path>'` — verb in lowercase, path single-quoted.
    const re = /app\.(get|post|patch|delete|put)\s*\(\s*['"]([^'"]+)['"]/g;
    for (const m of src.matchAll(re)) {
      const verb = m[1];
      const path = m[2];
      if (verb === undefined || path === undefined) continue;
      // Skip non-versioned probe endpoints (`/health`).
      if (!path.startsWith('/v1/') && path !== '/health') continue;
      out.push({
        file,
        method: verb.toUpperCase() as ExtractedEndpoint['method'],
        path,
      });
    }
  }
  // De-duplicate identical method+path pairs (some routes are mounted twice).
  const seen = new Set<string>();
  return out.filter((e) => {
    const key = `${e.method} ${e.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectSchemas(): Map<string, z.ZodTypeAny> {
  const out = new Map<string, z.ZodTypeAny>();
  for (const [name, value] of Object.entries(ApiContract)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      // Zod schemas always carry a `_def` and a `parse` function.
      'parse' in value &&
      '_def' in value &&
      typeof (value as { parse: unknown }).parse === 'function'
    ) {
      out.set(name, value as z.ZodTypeAny);
    }
  }
  return out;
}

function buildEndpointDoc(
  endpoint: ExtractedEndpoint,
  schemas: Map<string, z.ZodTypeAny>,
): EndpointDoc {
  const slug = slugifyEndpoint(endpoint);
  const title = humaniseEndpoint(endpoint);
  const baseName = endpointBaseName(endpoint);
  const requestSchema = pickSchema(schemas, candidateRequestNames(baseName, endpoint.method));
  const responseSchema = pickSchema(schemas, candidateResponseNames(baseName, endpoint.method));
  const authScope = inferAuthScope(endpoint);

  return {
    slug,
    method: endpoint.method,
    path: endpoint.path,
    title,
    summary: summariseEndpoint(endpoint),
    authScope,
    contractFile: contractFileForRoute(endpoint.file),
    request: requestSchema ? describeSchema(requestSchema.name, requestSchema.schema) : null,
    response: responseSchema ? describeSchema(responseSchema.name, responseSchema.schema) : null,
    examples: buildExamples(endpoint),
    errors: buildErrors(endpoint, authScope !== null),
  };
}

function slugifyEndpoint(endpoint: ExtractedEndpoint): string {
  const path = endpoint.path
    .replace(/^\/v1\//, '')
    .replace(/^\//, '')
    .replace(/:/g, '_')
    .replace(/\//g, '_')
    .replace(/[^a-z0-9_-]+/gi, '');
  return `${endpoint.method.toLowerCase()}-${path}`;
}

function endpointBaseName(endpoint: ExtractedEndpoint): string {
  // `/v1/agents/:name/promote` -> "AgentsPromote"
  const cleaned = endpoint.path
    .replace(/^\/v1\//, '')
    .split('/')
    .filter((seg) => !seg.startsWith(':'))
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
  return cleaned;
}

function candidateRequestNames(base: string, method: ExtractedEndpoint['method']): string[] {
  const variants: string[] = [];
  // e.g. AgentsRequest, RegisterAgentRequest, RegisterAgentJsonRequest, ListAgentsQuery
  variants.push(`${base}Request`);
  variants.push(`${base}JsonRequest`);
  variants.push(`${base}YamlRequest`);
  variants.push(`${base}Body`);
  if (method === 'GET') {
    variants.push(`${base}Query`);
    variants.push(`List${base.replace(/^Get/, '')}Query`);
  }
  if (method === 'POST') {
    variants.push(`Create${stripList(base)}Request`);
    variants.push(`Register${stripList(base)}Request`);
    variants.push(`Promote${stripList(base)}Request`);
  }
  if (method === 'PATCH') variants.push(`Update${stripList(base)}Request`);
  return variants;
}

function candidateResponseNames(base: string, method: ExtractedEndpoint['method']): string[] {
  const variants: string[] = [];
  variants.push(`${base}Response`);
  variants.push(`Get${base}Response`);
  variants.push(`List${base}Response`);
  if (method === 'GET') variants.push(`List${base}Response`);
  if (method === 'POST') {
    variants.push(`Create${stripList(base)}Response`);
    variants.push(`Register${stripList(base)}Response`);
    variants.push(`Promote${stripList(base)}Response`);
  }
  return variants;
}

function stripList(s: string): string {
  return s.replace(/^List/, '');
}

function pickSchema(
  schemas: Map<string, z.ZodTypeAny>,
  candidates: ReadonlyArray<string>,
): { name: string; schema: z.ZodTypeAny } | null {
  for (const name of candidates) {
    const schema = schemas.get(name);
    if (schema) return { name, schema };
  }
  return null;
}

function describeSchema(typeName: string, schema: z.ZodTypeAny): SchemaShape {
  const inner = unwrapOptionals(schema);
  if (inner instanceof z.ZodObject) {
    const fields: SchemaShape['fields'][number][] = [];
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    for (const [name, fieldSchema] of Object.entries(shape)) {
      const optional = isOptional(fieldSchema);
      const innerField = unwrapOptionals(fieldSchema);
      fields.push({
        name,
        type: zodTypeName(innerField),
        optional,
        description: innerField.description ?? null,
      });
    }
    return { typeName, fields };
  }
  // Non-object schemas (arrays, primitives) — describe as a single
  // anonymous "value" field so the renderer still has something to show.
  return {
    typeName,
    fields: [
      {
        name: '<root>',
        type: zodTypeName(inner),
        optional: false,
        description: schema.description ?? null,
      },
    ],
  };
}

function unwrapOptionals(s: z.ZodTypeAny): z.ZodTypeAny {
  let cur: z.ZodTypeAny = s;
  // ZodOptional / ZodNullable / ZodDefault all wrap an inner schema.
  for (let i = 0; i < 8; i++) {
    if (
      cur instanceof z.ZodOptional ||
      cur instanceof z.ZodNullable ||
      cur instanceof z.ZodDefault
    ) {
      cur = cur._def.innerType as z.ZodTypeAny;
      continue;
    }
    break;
  }
  return cur;
}

function isOptional(s: z.ZodTypeAny): boolean {
  return (
    s instanceof z.ZodOptional || s instanceof z.ZodDefault || (s instanceof z.ZodNullable && false)
  );
}

function zodTypeName(s: z.ZodTypeAny): string {
  if (s instanceof z.ZodString) return 'string';
  if (s instanceof z.ZodNumber) return 'number';
  if (s instanceof z.ZodBoolean) return 'boolean';
  if (s instanceof z.ZodNull) return 'null';
  if (s instanceof z.ZodLiteral) {
    const value = (s._def as { value: unknown }).value;
    return JSON.stringify(value);
  }
  if (s instanceof z.ZodEnum) {
    const values = (s._def as { values: ReadonlyArray<string> }).values;
    return values.map((v) => `"${v}"`).join(' | ');
  }
  if (s instanceof z.ZodArray) {
    const inner = (s._def as { type: z.ZodTypeAny }).type;
    return `${zodTypeName(inner)}[]`;
  }
  if (s instanceof z.ZodObject) return 'object';
  if (s instanceof z.ZodRecord) return 'Record<string, unknown>';
  if (s instanceof z.ZodUnion) {
    const opts = (s._def as { options: ReadonlyArray<z.ZodTypeAny> }).options;
    return opts.map(zodTypeName).join(' | ');
  }
  if (s instanceof z.ZodIntersection) return 'object & object';
  if (s instanceof z.ZodAny || s instanceof z.ZodUnknown) return 'unknown';
  return 'unknown';
}

function humaniseEndpoint(endpoint: ExtractedEndpoint): string {
  return `${endpoint.method} ${endpoint.path}`;
}

function summariseEndpoint(endpoint: ExtractedEndpoint): string {
  const family = endpoint.path.replace(/^\/v1\//, '').split('/')[0] ?? 'endpoint';
  const verbCopy: Record<ExtractedEndpoint['method'], string> = {
    GET: 'Read',
    POST: 'Create or invoke',
    PATCH: 'Update',
    DELETE: 'Delete',
    PUT: 'Replace',
  };
  return `${verbCopy[endpoint.method]} resources under \`${family}\`.`;
}

function inferAuthScope(endpoint: ExtractedEndpoint): string | null {
  if (endpoint.path === '/health') return null;
  const family = endpoint.path.replace(/^\/v1\//, '').split('/')[0];
  if (!family) return null;
  // Map URL families to canonical scopes used by the auth middleware.
  const scope = `${family}:${endpoint.method === 'GET' ? 'read' : 'write'}`;
  return scope;
}

function contractFileForRoute(routeFile: string): string {
  // Best-effort mapping; the renderer falls back to the raw filename.
  return routeFile;
}

function buildExamples(endpoint: ExtractedEndpoint): EndpointDoc['examples'] {
  const url = `https://app.aldo-ai.dev${endpoint.path.replace(/:(\w+)/g, '{$1}')}`;
  const headers = `-H "Authorization: Bearer $ALDO_API_KEY" \\\n  -H "Content-Type: application/json"`;
  const wantsBody =
    endpoint.method === 'POST' || endpoint.method === 'PATCH' || endpoint.method === 'PUT';
  const curl = wantsBody
    ? `curl -X ${endpoint.method} ${url} \\\n  ${headers} \\\n  -d '{}'`
    : `curl -X ${endpoint.method} ${url} \\\n  ${headers}`;

  const tsBody = wantsBody
    ? `await fetch("${url}", {\n  method: "${endpoint.method}",\n  headers: {\n    Authorization: \`Bearer \${process.env.ALDO_API_KEY}\`,\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({}),\n});`
    : `await fetch("${url}", {\n  method: "${endpoint.method}",\n  headers: { Authorization: \`Bearer \${process.env.ALDO_API_KEY}\` },\n});`;

  const pyBody = wantsBody
    ? `import os, requests\n\nrequests.${endpoint.method.toLowerCase()}(\n    "${url}",\n    headers={"Authorization": f"Bearer {os.environ['ALDO_API_KEY']}"},\n    json={},\n)`
    : `import os, requests\n\nrequests.${endpoint.method.toLowerCase()}(\n    "${url}",\n    headers={"Authorization": f"Bearer {os.environ['ALDO_API_KEY']}"},\n)`;

  return [
    { language: 'curl', code: curl },
    { language: 'python', code: pyBody },
    { language: 'typescript', code: tsBody },
  ];
}

function buildErrors(_endpoint: ExtractedEndpoint, requiresAuth: boolean): EndpointDoc['errors'] {
  const out: EndpointDoc['errors'][number][] = [];
  if (requiresAuth) {
    out.push({
      status: 401,
      code: 'unauthenticated',
      description: 'Missing or invalid bearer token.',
    });
    out.push({
      status: 403,
      code: 'forbidden',
      description: 'API key lacks the required scope or role.',
    });
  }
  out.push({
    status: 400,
    code: 'invalid_request',
    description: 'Request body or query failed Zod validation.',
  });
  out.push({
    status: 404,
    code: 'not_found',
    description: 'Resource does not exist (or belongs to another tenant).',
  });
  out.push({
    status: 429,
    code: 'rate_limited',
    description: 'Too many requests. Honour the `Retry-After` header.',
  });
  out.push({
    status: 500,
    code: 'internal_error',
    description: 'Server error. Include the `request_id` when reporting.',
  });
  return out;
}
