/**
 * `GET /openapi.json` + `GET /openapi.yaml` — public, cacheable
 * machine-readable spec for the ALDO AI control-plane API.
 *
 * The spec is built from `@aldo-ai/openapi` which materialises it as a
 * pure function of the version + the `@aldo-ai/api-contract` Zod
 * schemas. We memoise the build per `Deps` instance so repeated hits
 * don't reconvert on every request — the conversion is fast (~10ms on
 * a cold M1) but the result is hundreds of KB and there's no reason
 * to do it more than once per process.
 *
 * No auth: specs are public. The route bypasses bearer-auth via the
 * allow-list in `auth/middleware.ts`.
 */

import { buildOpenApiSpec, dumpYaml } from '@aldo-ai/openapi';
import { Hono } from 'hono';
import type { Deps } from '../deps.js';

let cachedJson: string | null = null;
let cachedYaml: string | null = null;
let cachedVersion: string | null = null;

function specForVersion(version: string): { json: string; yaml: string } {
  if (cachedVersion === version && cachedJson !== null && cachedYaml !== null) {
    return { json: cachedJson, yaml: cachedYaml };
  }
  const spec = buildOpenApiSpec({ version });
  cachedJson = JSON.stringify(spec);
  cachedYaml = dumpYaml(spec);
  cachedVersion = version;
  return { json: cachedJson, yaml: cachedYaml };
}

/**
 * For tests — drop the memoised spec so a per-test version pin
 * (`API_VERSION=…`) is reflected on the next call.
 */
export function resetOpenApiCache(): void {
  cachedJson = null;
  cachedYaml = null;
  cachedVersion = null;
}

export function openApiRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/openapi.json', (c) => {
    const { json } = specForVersion(deps.version);
    return new Response(json, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    });
  });

  app.get('/openapi.yaml', (c) => {
    const { yaml } = specForVersion(deps.version);
    return new Response(yaml, {
      status: 200,
      headers: {
        // YAML's IANA media type is `application/yaml` (RFC 9512); we
        // also serve under `text/yaml` per de-facto practice in the
        // OpenAPI ecosystem so curl-piping into yq / openapi-generator
        // just works.
        'content-type': 'application/yaml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    });
  });

  return app;
}
